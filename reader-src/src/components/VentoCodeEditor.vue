<!--
  Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU AFFERO GENERAL PUBLIC LICENSE for more details.

  You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
  along with this program.  If not, see <https://www.gnu.org/licenses/>.
-->
<!--
  VentoCodeEditor — CodeMirror 6 host for Vento template authoring.

  Used in three places:
    • Template Editor page (`templatePath` form — real on-disk file)
    • Prompt Editor message cards (`kind: prompt-message-body` + role)
    • Lore Editor passage textarea (`kind: lore` + scope)

  The host page owns the variable catalog (fetched once per page).
  Lint is debounced to ~300ms and skipped entirely when `disableLint`
  is set (e.g. unsaved lore drafts) or while `lazyLint` is true and the
  user has not yet focused/edited the editor.

  Save shortcut (Mod-s → save-request) is opt-in via `enableSaveShortcut`
  so we don't hijack Ctrl/Cmd-S on pages that do not implement save.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { lintKeymap, forceLinting } from "@codemirror/lint";
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { ventoLanguage, ventoLinter, ventoHighlightStyle } from "@/lib/cm-vento";
import { ventoCompletions } from "@/lib/cm-vento-complete";
import type { Diagnostic, LintBody, LoreScope, TemplateKind, VariableEntry } from "@/lib/template-api";
import { lintTemplate } from "@/lib/template-api";

const props = withDefaults(defineProps<{
  source: string;
  variables: VariableEntry[];
  /** Template path for on-disk files (Template Editor page). When absent, lint uses source-form. */
  templatePath?: string;
  /** Source-form lint kind. Required when `templatePath` is not provided. */
  kind?: TemplateKind;
  /** Required for `kind: "prompt-message-body"` — backend wraps source in `{{ message "<role>" }} … {{ /message }}`. */
  role?: "system" | "user" | "assistant";
  /** Optional lore scope hint for source-form lint. */
  scope?: LoreScope;
  /** Optional plugin scoping for `kind: "plugin-fragment"`. */
  pluginName?: string;
  /** Optional series/story context for catalog resolution. */
  series?: string;
  story?: string;
  readOnly?: boolean;
  /** When true, Mod-s emits `save-request`. Defaults to off. */
  enableSaveShortcut?: boolean;
  /** When true, line numbers gutter is rendered. Defaults to true. */
  enableLineNumbers?: boolean;
  /** Skip lint entirely (e.g. unsaved lore drafts). */
  disableLint?: boolean;
  /** Defer the first lint until the editor receives focus or an edit. */
  lazyLint?: boolean;
  /** Minimum visible lines (translated to min-height CSS). */
  minLines?: number;
  /** Maximum visible lines before vertical scroll (translated to max-height CSS). */
  maxLines?: number;
}>(), {
  enableSaveShortcut: false,
  enableLineNumbers: true,
  disableLint: false,
  lazyLint: false,
  minLines: 3,
  maxLines: 30,
});

const emit = defineEmits<{
  "update:source": [value: string];
  "lint": [diagnostics: Diagnostic[]];
  "save-request": [];
}>();

const hostRef = ref<HTMLDivElement | null>(null);
const view = shallowRef<EditorView | null>(null);
const readOnlyComp = new Compartment();
const variablesRef = shallowRef<VariableEntry[]>(props.variables);
const diagnostics = shallowRef<Diagnostic[]>([]);
const userHasInteracted = ref(false);

let lintTimer: ReturnType<typeof setTimeout> | null = null;
let lastLintedSource: string | null = null;
let lintSeq = 0;

const sizeStyle = computed(() => {
  // ~1.5em per line at the editor's font-size. Empirically matches the
  // default CodeMirror line-height; min/max are advisory caps.
  return {
    "--vc-min-lines": String(props.minLines),
    "--vc-max-lines": String(props.maxLines),
  } as Record<string, string>;
});

function getVariables(): VariableEntry[] {
  return variablesRef.value;
}

function getDiagnostics(): Diagnostic[] {
  return diagnostics.value;
}

function buildLintBody(source: string): LintBody | null {
  if (props.templatePath) {
    return {
      templatePath: props.templatePath,
      source,
      series: props.series,
      story: props.story,
    };
  }
  if (!props.kind) return null;
  if (props.kind === "prompt-message-body" && !props.role) return null;
  return {
    kind: props.kind,
    source,
    role: props.role,
    scope: props.scope,
    series: props.series,
    story: props.story,
    pluginName: props.pluginName,
  };
}

async function runLint(): Promise<void> {
  const v = view.value;
  if (!v) return;
  if (props.disableLint) {
    diagnostics.value = [];
    emit("lint", []);
    forceLinting(v);
    return;
  }
  if (props.lazyLint && !userHasInteracted.value) return;
  const source = v.state.doc.toString();
  if (source === lastLintedSource) return;
  lastLintedSource = source;
  const body = buildLintBody(source);
  if (!body) {
    diagnostics.value = [];
    emit("lint", []);
    forceLinting(v);
    return;
  }
  const seq = ++lintSeq;
  try {
    const res = await lintTemplate(body);
    // Discard responses that arrived out of order. Newer lint runs win.
    if (seq !== lintSeq) return;
    diagnostics.value = res.diagnostics;
    emit("lint", res.diagnostics);
    if (view.value) forceLinting(view.value);
  } catch (err) {
    if (seq !== lintSeq) return;
    const d: Diagnostic[] = [{
      ruleId: "lint.network-error",
      severity: "warning",
      line: 1,
      column: 1,
      message: err instanceof Error ? err.message : String(err),
    }];
    diagnostics.value = d;
    emit("lint", d);
  }
}

function scheduleLint(): void {
  if (lintTimer) clearTimeout(lintTimer);
  lintTimer = setTimeout(() => {
    lintTimer = null;
    void runLint();
  }, 300);
}

function buildExtensions() {
  const gutters = props.enableLineNumbers ? [lineNumbers()] : [];
  const keymapEntries = [
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    ...completionKeymap,
    ...lintKeymap,
  ];
  if (props.enableSaveShortcut) {
    keymapEntries.push({
      key: "Mod-s",
      preventDefault: true,
      run: () => {
        if (!props.readOnly) emit("save-request");
        return true;
      },
    });
  }
  return [
    ...gutters,
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    ventoLanguage(),
    syntaxHighlighting(ventoHighlightStyle),
    ventoCompletions(getVariables),
    ventoLinter(getDiagnostics),
    EditorView.lineWrapping,
    keymap.of(keymapEntries),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        userHasInteracted.value = true;
        const text = update.state.doc.toString();
        emit("update:source", text);
        scheduleLint();
      }
      if (update.focusChanged && update.view.hasFocus) {
        userHasInteracted.value = true;
        if (props.lazyLint && lastLintedSource === null) scheduleLint();
      }
    }),
    readOnlyComp.of(EditorState.readOnly.of(!!props.readOnly)),
  ];
}

onMounted(() => {
  if (!hostRef.value) return;
  const state = EditorState.create({
    doc: props.source,
    extensions: buildExtensions(),
  });
  view.value = new EditorView({ state, parent: hostRef.value });
  if (!props.lazyLint) scheduleLint();
});

onBeforeUnmount(() => {
  if (lintTimer) clearTimeout(lintTimer);
  view.value?.destroy();
  view.value = null;
});

watch(() => props.source, (next) => {
  const v = view.value;
  if (!v) return;
  if (v.state.doc.toString() === next) return;
  v.dispatch({
    changes: { from: 0, to: v.state.doc.length, insert: next },
  });
  lastLintedSource = null;
  scheduleLint();
});

watch(() => props.variables, (next) => {
  variablesRef.value = next;
});

watch(() => props.readOnly, (next) => {
  const v = view.value;
  if (!v) return;
  v.dispatch({ effects: readOnlyComp.reconfigure(EditorState.readOnly.of(!!next)) });
});

watch(() => props.templatePath, () => {
  lastLintedSource = null;
  scheduleLint();
});

watch(() => props.kind, () => {
  lastLintedSource = null;
  scheduleLint();
});

watch(
  () => [props.role, props.scope, props.series, props.story, props.pluginName],
  () => {
    lastLintedSource = null;
    scheduleLint();
  },
);

watch(() => props.disableLint, (next) => {
  const v = view.value;
  if (!v) return;
  if (next) {
    // Clear immediately so stale diagnostics don't linger.
    lintSeq++; // Invalidate any in-flight request.
    diagnostics.value = [];
    emit("lint", []);
    forceLinting(v);
  } else {
    lastLintedSource = null;
    scheduleLint();
  }
});

defineExpose({
  focus(): void {
    view.value?.focus();
  },
  /**
   * Insert text at the current selection/cursor. Used by "Insert Variable"
   * helpers in host pages.
   */
  insertAtCursor(text: string): void {
    const v = view.value;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    v.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    v.focus();
  },
  /**
   * Scroll-to + focus a specific line/column. Used by diagnostic panels
   * (Template Editor page) to jump to a lint hit. The host gets a 1-based
   * line/column and the editor clamps to valid positions.
   */
  jumpTo(line: number, column: number): void {
    const v = view.value;
    if (!v) return;
    const ln = Math.max(1, Math.min(line, v.state.doc.lines));
    const info = v.state.doc.line(ln);
    const pos = Math.min(info.from + Math.max(0, column - 1), info.to);
    v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    v.focus();
  },
});
</script>

<template>
  <div ref="hostRef" class="cm-vento-host" :class="{ 'is-readonly': readOnly }" :style="sizeStyle"></div>
</template>

<style scoped>
.cm-vento-host {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: calc(var(--vc-min-lines, 3) * 1.5em + 1em);
  max-height: calc(var(--vc-max-lines, 30) * 1.5em + 1em);
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--btn-bg);
  overflow: hidden;
}

.cm-vento-host :deep(.cm-editor) {
  flex: 1;
  min-height: 0;
  font-family: var(--font-monospace, monospace);
  font-size: 0.9rem;
}

.cm-vento-host :deep(.cm-scroller) {
  font-family: inherit;
  overflow-y: auto;
}

.cm-vento-host :deep(.cm-gutters) {
  background: var(--section-head-bg);
  color: var(--text-italic);
  border-right: 1px solid var(--border-color);
}

.cm-vento-host :deep(.cm-activeLineGutter) {
  background: var(--btn-active-bg);
  color: var(--text-label);
}

.cm-vento-host :deep(.cm-lineNumbers .cm-gutterElement) {
  color: var(--text-italic);
}

.cm-vento-host.is-readonly :deep(.cm-content) {
  background: var(--accent-subtle);
}

.cm-vento-host :deep(.cm-tagName-error),
.cm-vento-host :deep(.tok-tagName-error) {
  color: var(--accent-solid);
  text-decoration: underline wavy var(--accent-solid);
  font-weight: 600;
}
</style>

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
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
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
import type { Diagnostic, VariableEntry } from "@/lib/template-api";
import { lintTemplate } from "@/lib/template-api";

const props = defineProps<{
  source: string;
  templatePath: string;
  variables: VariableEntry[];
  readOnly?: boolean;
  series?: string;
  story?: string;
}>();

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

let lintTimer: ReturnType<typeof setTimeout> | null = null;
let lastLintedSource: string | null = null;

function getVariables(): VariableEntry[] {
  return variablesRef.value;
}

function getDiagnostics(): Diagnostic[] {
  return diagnostics.value;
}

async function runLint(): Promise<void> {
  const v = view.value;
  if (!v) return;
  const source = v.state.doc.toString();
  if (source === lastLintedSource) return;
  lastLintedSource = source;
  try {
    const res = await lintTemplate({
      templatePath: props.templatePath,
      source,
      series: props.series,
      story: props.story,
    });
    diagnostics.value = res.diagnostics;
    emit("lint", res.diagnostics);
    if (view.value) forceLinting(view.value);
  } catch (err) {
    // Network/HTTP error — surface as a synthetic diagnostic.
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
  return [
    lineNumbers(),
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
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
      ...lintKeymap,
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          if (!props.readOnly) emit("save-request");
          return true;
        },
      },
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const text = update.state.doc.toString();
        emit("update:source", text);
        scheduleLint();
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
  scheduleLint();
});

onBeforeUnmount(() => {
  if (lintTimer) clearTimeout(lintTimer);
  view.value?.destroy();
  view.value = null;
});

// Sync source prop → editor (when switching templates).
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

defineExpose({
  focus(): void {
    view.value?.focus();
  },
  jumpTo(line: number, column: number): void {
    const v = view.value;
    if (!v) return;
    const ln = Math.max(1, Math.min(line, v.state.doc.lines));
    const info = v.state.doc.line(ln);
    const pos = Math.min(info.from + Math.max(0, column - 1), info.to);
    v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    v.focus();
  },
  getDiagnostics,
});
</script>

<template>
  <div ref="hostRef" class="cm-vento-host" :class="{ 'is-readonly': readOnly }"></div>
</template>

<style scoped>
.cm-vento-host {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
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
}

/* Gutter (line numbers + fold markers) — theme-tokenised so it follows
 * default/light/dark palettes loaded from `themes/*.toml`. */
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

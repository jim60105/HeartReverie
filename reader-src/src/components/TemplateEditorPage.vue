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
import { errorMessage } from "@/lib/errors";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { createPatch } from "diff";
import TemplateFileTree from "./TemplateFileTree.vue";
import TemplateEditor from "./VentoCodeEditor.vue";
import { useNotification } from "@/composables/useNotification";
import { useStorySelector } from "@/composables/useStorySelector";
import {
  fetchTemplateSource,
  getVariables,
  lintTemplate,
  listTemplates,
  previewTemplate,
  TemplateApiError,
  writeTemplate,
  type Diagnostic,
  type PreviewResponse,
  type TemplateRef,
  type VariableEntry,
} from "@/lib/template-api";

const { notify } = useNotification();

const entries = ref<TemplateRef[]>([]);
const variables = ref<VariableEntry[]>([]);
const selectedPath = ref<string | null>(null);
const editorSource = ref<string>("");
const baselineSource = ref<string>("");
const dirty = ref<boolean>(false);
const diagnostics = ref<Diagnostic[]>([]);
const preview = ref<PreviewResponse | null>(null);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);
const previewMode = ref<"default" | "current">("default");
const inlineFixtureText = ref<string>("");
const inlineFixtureOpen = ref(false);
const inlineFixtureError = ref<string | null>(null);
const showCurrentConfirm = ref(false);
const showDiffModal = ref(false);
const diffText = ref("");
const saving = ref(false);
const series = ref<string>("");
const story = ref<string>("");

// Sync series/story from the global story-selector so the editor knows what
// "current" means for previews and so the variable catalog / lore listing
// can scope to the loaded story.
const { selectedSeries, selectedStory } = useStorySelector();
watch(
  [selectedSeries, selectedStory],
  ([s, st]) => {
    series.value = s ?? "";
    story.value = st ?? "";
  },
  { immediate: true },
);

const hasCurrentStory = computed(() => !!series.value && !!story.value);

const editorRef = ref<InstanceType<typeof TemplateEditor> | null>(null);

const selectedEntry = computed<TemplateRef | null>(() => {
  if (!selectedPath.value) return null;
  return entries.value.find((e) => e.templatePath === selectedPath.value) ?? null;
});

const isReadOnly = computed(() => {
  const e = selectedEntry.value;
  return !!e && e.editable === false;
});

const isLore = computed(() => selectedEntry.value?.kind === "lore");

const errorCount = computed(() => diagnostics.value.filter((d) => d.severity === "error").length);
const warningCount = computed(() => diagnostics.value.filter((d) => d.severity === "warning").length);

const groupedDiagnostics = computed(() => {
  const groups: Record<"error" | "warning" | "info", Diagnostic[]> = {
    error: [],
    warning: [],
    info: [],
  };
  for (const d of diagnostics.value) {
    const s = d.severity in groups ? d.severity : "info";
    groups[s as "error" | "warning" | "info"].push(d);
  }
  return groups;
});

const breadcrumb = computed(() => selectedPath.value ?? "（尚未選擇）");

async function refreshList(): Promise<void> {
  try {
    const res = await listTemplates({ series: series.value || undefined, story: story.value || undefined });
    entries.value = res.entries ?? res.templates ?? [];
    if (!selectedPath.value && entries.value.length > 0) {
      const sys = entries.value.find((e) => e.kind === "system") ?? entries.value[0]!;
      await selectEntry(sys.templatePath);
    }
  } catch (err) {
    notify({
      title: "載入模板清單失敗",
      body: errorMessage(err),
      level: "error",
    });
  }
}

async function refreshVariables(): Promise<void> {
  try {
    const res = await getVariables({ series: series.value || undefined, story: story.value || undefined });
    variables.value = res.variables;
  } catch {
    variables.value = [];
  }
}

async function selectEntry(templatePath: string): Promise<void> {
  if (dirty.value) {
    const ok = globalThis.confirm("尚有未儲存的變更，確定要切換模板？");
    if (!ok) return;
  }
  selectedPath.value = templatePath;
  diagnostics.value = [];
  preview.value = null;
  previewError.value = null;
  try {
    const { source } = await fetchTemplateSource(templatePath);
    editorSource.value = source;
    baselineSource.value = source;
    dirty.value = false;
  } catch (err: unknown) {
    const msg = err instanceof TemplateApiError ? err.message : String(err);
    notify({ title: `載入模板失敗：${msg}`, level: "error" });
    editorSource.value = "";
    baselineSource.value = "";
    dirty.value = false;
  }
  await runLintAndPreview();
}

function onSourceUpdate(next: string): void {
  editorSource.value = next;
  dirty.value = next !== baselineSource.value;
  schedulePreview();
}

function onLint(next: Diagnostic[]): void {
  diagnostics.value = next;
}

let previewTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePreview(): void {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewTimer = null;
    void runPreview();
  }, 500);
}

async function runLintAndPreview(): Promise<void> {
  await runLint();
  await runPreview();
}

async function runLint(): Promise<void> {
  if (!selectedPath.value) return;
  try {
    const res = await lintTemplate({
      templatePath: selectedPath.value,
      source: editorSource.value,
      series: series.value || undefined,
      story: story.value || undefined,
    });
    diagnostics.value = res.diagnostics;
  } catch (err) {
    diagnostics.value = [{
      ruleId: "lint.network-error",
      severity: "warning",
      line: 1,
      column: 1,
      message: errorMessage(err),
    }];
  }
}

function parseInlineFixture(): Record<string, unknown> | null {
  if (!inlineFixtureText.value.trim()) return null;
  try {
    const parsed = JSON.parse(inlineFixtureText.value);
    if (parsed && typeof parsed === "object") {
      inlineFixtureError.value = null;
      return parsed as Record<string, unknown>;
    }
    inlineFixtureError.value = "fixture 必須是 JSON 物件";
    return null;
  } catch (err) {
    inlineFixtureError.value = errorMessage(err);
    return null;
  }
}

async function runPreview(): Promise<void> {
  if (!selectedPath.value) return;
  if (errorCount.value > 0) {
    preview.value = null;
    previewError.value = "Lint 有錯誤，預覽已暫停";
    return;
  }
  previewLoading.value = true;
  previewError.value = null;
  try {
    const inline = parseInlineFixture();
    const fixture: "default" | "current" | Record<string, unknown> =
      inline !== null
        ? inline
        : previewMode.value;
    const res = await previewTemplate({
      templatePath: selectedPath.value,
      source: editorSource.value,
      fixture,
      series: series.value || undefined,
      story: story.value || undefined,
    });
    preview.value = res;
  } catch (err) {
    preview.value = null;
    previewError.value = errorMessage(err);
  } finally {
    previewLoading.value = false;
  }
}

function onPreviewModeChange(next: "default" | "current"): void {
  if (next === "current") {
    if (!hasCurrentStory.value) {
      // Cannot use "current" fixture without a loaded story — keep on
      // "default" and notify so the user knows why the switch was rejected.
      notify({
        title: "尚未載入故事",
        body: "請先從上方故事選擇器載入故事，才能使用「目前故事」預覽模式。",
        level: "warning",
      });
      // Re-sync the radio DOM so the just-clicked "目前故事" reverts visually.
      void nextTick(syncPreviewModeRadios);
      return;
    }
    showCurrentConfirm.value = true;
    return;
  }
  previewMode.value = next;
  void runPreview();
}

function confirmCurrentMode(): void {
  previewMode.value = "current";
  showCurrentConfirm.value = false;
  void runPreview();
}

function cancelCurrentMode(): void {
  showCurrentConfirm.value = false;
  // Vue's :checked binding to a computed expression doesn't always force a
  // DOM re-sync when the underlying value hasn't changed (the browser has
  // already moved the radio dot to "current" before Vue ran its update).
  // Manually re-sync the DOM so cancel returns the visible state to
  // "default".
  void nextTick(syncPreviewModeRadios);
}

function syncPreviewModeRadios(): void {
  const radios = document.querySelectorAll<HTMLInputElement>(
    'input[name="te-preview-mode"]',
  );
  radios.forEach((r) => {
    r.checked = r.value === previewMode.value;
  });
}

function jumpTo(d: Diagnostic): void {
  editorRef.value?.jumpTo(d.line, d.column);
}

async function onSaveRequest(): Promise<void> {
  await handleSave();
}

async function handleSave(): Promise<void> {
  if (!selectedPath.value || isReadOnly.value || saving.value) return;
  // Always re-lint before save.
  await runLint();
  if (errorCount.value > 0) {
    notify({
      title: `請先修復 ${errorCount.value} 個錯誤`,
      level: "error",
    });
    return;
  }
  if (warningCount.value > 0) {
    notify({
      title: `儲存：仍有 ${warningCount.value} 個警告`,
      level: "warning",
    });
  }
  // Show diff modal.
  diffText.value = createPatch(
    selectedPath.value,
    baselineSource.value,
    editorSource.value,
    "current",
    "buffer",
  );
  showDiffModal.value = true;
}

async function confirmSave(): Promise<void> {
  if (!selectedPath.value) return;
  saving.value = true;
  try {
    const res = await writeTemplate({
      templatePath: selectedPath.value,
      source: editorSource.value,
    });
    baselineSource.value = editorSource.value;
    dirty.value = false;
    showDiffModal.value = false;
    notify({
      title: "已儲存",
      body: res.backupPath ? `備份：${res.backupPath}` : undefined,
      level: "info",
    });
    await runLintAndPreview();
  } catch (err) {
    if (err instanceof TemplateApiError) {
      if (err.status === 422) {
        notify({
          title: "模板驗證失敗",
          body: err.expressions?.join("\n") ?? err.detail ?? err.message,
          level: "error",
        });
      } else if (err.status === 403) {
        notify({
          title: "此檔案唯讀，無法儲存",
          body: err.detail ?? err.message,
          level: "error",
        });
      } else {
        notify({
          title: `儲存失敗 (${err.status})`,
          body: err.detail ?? err.message,
          level: "error",
        });
      }
    } else {
      notify({
        title: "儲存失敗",
        body: errorMessage(err),
        level: "error",
      });
    }
  } finally {
    saving.value = false;
  }
}

function cancelSave(): void {
  showDiffModal.value = false;
}

onMounted(async () => {
  await Promise.all([refreshList(), refreshVariables()]);
});

watch([series, story], async () => {
  await Promise.all([refreshList(), refreshVariables()]);
});
</script>

<template>
  <div class="template-editor-page">
    <header class="te-toolbar">
      <div class="te-toolbar-left">
        <span class="te-breadcrumb" :title="breadcrumb">{{ breadcrumb }}</span>
        <span v-if="dirty" class="te-dirty">●</span>
      </div>
      <div class="te-toolbar-right">
        <button
          v-if="!isReadOnly"
          type="button"
          class="te-save-btn themed-btn"
          :disabled="!dirty || saving"
          @click="handleSave"
        >
          {{ saving ? "儲存中…" : "儲存" }}
        </button>
        <span v-else class="te-readonly-pill">唯讀</span>
      </div>
    </header>

    <div class="te-body">
      <aside class="te-pane te-pane--tree">
        <TemplateFileTree
          :entries="entries"
          :selected="selectedPath"
          @select="selectEntry"
        />
      </aside>

      <section class="te-pane te-pane--editor">
        <TemplateEditor
          v-if="selectedPath"
          ref="editorRef"
          :source="editorSource"
          :template-path="selectedPath"
          :variables="variables"
          :read-only="isReadOnly"
          :series="series || undefined"
          :story="story || undefined"
          :enable-save-shortcut="true"
          @update:source="onSourceUpdate"
          @lint="onLint"
          @save-request="onSaveRequest"
        />
        <div v-else class="te-empty">請從左側選擇一個模板</div>

        <details class="te-diagnostics" :open="diagnostics.length > 0">
          <summary>
            診斷 ({{ diagnostics.length }})
            <span v-if="errorCount" class="diag-count diag-count--error">{{ errorCount }} 錯誤</span>
            <span v-if="warningCount" class="diag-count diag-count--warning">{{ warningCount }} 警告</span>
          </summary>
          <ul class="diag-list">
            <li
              v-for="(d, idx) in [...groupedDiagnostics.error, ...groupedDiagnostics.warning, ...groupedDiagnostics.info]"
              :key="idx"
              :class="['diag-item', 'diag-item--' + d.severity]"
            >
              <button type="button" class="diag-jump" @click="jumpTo(d)">
                <span class="diag-loc">{{ d.line }}:{{ d.column }}</span>
                <span class="diag-rule">{{ d.ruleId }}</span>
                <span class="diag-msg">{{ d.message }}</span>
              </button>
            </li>
          </ul>
          <div v-if="!diagnostics.length" class="diag-empty">無診斷訊息</div>
        </details>
      </section>

      <aside class="te-pane te-pane--preview">
        <header class="te-preview-header">
          <h3>預覽</h3>
          <div class="te-preview-modes">
            <label>
              <input
                type="radio"
                name="te-preview-mode"
                value="default"
                :checked="previewMode === 'default'"
                @change="onPreviewModeChange('default')"
              />
              預設
            </label>
            <label>
              <input
                type="radio"
                name="te-preview-mode"
                value="current"
                :checked="previewMode === 'current'"
                @change="onPreviewModeChange('current')"
              />
              目前故事
            </label>
            <button type="button" class="te-inline-toggle themed-btn" @click="inlineFixtureOpen = !inlineFixtureOpen">
              {{ inlineFixtureOpen ? "收合 JSON" : "Inline JSON" }}
            </button>
          </div>
        </header>
        <div v-if="inlineFixtureOpen" class="te-inline-fixture">
          <textarea
            v-model="inlineFixtureText"
            placeholder="貼上 JSON fixture 物件，留空使用 mode 選擇"
            rows="4"
            @blur="runPreview"
          />
          <div v-if="inlineFixtureError" class="te-inline-err">{{ inlineFixtureError }}</div>
        </div>

        <div class="te-preview-body">
          <div v-if="previewLoading" class="te-preview-loading">載入中…</div>
          <div v-else-if="previewError" class="te-preview-error">{{ previewError }}</div>
          <template v-else-if="preview">
            <template v-if="preview.kind === 'messages'">
              <div
                v-for="(msg, idx) in preview.messages"
                :key="idx"
                :class="['preview-msg', 'preview-msg--' + msg.role]"
              >
                <header class="preview-msg-header">
                  <span class="preview-msg-role">{{ msg.role }}</span>
                </header>
                <pre class="preview-msg-body">{{ msg.content }}</pre>
              </div>
              <div v-if="!preview.messages.length" class="te-preview-empty">（無訊息）</div>
            </template>
            <template v-else>
              <pre class="preview-markdown">{{ preview.content }}</pre>
            </template>
          </template>
          <div v-else class="te-preview-empty">尚無預覽</div>
        </div>
      </aside>
    </div>

    <!-- Current-mode confirmation modal -->
    <div v-if="showCurrentConfirm" class="modal-backdrop" @click.self="cancelCurrentMode">
      <div class="modal" role="dialog" aria-modal="true">
        <h3>切換到「目前故事」預覽</h3>
        <p>將從磁碟載入章節，僅在記憶體渲染、不寫回任何檔案。</p>
        <div v-if="isLore">注意：lore 篇章將以 first-pass snapshot 解析。</div>
        <div class="modal-actions">
          <button type="button" class="themed-btn" @click="cancelCurrentMode">取消</button>
          <button type="button" class="themed-btn themed-btn--primary" @click="confirmCurrentMode">確認</button>
        </div>
      </div>
    </div>

    <!-- Diff confirm modal -->
    <div v-if="showDiffModal" class="modal-backdrop" @click.self="cancelSave">
      <div class="modal modal--wide" role="dialog" aria-modal="true">
        <h3>確認儲存：{{ selectedPath }}</h3>
        <pre class="diff-pre">{{ diffText || "(無差異)" }}</pre>
        <div class="modal-actions">
          <button type="button" class="themed-btn" :disabled="saving" @click="cancelSave">取消</button>
          <button type="button" class="themed-btn themed-btn--primary" :disabled="saving" @click="confirmSave">
            {{ saving ? "儲存中…" : "確認儲存" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.template-editor-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 8px;
}

.te-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  min-height: 48px;
  border-bottom: 1px solid var(--border-color);
  background: var(--btn-bg);
  box-sizing: border-box;
}

.te-toolbar-left {
  display: flex;
  gap: 8px;
  align-items: center;
  font-family: var(--font-monospace, monospace);
  font-size: 0.85rem;
  color: var(--text-label);
}

.te-breadcrumb {
  max-width: 50vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.te-dirty {
  color: var(--accent-solid);
  font-weight: 700;
}

.te-save-btn {
  border: 1px solid transparent;
  border-radius: 4px;
  background: var(--accent-solid);
  color: var(--text-on-accent);
  padding: 0 14px;
  height: 32px;
  line-height: 30px;
  font-weight: 600;
  cursor: pointer;
  box-sizing: border-box;
}

.te-save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.te-readonly-pill {
  display: inline-flex;
  align-items: center;
  padding: 0 14px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--pill-bg);
  color: var(--text-quote);
  font-size: 0.8rem;
  box-sizing: border-box;
}

.te-body {
  display: grid;
  grid-template-columns: 22% 48% 30%;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

.te-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--btn-bg);
  overflow: hidden;
}

.te-pane--tree {
  overflow-y: auto;
}

.te-pane--editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.te-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-label);
  font-style: italic;
}

.te-diagnostics {
  border-top: 1px solid var(--border-color);
  max-height: 30%;
  overflow-y: auto;
  font-size: 0.85rem;
  background: var(--btn-bg);
}

.te-diagnostics summary {
  padding: 6px 12px;
  cursor: pointer;
  font-weight: 600;
  color: var(--text-title);
  user-select: none;
}

.diag-count {
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 0.75rem;
}

.diag-count--error {
  background: var(--accent-subtle);
  color: var(--accent-solid);
}

.diag-count--warning {
  background: var(--pill-bg);
  color: var(--text-quote);
}

.diag-list {
  list-style: none;
  margin: 0;
  padding: 4px 0 8px;
}

.diag-item {
  border-left: 3px solid transparent;
}

.diag-item--error {
  border-left-color: var(--accent-solid);
}

.diag-item--warning {
  border-left-color: var(--text-quote);
}

.diag-jump {
  display: flex;
  gap: 8px;
  width: 100%;
  padding: 4px 12px;
  border: none;
  background: transparent;
  color: var(--text-label);
  text-align: left;
  cursor: pointer;
  font: inherit;
}

.diag-jump:hover {
  background: var(--accent-subtle);
}

.diag-loc {
  font-family: var(--font-monospace, monospace);
  color: var(--text-quote);
  min-width: 56px;
}

.diag-rule {
  color: var(--text-title);
  min-width: 160px;
}

.diag-msg {
  flex: 1;
  white-space: pre-wrap;
}

.diag-empty {
  padding: 8px 12px;
  color: var(--text-label);
  font-style: italic;
}

.te-preview-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.te-preview-header h3 {
  margin: 0;
  font-size: 0.95rem;
  color: var(--text-title);
}

.te-preview-modes {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 0.85rem;
}

.te-inline-toggle {
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid var(--btn-border);
  border-radius: 3px;
  background: var(--btn-bg);
  cursor: pointer;
  font-size: 0.8rem;
}

.te-inline-fixture {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.te-inline-fixture textarea {
  width: 100%;
  border: 1px solid var(--btn-border);
  border-radius: 3px;
  background: var(--btn-bg);
  font-family: var(--font-monospace, monospace);
  font-size: 0.8rem;
  padding: 6px;
  resize: vertical;
}

.te-inline-err {
  color: var(--accent-solid);
  font-size: 0.8rem;
  margin-top: 4px;
}

.te-preview-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 0.85rem;
}

.te-preview-loading,
.te-preview-empty {
  color: var(--text-label);
  font-style: italic;
}

.te-preview-error {
  color: var(--accent-solid);
}

.preview-msg {
  border: 1px solid var(--border-color);
  border-left-width: 4px;
  border-radius: 4px;
}

.preview-msg--system { border-left-color: var(--text-quote); }
.preview-msg--user { border-left-color: var(--accent-solid); }
.preview-msg--assistant { border-left-color: var(--text-label); }

.preview-msg-header {
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-color);
  font-family: var(--font-monospace, monospace);
  font-size: 0.75rem;
  color: var(--text-label);
}

.preview-msg-body,
.preview-markdown {
  margin: 0;
  padding: 8px 10px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-monospace, monospace);
  font-size: 0.8rem;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--page-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--panel-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 16px 20px;
  max-width: 480px;
  width: 90%;
  color: var(--text-title);
}

.modal--wide {
  max-width: 720px;
}

.modal h3 {
  margin: 0 0 8px;
  font-size: 1rem;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}

.themed-btn--primary {
  background: var(--accent-solid);
  color: var(--text-title);
  border-color: var(--accent-solid);
}

.diff-pre {
  max-height: 50vh;
  overflow: auto;
  background: var(--accent-subtle);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 8px;
  font-family: var(--font-monospace, monospace);
  font-size: 0.8rem;
  white-space: pre;
}

@media (max-width: 1023px) {
  .te-body {
    grid-template-columns: 1fr;
    grid-auto-rows: minmax(200px, auto);
  }
}
</style>

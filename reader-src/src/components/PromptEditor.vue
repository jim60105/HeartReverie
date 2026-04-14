<script setup lang="ts">
import { ref, onMounted } from "vue";
import { usePromptEditor } from "@/composables/usePromptEditor";

const emit = defineEmits<{ preview: []; saved: [] }>();

const {
  templateContent,
  parameters,
  isDirty,
  isCustom,
  isSaving,
  save,
  loadTemplate,
  resetTemplate,
} = usePromptEditor();

const textareaRef = ref<HTMLTextAreaElement | null>(null);

onMounted(async () => {
  await loadTemplate();
});

async function handleSave() {
  await save();
  emit("saved");
}

async function handleReset() {
  await resetTemplate();
}

function insertAtCursor(text: string) {
  const ta = textareaRef.value;
  if (!ta) return;
  ta.focus();
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const before = templateContent.value.substring(0, start);
  const after = templateContent.value.substring(end);
  templateContent.value = before + text + after;
  const newPos = start + text.length;
  requestAnimationFrame(() => {
    ta.setSelectionRange(newPos, newPos);
  });
}

function handlePreview() {
  emit("preview");
}
</script>

<template>
  <div class="editor-root">
    <div class="editor-toolbar">
      <div class="toolbar-left">
        <span class="toolbar-label">變數</span>
        <div class="variable-pills">
          <button
            v-for="p in parameters"
            :key="p.name"
            class="variable-pill"
            :class="{
              'pill-core': p.source === 'core',
              'pill-lore': p.source === 'lore',
              'pill-plugin': p.source !== 'core' && p.source !== 'lore',
            }"
            :title="`${p.source}: ${p.type} — 點擊插入`"
            @click="insertAtCursor(`{{ ${p.name} }}`)"
          >
            {{ p.name }}
          </button>
        </div>
      </div>
      <div class="toolbar-actions">
        <button
          class="toolbar-btn"
          title="回復預設 (system.md)"
          :disabled="!isCustom"
          @click="handleReset"
        >
          ↻ 回復預設
        </button>
        <button
          class="toolbar-btn toolbar-btn--save"
          :disabled="!isDirty || isSaving"
          @click="handleSave"
        >
          <span v-if="isSaving" class="save-spinner">⏳</span>
          {{ isSaving ? '儲存中…' : '儲存' }}
        </button>
        <button class="toolbar-btn toolbar-btn--primary" @click="handlePreview">
          預覽 Prompt
        </button>
      </div>
    </div>

    <div class="editor-textarea-wrap">
      <textarea
        ref="textareaRef"
        v-model="templateContent"
        class="editor-textarea"
        spellcheck="false"
        placeholder="載入中..."
      ></textarea>
    </div>
  </div>
</template>

<style scoped>
.editor-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 12px;
}

.editor-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 12px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.toolbar-label {
  color: var(--text-label);
  font-size: 0.8em;
  font-family: var(--font-antique), var(--font-system-ui);
  white-space: nowrap;
}

.variable-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.variable-pill {
  transition: background 0.15s;
  cursor: pointer;
  border: 1px solid var(--item-border);
  border-radius: 12px;
  background: rgba(224, 80, 112, 0.12);
  padding: 2px 8px;
  color: var(--text-name);
  font-size: 0.8em;
  font-family: monospace;
}

.variable-pill:hover {
  background: rgba(224, 80, 112, 0.3);
}

.variable-pill.pill-core {
  border-color: var(--border-color);
  color: #ff8aaa;
}

.variable-pill.pill-plugin {
  border-color: rgba(180, 30, 60, 0.6);
  background: rgba(180, 30, 60, 0.12);
  color: var(--text-label);
}

.variable-pill.pill-plugin:hover {
  background: rgba(180, 30, 60, 0.25);
}

.variable-pill.pill-lore {
  border-color: rgba(217, 158, 46, 0.3);
  background: rgba(217, 158, 46, 0.15);
  color: #d4a017;
}

.variable-pill.pill-lore:hover {
  background: rgba(217, 158, 46, 0.3);
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.toolbar-btn {
  cursor: pointer;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 6px 14px;
  color: var(--text-label);
  font-size: 0.85em;
  font-family: var(--font-antique), var(--font-system-ui);
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.toolbar-btn:hover {
  background: var(--btn-hover-bg);
}

.toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toolbar-btn:disabled:hover {
  background: var(--btn-bg);
}

.toolbar-btn--save {
  border-color: #4ade80;
  color: #4ade80;
}

.toolbar-btn--save:not(:disabled):hover {
  background: rgba(74, 222, 128, 0.15);
}

.toolbar-btn--primary {
  border-color: var(--text-title);
  color: var(--text-name);
}

.editor-textarea-wrap {
  flex: 1;
  min-height: 0;
}

.editor-textarea {
  border: 1px solid var(--item-border);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  padding: 12px;
  width: 100%;
  height: 100%;
  resize: none;
  color: var(--text-main);
  font-size: 0.85em;
  line-height: 1.5;
  font-family: monospace;
  tab-size: 2;
  box-sizing: border-box;
}

.editor-textarea:focus {
  outline: none;
  border-color: var(--text-title);
}
</style>

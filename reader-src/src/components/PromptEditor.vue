<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { usePromptEditor } from "@/composables/usePromptEditor";

const emit = defineEmits<{ close: [] }>();

const {
  templateContent,
  parameters,
  savedTemplate,
  loadTemplate,
  resetTemplate,
} = usePromptEditor();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
let saveTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(async () => {
  await loadTemplate();
});

onUnmounted(() => {
  if (saveTimer) clearTimeout(saveTimer);
});

function handleInput() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistToStorage();
  }, 500);
}

function persistToStorage() {
  const STORAGE_KEY = "story-editor-template";
  const current = templateContent.value;
  if (savedTemplate.value !== undefined && current === savedTemplate.value) {
    return;
  }
  localStorage.setItem(STORAGE_KEY, current);
}

function handleReset() {
  resetTemplate();
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
  handleInput();
}

function handlePreview() {
  emit("close");
}

function handleClose() {
  emit("close");
}
</script>

<template>
  <div class="prompt-editor-panel">
    <div class="editor-header">
      <h3>🎛️ 編排器</h3>
      <div class="editor-header-actions">
        <button class="editor-btn-sm" title="重設為伺服器版本" @click="handleReset">
          ↻ 重設
        </button>
        <button class="editor-close-btn" @click="handleClose">✕</button>
      </div>
    </div>

    <div class="editor-variables">
      <div class="editor-variables-label">
        變數 <span class="editor-hint">(點擊插入)</span>
      </div>
      <div class="variable-pills">
        <button
          v-for="p in parameters"
          :key="p.name"
          class="variable-pill"
          :class="p.source === 'core' ? 'pill-core' : 'pill-plugin'"
          :title="`${p.source}: ${p.type}`"
          @click="insertAtCursor(`{{ ${p.name} }}`)"
        >
          {{ p.name }}
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
        @input="handleInput"
      ></textarea>
    </div>

    <div class="editor-actions">
      <button class="editor-btn" @click="handlePreview">預覽 Prompt</button>
    </div>
  </div>
</template>

<style scoped>
.prompt-editor-panel {
  display: flex;
  position: fixed;
  top: 0;
  right: 0;
  flex-direction: column;
  z-index: 1000;
  border-left: 1px solid var(--border-color);
  background: linear-gradient(145deg, #1a0810, #220c16);
  padding: 16px;
  width: 33vw;
  height: 100vh;
}

@media (max-width: 767px) {
  .prompt-editor-panel {
    width: 100vw;
  }
}

.editor-header {
  display: flex;
  flex-shrink: 0;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.editor-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.editor-close-btn {
  cursor: pointer;
  border: none;
  background: none;
  color: inherit;
  font-size: 1.2em;
}

.editor-btn-sm {
  cursor: pointer;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 4px 10px;
  color: var(--text-label);
  font-size: 0.85em;
}

.editor-btn-sm:hover {
  background: var(--btn-hover-bg);
}

.editor-variables {
  flex-shrink: 0;
  margin-bottom: 10px;
}

.editor-variables-label {
  margin-bottom: 6px;
  color: var(--text-label);
  font-size: 0.85em;
}

.editor-hint {
  color: rgba(255, 122, 150, 0.5);
  font-size: 0.85em;
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

.editor-textarea-wrap {
  flex: 1;
  margin-bottom: 10px;
  min-height: 0;
}

.editor-textarea {
  border: 1px solid var(--item-border);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  padding: 10px;
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

.editor-actions {
  flex-shrink: 0;
}

.editor-btn {
  cursor: pointer;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 8px 16px;
  width: 100%;
  color: inherit;
}

.editor-btn:hover {
  background: var(--btn-hover-bg);
}
</style>

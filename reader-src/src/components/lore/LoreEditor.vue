<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useLoreApi } from "@/composables/useLoreApi";

const props = defineProps<{
  scope: "global" | "series" | "story";
  path?: string;
  series?: string;
  story?: string;
}>();

const emit = defineEmits<{
  saved: [];
  cancelled: [];
  deleted: [];
}>();

const { readPassage, writePassage, deletePassage, allTags } = useLoreApi();

const filename = ref(props.path ?? "");
const tagsInput = ref("");
const priority = ref(0);
const enabled = ref(true);
const content = ref("");
const saving = ref(false);
const deleting = ref(false);
const errorMsg = ref<string | null>(null);
const showDeleteConfirm = ref(false);
const tagInputFocused = ref(false);
const tagInputEl = ref<HTMLInputElement | null>(null);

const isNew = computed(() => !props.path);

const currentTagQuery = computed(() => {
  const parts = tagsInput.value.split(",");
  return (parts[parts.length - 1] || "").trim().toLowerCase();
});

const tagSuggestions = computed(() => {
  const query = currentTagQuery.value;
  if (!query) return [];
  const existing = parseTags();
  return allTags.value.filter(
    (t) => t.toLowerCase().includes(query) && !existing.includes(t),
  );
});

const filenameError = computed(() => {
  if (!filename.value.trim()) return "檔名不得為空";
  if (!filename.value.endsWith(".md")) return "檔名必須以 .md 結尾";
  return null;
});

const canSave = computed(
  () => !filenameError.value && !saving.value && !deleting.value,
);

onMounted(async () => {
  if (!isNew.value && props.path) {
    try {
      const data = await readPassage(
        props.scope,
        props.path,
        props.series,
        props.story,
      );
      tagsInput.value = data.frontmatter.tags.join(", ");
      priority.value = data.frontmatter.priority;
      enabled.value = data.frontmatter.enabled;
      content.value = data.content;
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : "載入失敗";
    }
  }
});

function parseTags(): string[] {
  return tagsInput.value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function selectTagSuggestion(tag: string) {
  const parts = tagsInput.value.split(",");
  parts.pop();
  parts.push(` ${tag}`);
  tagsInput.value = parts.join(",") + ", ";
  tagInputFocused.value = false;
  tagInputEl.value?.focus();
}

async function handleSave() {
  if (!canSave.value) return;
  saving.value = true;
  errorMsg.value = null;
  try {
    await writePassage(
      props.scope,
      filename.value,
      { tags: parseTags(), priority: priority.value, enabled: enabled.value },
      content.value,
      props.series,
      props.story,
    );
    emit("saved");
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "儲存失敗";
  } finally {
    saving.value = false;
  }
}

async function handleDelete() {
  if (!props.path) return;
  deleting.value = true;
  errorMsg.value = null;
  try {
    await deletePassage(props.scope, props.path, props.series, props.story);
    emit("deleted");
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "刪除失敗";
  } finally {
    deleting.value = false;
    showDeleteConfirm.value = false;
  }
}
</script>

<template>
  <div class="lore-editor">
    <div class="editor-header">
      <h3 class="editor-title">{{ isNew ? "新增篇章" : "編輯篇章" }}</h3>
      <button class="toolbar-btn" @click="emit('cancelled')">✕ 取消</button>
    </div>

    <div v-if="errorMsg" class="editor-error">{{ errorMsg }}</div>

    <div class="editor-fields">
      <label class="field-label">
        檔名
        <input
          v-model="filename"
          class="field-input"
          type="text"
          placeholder="example.md"
          :readonly="!isNew"
          :class="{ 'field-readonly': !isNew }"
        />
        <span v-if="filenameError && filename" class="field-hint field-hint--error">
          {{ filenameError }}
        </span>
      </label>

      <label class="field-label">
        標籤（以逗號分隔）
        <div class="tag-autocomplete-wrap">
          <input
            ref="tagInputEl"
            v-model="tagsInput"
            class="field-input"
            type="text"
            placeholder="角色, 世界觀, 設定"
            @focus="tagInputFocused = true"
            @blur="tagInputFocused = false"
          />
          <div
            v-if="tagInputFocused && tagSuggestions.length"
            class="tag-suggestions"
          >
            <button
              v-for="suggestion in tagSuggestions"
              :key="suggestion"
              class="tag-suggestion"
              @mousedown.prevent="selectTagSuggestion(suggestion)"
            >
              {{ suggestion }}
            </button>
          </div>
        </div>
      </label>

      <div class="field-row">
        <label class="field-label field-label--inline">
          優先序
          <input
            v-model.number="priority"
            class="field-input field-input--narrow"
            type="number"
            min="0"
          />
        </label>

        <label class="field-label field-label--inline field-toggle">
          <input v-model="enabled" type="checkbox" class="toggle-checkbox" />
          <span class="toggle-label">{{ enabled ? "啟用" : "停用" }}</span>
        </label>
      </div>

      <label class="field-label field-label--grow">
        內容
        <textarea
          v-model="content"
          class="field-textarea"
          placeholder="Markdown 內容..."
          spellcheck="false"
        ></textarea>
      </label>
    </div>

    <div class="editor-actions">
      <button
        class="toolbar-btn toolbar-btn--save"
        :disabled="!canSave"
        @click="handleSave"
      >
        {{ saving ? "儲存中…" : "儲存" }}
      </button>

      <button
        v-if="!isNew"
        class="toolbar-btn toolbar-btn--danger"
        :disabled="deleting"
        @click="showDeleteConfirm = true"
      >
        刪除
      </button>
    </div>

    <!-- Delete confirm dialog -->
    <div v-if="showDeleteConfirm" class="confirm-overlay">
      <div class="confirm-dialog">
        <p class="confirm-text">確定要刪除「{{ props.path }}」嗎？此操作無法復原。</p>
        <div class="confirm-actions">
          <button
            class="toolbar-btn toolbar-btn--danger"
            :disabled="deleting"
            @click="handleDelete"
          >
            {{ deleting ? "刪除中…" : "確認刪除" }}
          </button>
          <button
            class="toolbar-btn"
            @click="showDeleteConfirm = false"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lore-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 12px;
}

.editor-title {
  margin: 0;
  color: var(--text-name);
  font-size: 1.1em;
  font-family: var(--font-antique), var(--font-system-ui);
}

.editor-error {
  border: 1px solid #dc2626;
  border-radius: 6px;
  background: rgba(220, 38, 38, 0.12);
  padding: 8px 12px;
  color: #fca5a5;
  font-size: 0.85em;
}

.editor-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-label);
  font-size: 0.85em;
  font-family: var(--font-antique), var(--font-system-ui);
}

.field-label--inline {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.field-label--grow {
  flex: 1;
  min-height: 0;
}

.field-input {
  border: 1px solid var(--item-border);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.3);
  padding: 6px 10px;
  color: var(--text-main);
  font-size: 0.95em;
  font-family: monospace;
}

.field-input:focus {
  outline: none;
  border-color: var(--text-title);
}

.field-input--narrow {
  width: 80px;
}

.field-readonly {
  opacity: 0.6;
  cursor: not-allowed;
}

.field-hint {
  font-size: 0.8em;
}

.field-hint--error {
  color: #fca5a5;
}

.field-row {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.field-toggle {
  cursor: pointer;
  user-select: none;
}

.toggle-checkbox {
  accent-color: var(--text-title);
}

.toggle-label {
  color: var(--text-main);
}

.field-textarea {
  flex: 1;
  min-height: 120px;
  border: 1px solid var(--item-border);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  padding: 10px;
  resize: none;
  color: var(--text-main);
  font-size: 0.85em;
  line-height: 1.5;
  font-family: monospace;
  tab-size: 2;
  box-sizing: border-box;
}

.field-textarea:focus {
  outline: none;
  border-color: var(--text-title);
}

/* Tag autocomplete */
.tag-autocomplete-wrap {
  position: relative;
}

.tag-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--panel-bg);
  margin-top: 4px;
  max-height: 160px;
}

.tag-suggestion {
  cursor: pointer;
  border: none;
  background: transparent;
  padding: 6px 10px;
  color: var(--text-main);
  font-size: 0.85em;
  font-family: var(--font-antique), var(--font-system-ui);
  text-align: left;
  transition: background 0.15s;
}

.tag-suggestion:hover {
  background: var(--btn-hover-bg);
}

.editor-actions {
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

.toolbar-btn--danger {
  border-color: #dc2626;
  color: #fca5a5;
}

.toolbar-btn--danger:not(:disabled):hover {
  background: rgba(220, 38, 38, 0.15);
}

.confirm-overlay {
  display: flex;
  position: fixed;
  inset: 0;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.6);
}

.confirm-dialog {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--panel-bg);
  padding: 20px 24px;
}

.confirm-text {
  margin: 0 0 16px;
  color: var(--text-main);
  font-size: 0.95em;
  font-family: var(--font-antique), var(--font-system-ui);
}

.confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>

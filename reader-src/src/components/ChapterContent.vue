<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChapterContentProps } from "@/types";
import { useMarkdownRenderer } from "@/composables/useMarkdownRenderer";
import { useChapterNav } from "@/composables/useChapterNav";
import { useChapterActions } from "@/composables/useChapterActions";
import router from "@/router";
import VentoErrorCard from "./VentoErrorCard.vue";

const props = defineProps<ChapterContentProps>();

const { renderChapter } = useMarkdownRenderer();
const {
  chapters,
  currentIndex,
  mode,
  getBackendContext,
  reloadToLast,
  loadFromBackend,
} = useChapterNav();
const { editChapter, rewindAfter, branchFrom } = useChapterActions();

const tokens = computed(() =>
  renderChapter(props.rawMarkdown, { isLastChapter: props.isLastChapter }),
);

const showToolbar = computed(() => mode.value === "backend");

const currentChapterNumber = computed(
  () => chapters.value[currentIndex.value]?.number ?? currentIndex.value + 1,
);

const isEditing = ref(false);
const editBuffer = ref("");
const isBusy = ref(false);
const errorMessage = ref("");

function beginEdit(): void {
  editBuffer.value = props.rawMarkdown;
  errorMessage.value = "";
  isEditing.value = true;
}

function cancelEdit(): void {
  isEditing.value = false;
  editBuffer.value = "";
}

async function saveEdit(): Promise<void> {
  const ctx = getBackendContext();
  if (!ctx.series || !ctx.story) return;
  isBusy.value = true;
  errorMessage.value = "";
  try {
    await editChapter(ctx.series, ctx.story, currentChapterNumber.value, editBuffer.value);
    isEditing.value = false;
    await reloadToLast();
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : "儲存失敗";
  } finally {
    isBusy.value = false;
  }
}

async function handleRewind(): Promise<void> {
  const ctx = getBackendContext();
  if (!ctx.series || !ctx.story) return;
  const target = currentChapterNumber.value;
  if (!globalThis.confirm(`確定要倒回至第 ${target} 章？之後的章節將被刪除。`)) {
    return;
  }
  isBusy.value = true;
  errorMessage.value = "";
  try {
    await rewindAfter(ctx.series, ctx.story, target);
    await reloadToLast();
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : "倒回失敗";
  } finally {
    isBusy.value = false;
  }
}

async function handleBranch(): Promise<void> {
  const ctx = getBackendContext();
  if (!ctx.series || !ctx.story) return;
  const input = globalThis.prompt("輸入新故事名稱（留空則自動產生）：", "");
  if (input === null) return;
  const trimmed = input.trim();
  isBusy.value = true;
  errorMessage.value = "";
  try {
    const result = await branchFrom(
      ctx.series,
      ctx.story,
      currentChapterNumber.value,
      trimmed ? trimmed : undefined,
    );
    await loadFromBackend(result.series, result.name, currentChapterNumber.value);
    router.push({
      name: "chapter",
      params: {
        series: result.series,
        story: result.name,
        chapter: String(currentChapterNumber.value),
      },
    }).catch(() => {});
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : "分支失敗";
  } finally {
    isBusy.value = false;
  }
}
</script>

<template>
  <div class="chapter-content">
    <div v-if="showToolbar" class="chapter-toolbar">
      <template v-if="!isEditing">
        <button
          type="button"
          class="toolbar-btn"
          :disabled="isBusy"
          @click="beginEdit"
        >
          編輯
        </button>
        <button
          type="button"
          class="toolbar-btn"
          :disabled="isBusy"
          @click="handleRewind"
        >
          倒回至此
        </button>
        <button
          type="button"
          class="toolbar-btn"
          :disabled="isBusy"
          @click="handleBranch"
        >
          從此分支
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="toolbar-btn"
          :disabled="isBusy"
          @click="saveEdit"
        >
          儲存
        </button>
        <button
          type="button"
          class="toolbar-btn"
          :disabled="isBusy"
          @click="cancelEdit"
        >
          取消
        </button>
      </template>
      <span v-if="errorMessage" class="toolbar-error">{{ errorMessage }}</span>
    </div>

    <textarea
      v-if="isEditing"
      v-model="editBuffer"
      class="chapter-editor"
      :disabled="isBusy"
      rows="20"
    ></textarea>

    <template v-else>
      <template v-for="(token, idx) in tokens" :key="idx">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="token.type === 'html'" v-html="token.content"></div>
        <VentoErrorCard v-else-if="token.type === 'vento-error'" v-bind="token.data" />
      </template>
    </template>
  </div>
</template>

<style scoped>
.chapter-content {
  padding: 0 1rem;
}

.chapter-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-block-end: 1px dashed var(--border-inner);
}

.toolbar-btn {
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--border-inner);
  border-radius: 4px;
  background: var(--item-bg);
  color: var(--text-main);
  cursor: pointer;
  font-size: 0.85rem;
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--border-inner);
}

.toolbar-error {
  color: var(--text-italic);
  font-size: 0.85rem;
}

.chapter-editor {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--border-inner);
  border-radius: 4px;
  background: var(--item-bg);
  color: var(--text-main);
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.6;
  resize: vertical;
}

.chapter-content :deep(p) {
  margin-bottom: 0.8em;
  line-height: 1.8;
  text-shadow: var(--shadow-width) var(--shadow-width) 4px var(--shadow-color);
}

.chapter-content :deep(em) {
  color: var(--text-italic);
}

.chapter-content :deep(u) {
  color: var(--text-underline);
}

.chapter-content :deep(blockquote) {
  border-left: 3px solid var(--text-quote);
  padding-left: 1em;
  color: var(--text-quote);
}

.chapter-content :deep(code) {
  border-radius: 3px;
  background: var(--item-bg);
  padding: 0.1em 0.3em;
  font-size: 0.9em;
}

.chapter-content :deep(hr) {
  margin: 2rem auto;
  border: none;
  border-block-start: 0.1875rem double var(--border-inner);
  overflow: visible;
  text-align: center;
}

.chapter-content :deep(hr)::after {
  position: relative;
  inset-block-start: -1.25rem;
  content: "💕";
  color: var(--border-inner);
  font-size: 1.5rem;
}
</style>

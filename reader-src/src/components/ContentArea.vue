<script setup lang="ts">
import { ref, watch } from "vue";
import type { StatusBarProps } from "@/types";
import { useChapterNav } from "@/composables/useChapterNav";
import { useMarkdownRenderer } from "@/composables/useMarkdownRenderer";
import ChapterContent from "./ChapterContent.vue";
import Sidebar from "./Sidebar.vue";
import StatusBar from "./StatusBar.vue";

const {
  currentContent,
  isLastChapter,
} = useChapterNav();

const { renderChapter } = useMarkdownRenderer();

const statusPanels = ref<StatusBarProps[]>([]);

// Extract status tokens from the render to display in sidebar
watch(
  [currentContent, isLastChapter],
  ([content, isLast]) => {
    if (!content) {
      statusPanels.value = [];
      return;
    }
    const tokens = renderChapter(content, { isLastChapter: isLast });
    statusPanels.value = tokens
      .filter((t): t is { type: "status"; data: StatusBarProps } => t.type === "status")
      .map((t) => t.data);
  },
  { immediate: true },
);

function handleOptionSelect(text: string) {
  emit("option-select", text);
}

const emit = defineEmits<{ "option-select": [text: string] }>();
</script>

<template>
  <div class="content-wrapper">
    <ChapterContent
      v-if="currentContent"
      :raw-markdown="currentContent"
      :is-last-chapter="isLastChapter"
      @option-select="handleOptionSelect"
    />
    <div v-else class="welcome-content">
      <section class="welcome-section">
        <h1 class="welcome-title">HeartReverie 浮心夜夢</h1>
        <p class="welcome-text">
          點擊上方「選擇資料夾」按鈕，選取包含章節
          <code class="welcome-code">.md</code> 檔案的資料夾以開始閱讀。
        </p>
      </section>
    </div>

    <Sidebar>
      <StatusBar
        v-for="(panel, idx) in statusPanels"
        :key="idx"
        v-bind="panel"
      />
    </Sidebar>
  </div>
</template>

<style scoped>
.content-wrapper {
  display: grid;
  grid-template-columns: minmax(0, 48rem) 1fr;
  align-items: start;
  gap: 1.5rem;
  margin: 0 auto;
  width: 100%;
  max-width: 80rem;
}

.content-wrapper:has(.sidebar:empty) {
  grid-template-columns: 1fr;
}

@media (max-width: 767px) {
  .content-wrapper {
    grid-template-columns: 1fr;
  }
}

.welcome-content {
  padding: 0 1rem;
}

.welcome-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 1rem;
  min-height: calc(100vh - 10rem);
}

.welcome-title {
  font-size: 1.875rem;
  font-weight: bold;
  color: var(--text-title);
}

.welcome-text {
  font-size: 1.125rem;
  color: var(--text-main);
}

.welcome-code {
  padding: 0 0.25rem;
  border-radius: 4px;
  background: var(--item-bg);
}
</style>

<script setup lang="ts">
import { ref, watchPostEffect } from "vue";
import { useChapterNav } from "@/composables/useChapterNav";
import ChapterContent from "./ChapterContent.vue";
import Sidebar from "./Sidebar.vue";

const {
  currentContent,
  isLastChapter,
} = useChapterNav();

const contentRef = ref<HTMLElement | null>(null);

// Relocate plugin-rendered .plugin-sidebar elements from content to sidebar.
// Any plugin can opt into sidebar placement by adding the .plugin-sidebar class.
watchPostEffect(() => {
  // Track reactive deps so the effect re-runs on chapter changes
  currentContent.value;
  isLastChapter.value;

  const wrapper = contentRef.value;
  if (!wrapper) return;

  const sidebar = wrapper.querySelector(".sidebar");
  if (!sidebar) return;

  sidebar.innerHTML = "";
  const panels = wrapper.querySelectorAll(".plugin-sidebar");
  panels.forEach((panel) => sidebar.appendChild(panel));
});
</script>

<template>
  <div ref="contentRef" class="content-wrapper">
    <ChapterContent
      v-if="currentContent"
      :raw-markdown="currentContent"
      :is-last-chapter="isLastChapter"
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

    <Sidebar />
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

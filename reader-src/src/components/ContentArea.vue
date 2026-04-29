<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useChapterNav } from "@/composables/useChapterNav";
import { usePlugins } from "@/composables/usePlugins";
import ChapterContent from "./ChapterContent.vue";
import Sidebar from "./Sidebar.vue";

const {
  currentContent,
  isLastChapter,
  renderEpoch,
} = useChapterNav();
const { pluginsReady, pluginsSettled } = usePlugins();

const contentRef = ref<HTMLElement | null>(null);

// Relocate plugin-rendered .plugin-sidebar elements from content to sidebar.
// Any plugin can opt into sidebar placement by adding the .plugin-sidebar class.
// The watch tracks renderEpoch so byte-identical content commits and
// pluginsReady transitions both trigger a re-relocation; the sidebar is
// always cleared first so stale panels from a previous chapter cannot leak.
const sidebarTriggers = computed(() => [
  currentContent.value,
  isLastChapter.value,
  pluginsReady.value,
  pluginsSettled.value,
  renderEpoch.value,
]);

watch(
  sidebarTriggers,
  async () => {
    await nextTick();
    const wrapper = contentRef.value;
    if (!wrapper) return;
    const sidebar = wrapper.querySelector(".sidebar");
    if (!sidebar) return;

    sidebar.innerHTML = "";

    if (!pluginsSettled.value || !currentContent.value) return;

    const panels = wrapper.querySelectorAll(".plugin-sidebar");
    panels.forEach((panel) => sidebar.appendChild(panel));
  },
  { flush: "post", immediate: true },
);
</script>

<template>
  <div ref="contentRef" class="content-wrapper">
    <ChapterContent
      v-if="pluginsSettled && currentContent"
      :raw-markdown="currentContent"
      :is-last-chapter="isLastChapter"
    />
    <div v-else-if="!pluginsSettled && currentContent" class="content-loading">
      載入中…
    </div>
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

.content-loading {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-main);
  opacity: 0.7;
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

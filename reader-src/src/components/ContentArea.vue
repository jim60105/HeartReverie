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
// pluginsReady transitions both trigger a re-relocation.
//
// To prevent destroying already-relocated panels when a non-content trigger
// (e.g. pluginsReady) fires without a v-html remount, the sidebar is only
// cleared when (a) content-related triggers changed, or (b) new panels are
// found in the content area waiting for relocation.
let prevContent: string | null | undefined;
let prevEpoch: number | undefined;

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

    if (!pluginsSettled.value || !currentContent.value) {
      sidebar.innerHTML = "";
      prevContent = currentContent.value;
      prevEpoch = renderEpoch.value;
      return;
    }

    // Detect whether content-related triggers changed (v-html was remounted).
    const contentChanged =
      prevContent === undefined ||
      prevContent !== currentContent.value ||
      prevEpoch !== renderEpoch.value;
    prevContent = currentContent.value;
    prevEpoch = renderEpoch.value;

    // Look for panels in the content area that haven't been relocated yet.
    const panels = [...wrapper.querySelectorAll(".plugin-sidebar")].filter(
      (el) => !sidebar.contains(el),
    );

    if (panels.length > 0) {
      const sidebarHasPanels = sidebar.querySelector(".plugin-sidebar") !== null;
      if (contentChanged || !sidebarHasPanels) {
        // Content changed or sidebar is empty — full relocation.
        sidebar.innerHTML = "";
        panels.forEach((panel) => sidebar.appendChild(panel));
      } else {
        // Same content re-render produced duplicate panels while the sidebar
        // already holds (possibly populated) panels. Remove the duplicates
        // from content so the next watch trigger doesn't replace the sidebar.
        panels.forEach((panel) => panel.remove());
      }
    } else if (contentChanged) {
      // Content changed but no new panels — clear stale panels.
      sidebar.innerHTML = "";
    }
    // Non-content trigger with no new panels: keep existing sidebar intact.
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
          請從上方
          <code class="welcome-code">📖 故事選擇</code>
          載入或建立故事章節以開始閱讀。
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

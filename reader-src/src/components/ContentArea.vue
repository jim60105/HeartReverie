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
// pluginsReady transitions both trigger a re-relocation pass.
//
// Content-change detection uses the raw text of currentContent (not
// renderEpoch) so that epoch bumps that merely re-render the same markdown
// (e.g. from redundant commitContent calls via WebSocket/polling) do NOT
// destroy already-populated sidebar panels. Duplicate empty panels produced
// by such re-renders are removed from content instead.
let prevContentKey: string | undefined;

const sidebarTriggers = computed(() => [
  currentContent.value,
  isLastChapter.value,
  pluginsReady.value,
  pluginsSettled.value,
  renderEpoch.value,
]);

watch(
  sidebarTriggers,
  () => {
    nextTick(() => {
      // Read latest reactive state inside nextTick so overlapping callbacks
      // always process the final settled state (idempotent).
      const settled = pluginsSettled.value;
      const content = currentContent.value;

      const wrapper = contentRef.value;
      if (!wrapper) return;
      const sidebar = wrapper.querySelector(".sidebar");
      if (!sidebar) return;

      if (!settled || !content) {
        sidebar.innerHTML = "";
        prevContentKey = undefined;
        return;
      }

      // Semantic content change = the actual chapter text changed (e.g.
      // navigation to a different chapter). Epoch-only bumps with identical
      // text are NOT treated as content changes.
      const contentChanged =
        prevContentKey === undefined || prevContentKey !== content;
      prevContentKey = content;

      // Look for panels in the content area that haven't been relocated yet.
      const panels = [...wrapper.querySelectorAll(".plugin-sidebar")].filter(
        (el) => !sidebar.contains(el),
      );

      if (panels.length > 0) {
        const existingPanels = [
          ...sidebar.querySelectorAll(".plugin-sidebar"),
        ];
        const sidebarHasPanels = existingPanels.length > 0;
        // During streaming, the chapter text grows on every chunk so
        // `contentChanged` is true, but the rendered sidebar panel HTML often
        // stays identical (e.g. <status> block unchanged). Compare panel
        // outerHTML against what's already in the sidebar; if identical, just
        // drop the duplicates from content and leave the sidebar untouched.
        // This avoids the height oscillation that drifts scroll mid-streaming.
        const panelsKey = panels.map((p) => p.outerHTML).join("\u0000");
        const existingKey = existingPanels.map((p) => p.outerHTML).join("\u0000");
        const panelsUnchanged = sidebarHasPanels && panelsKey === existingKey;

        if (panelsUnchanged) {
          panels.forEach((panel) => panel.remove());
        } else if (contentChanged || !sidebarHasPanels) {
          // Content changed or sidebar is empty — full relocation.
          sidebar.innerHTML = "";
          panels.forEach((panel) => sidebar.appendChild(panel));
        } else {
          // Same content re-render produced different panels while the sidebar
          // already holds populated panels. This happens during transient
          // re-render states (e.g. plugin frontend-render hasn't re-injected
          // its full HTML yet). Drop the (possibly placeholder) candidates
          // from content; the next watch trigger with the full re-render will
          // either match (no-op) or be picked up by `contentChanged`.
          panels.forEach((panel) => panel.remove());
        }
      } else if (contentChanged) {
        // Content changed but no new panels — clear stale panels.
        sidebar.innerHTML = "";
      }
      // Non-content trigger with no new panels: keep existing sidebar intact.
    });
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

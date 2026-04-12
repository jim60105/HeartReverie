<script setup lang="ts">
import { ref, computed } from "vue";
import { useChapterNav } from "@/composables/useChapterNav";
import { useFileReader } from "@/composables/useFileReader";
import StorySelector from "./StorySelector.vue";
import PromptEditor from "./PromptEditor.vue";
import PromptPreview from "./PromptPreview.vue";

const {
  currentIndex,
  totalChapters,
  isFirst,
  isLast,
  mode,
  folderName,
  next,
  previous,
  loadFromFSA,
  loadFromBackend,
  reloadToLast,
  getBackendContext,
} = useChapterNav();

const { isSupported, openDirectory, directoryHandle } = useFileReader();

const showEditor = ref(false);
const showPreview = ref(false);
const mobileMenuOpen = ref(false);

const hasChapters = computed(() => totalChapters.value > 0);

const progressText = computed(() =>
  hasChapters.value ? `${currentIndex.value + 1} / ${totalChapters.value}` : "0 / 0",
);

async function handleFolderSelect() {
  await openDirectory();
  if (directoryHandle.value) {
    await loadFromFSA(directoryHandle.value);
  }
}

async function handleStoryLoad(series: string, story: string) {
  await loadFromBackend(series, story);
}

function handleEditorClose() {
  showEditor.value = false;
}

function handlePreviewOpen() {
  showEditor.value = false;
  showPreview.value = true;
}

function handlePreviewClose() {
  showPreview.value = false;
}

async function handleReload() {
  if (mode.value === "fsa" && directoryHandle.value) {
    await loadFromFSA(directoryHandle.value);
  } else if (mode.value === "backend") {
    await reloadToLast();
  }
}

const previewContext = computed(() => {
  const ctx = getBackendContext();
  return {
    series: ctx.series ?? "",
    story: ctx.story ?? "",
  };
});
</script>

<template>
  <header class="app-header">
    <div class="header-row">
      <button
        v-if="isSupported"
        class="themed-btn header-btn"
        @click="handleFolderSelect"
      >
        📂 選擇資料夾
      </button>

      <StorySelector @load="handleStoryLoad" />

      <span class="folder-name">{{ folderName || '尚未選擇資料夾' }}</span>

      <button
        v-if="hasChapters"
        class="themed-btn header-btn header-btn--reload"
        title="重新載入資料夾"
        @click="handleReload"
      >
        🔄
      </button>

      <span class="header-spacer"></span>

      <template v-if="getBackendContext().isBackendMode">
        <button
          class="themed-btn header-btn"
          @click="showEditor = true"
        >
          ⚙️ Prompt
        </button>
      </template>

      <template v-if="hasChapters">
        <button
          class="themed-btn header-btn"
          :disabled="isFirst"
          @click="previous"
        >
          ← 上一章
        </button>
        <span class="chapter-progress">{{ progressText }}</span>
        <button
          class="themed-btn header-btn"
          :disabled="isLast"
          @click="next"
        >
          下一章 →
        </button>
      </template>

      <!-- Mobile hamburger -->
      <button
        class="hamburger-btn"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        ☰
      </button>
    </div>

    <!-- Panels -->
    <Teleport to="body">
      <div v-if="showPreview" class="panel-backdrop" @click="handlePreviewClose"></div>
      <PromptPreview
        v-if="showPreview"
        :series="previewContext.series"
        :story="previewContext.story"
        message="(preview)"
        @close="handlePreviewClose"
      />
      <PromptEditor
        v-if="showEditor"
        @close="handleEditorClose"
        @preview="handlePreviewOpen"
      />
    </Teleport>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--header-bg);
  border-bottom: 1px solid var(--header-border);
  padding: 4px 12px;
}

.header-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.header-btn {
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--text-name);
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.header-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.header-btn--reload {
  padding: 4px 8px;
}

.folder-name {
  color: var(--text-label);
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-antique), var(--font-system-ui);
}

.header-spacer {
  flex-grow: 1;
}

.chapter-progress {
  color: var(--text-label);
  font-size: 0.875rem;
}

.hamburger-btn {
  display: none;
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--text-name);
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1.2rem;
}

.panel-backdrop {
  position: fixed;
  z-index: 999;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}

@media (max-width: 767px) {
  .hamburger-btn {
    display: block;
  }
}
</style>

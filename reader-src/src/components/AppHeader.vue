<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useChapterNav } from "@/composables/useChapterNav";
import { useFileReader } from "@/composables/useFileReader";
import StorySelector from "./StorySelector.vue";

const router = useRouter();

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
  reloadToLast,
  getBackendContext,
} = useChapterNav();

const { isSupported, openDirectory, directoryHandle } = useFileReader();

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

async function handleReload() {
  if (mode.value === "fsa" && directoryHandle.value) {
    await loadFromFSA(directoryHandle.value);
  } else if (mode.value === "backend") {
    await reloadToLast();
  }
}

function openSettings() {
  router.push({ name: "settings-prompt-editor" });
}
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

      <StorySelector />

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
          class="themed-btn header-btn header-btn--icon"
          title="設定"
          @click="openSettings"
        >
          ⚙️
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

.header-btn--icon {
  padding: 4px 8px;
  font-size: 1rem;
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

@media (max-width: 767px) {
  .hamburger-btn {
    display: block;
  }
}
</style>

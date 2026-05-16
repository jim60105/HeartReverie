<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useChapterNav } from "@/composables/useChapterNav";
import StorySelector from "./StorySelector.vue";
import ToolsMenu from "./ToolsMenu.vue";

const router = useRouter();

const {
  currentIndex,
  chapters,
  totalChapters,
  isFirst,
  isLast,
  folderName,
  next,
  previous,
  goToFirst,
  goToLast,
  reloadToLast,
} = useChapterNav();

const hasChapters = computed(() => totalChapters.value > 0);

const currentChapterNum = computed(() =>
  chapters.value[currentIndex.value]?.number ?? currentIndex.value + 1,
);
const firstChapterNum = computed(() =>
  chapters.value[0]?.number ?? 1,
);
const prevChapterNum = computed(() =>
  chapters.value[Math.max(0, currentIndex.value - 1)]?.number ?? currentChapterNum.value,
);
const nextChapterNum = computed(() =>
  chapters.value[Math.min(chapters.value.length - 1, currentIndex.value + 1)]?.number ?? currentChapterNum.value,
);
const lastChapterNum = computed(() =>
  chapters.value[chapters.value.length - 1]?.number ?? totalChapters.value,
);

const progressText = computed(() =>
  hasChapters.value ? `${currentIndex.value + 1} / ${totalChapters.value}` : "0 / 0",
);

async function handleReload() {
  await reloadToLast();
}

function openSettings() {
  router.push({ name: "settings-prompt-editor" });
}
</script>

<template>
  <header class="app-header">
    <div class="header-row">
      <StorySelector />

      <span class="folder-name">{{ folderName || '尚未選擇故事' }}</span>

      <button
        v-if="hasChapters"
        class="themed-btn header-btn header-btn--icon"
        title="重新載入資料夾"
        @click="handleReload"
      >
        🔄
      </button>

      <span class="header-spacer"></span>

      <ToolsMenu />

      <button
        class="themed-btn header-btn header-btn--icon"
        title="設定"
        @click="openSettings"
      >
        ⚙️
      </button>

      <nav v-if="hasChapters" data-chapter-list>
        <button
          class="themed-btn header-btn header-btn--icon header-btn--boundary"
          :disabled="isFirst"
          :data-chapter-number="firstChapterNum"
          title="第一章"
          aria-label="第一章"
          @click="goToFirst"
        >
          ⇇
        </button>
        <button
          class="themed-btn header-btn"
          :disabled="isFirst"
          :data-chapter-number="prevChapterNum"
          @click="previous"
        >
          ← 上一章
        </button>
        <span
          class="chapter-progress"
          :data-chapter-number="currentChapterNum"
        >{{ progressText }}</span>
        <button
          class="themed-btn header-btn"
          :disabled="isLast"
          :data-chapter-number="nextChapterNum"
          @click="next"
        >
          下一章 →
        </button>
        <button
          class="themed-btn header-btn header-btn--icon header-btn--boundary"
          :disabled="isLast"
          :data-chapter-number="lastChapterNum"
          title="最後一章"
          aria-label="最後一章"
          @click="goToLast"
        >
          ⇉
        </button>
      </nav>
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
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}

.header-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.header-btn--icon {
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
  white-space: nowrap;
}

[data-chapter-list] {
  display: contents;
}

@media (max-width: 767px) {
  .header-row {
    flex-wrap: nowrap;
  }
  .folder-name {
    display: none;
  }
  .header-btn--boundary {
    display: none;
  }
}
</style>

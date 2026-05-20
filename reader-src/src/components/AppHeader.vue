<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useChapterNav } from "@/composables/useChapterNav";
import { isReadingRoute } from "@/router/isReadingRoute";
import StorySelector from "./StorySelector.vue";
import ToolsMenu from "./ToolsMenu.vue";

const router = useRouter();
const route = useRoute();

const showReaderControls = computed(() => isReadingRoute(route.path));

const headerRef = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

function syncHeaderHeight(el: HTMLElement) {
  const h = Math.round(el.getBoundingClientRect().height);
  if (h > 0) {
    document.documentElement.style.setProperty("--header-height", `${h}px`);
  }
}

onMounted(() => {
  const el = headerRef.value;
  if (!el) return;
  syncHeaderHeight(el);
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => syncHeaderHeight(el));
    resizeObserver.observe(el);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

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
  <header ref="headerRef" class="app-header">
    <div class="header-row">
      <slot name="leading" />

      <StorySelector />

      <span class="folder-name">{{ folderName || '尚未選擇故事' }}</span>

      <button
        v-if="showReaderControls && hasChapters"
        class="themed-btn header-btn header-btn--icon"
        title="重新載入資料夾"
        @click="handleReload"
      >
        🔄
      </button>

      <span class="header-spacer"></span>

      <template v-if="showReaderControls">
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
          aria-label="上一章"
          @click="previous"
        >
          ←<span class="nav-label"> 上一章</span>
        </button>
        <span
          class="chapter-progress"
          :data-chapter-number="currentChapterNum"
        >{{ progressText }}</span>
        <button
          class="themed-btn header-btn"
          :disabled="isLast"
          :data-chapter-number="nextChapterNum"
          aria-label="下一章"
          @click="next"
        >
          <span class="nav-label">下一章 </span>→
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
      </template>
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

:slotted(.header-btn) {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
}

.header-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
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
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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

@media (max-width: 409px) {
  .nav-label {
    display: none;
  }
}
</style>

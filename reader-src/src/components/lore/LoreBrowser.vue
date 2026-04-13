<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useLoreApi } from "@/composables/useLoreApi";
import { useStorySelector } from "@/composables/useStorySelector";
import LoreEditor from "./LoreEditor.vue";

const {
  passages,
  allTags,
  loading,
  error,
  fetchPassages,
  fetchTags,
} = useLoreApi();
const { selectedSeries, selectedStory } = useStorySelector();

const activeScope = ref<"global" | "series" | "story">("global");
const activeTag = ref<string>("");
const editingPassage = ref<{
  path: string;
  frontmatter: { tags: string[]; priority: number; enabled: boolean };
  content: string;
} | null>(null);
const isCreating = ref(false);

const scopes = [
  { key: "global" as const, label: "全域" },
  { key: "series" as const, label: "系列" },
  { key: "story" as const, label: "故事" },
];

const canUseSeries = computed(() => !!selectedSeries.value);
const canUseStory = computed(
  () => !!selectedSeries.value && !!selectedStory.value,
);

const showEditor = computed(() => isCreating.value || !!editingPassage.value);

function reload() {
  fetchPassages(
    activeScope.value,
    selectedSeries.value || undefined,
    selectedStory.value || undefined,
    activeTag.value || undefined,
  );
  fetchTags();
}

// Reload when scope, tag, or story selection changes
watch([activeScope, activeTag, selectedSeries, selectedStory], () => {
  // Reset to global if current scope is no longer valid
  if (activeScope.value === "series" && !canUseSeries.value) {
    activeScope.value = "global";
    return; // The scope change will re-trigger this watcher
  }
  if (activeScope.value === "story" && !canUseStory.value) {
    activeScope.value = canUseSeries.value ? "series" : "global";
    return;
  }
  reload();
});

// Reload on mount
reload();

function selectScope(scope: "global" | "series" | "story") {
  if (scope === "series" && !canUseSeries.value) return;
  if (scope === "story" && !canUseStory.value) return;
  activeScope.value = scope;
}

function toggleTag(tag: string) {
  activeTag.value = activeTag.value === tag ? "" : tag;
}

function openPassage(passage: { relativePath: string }) {
  isCreating.value = false;
  editingPassage.value = {
    path: passage.relativePath,
    frontmatter: { tags: [], priority: 0, enabled: true },
    content: "",
  };
}

function openCreate() {
  editingPassage.value = null;
  isCreating.value = true;
}

function handleSaved() {
  editingPassage.value = null;
  isCreating.value = false;
  reload();
}

function handleDeleted() {
  editingPassage.value = null;
  isCreating.value = false;
  reload();
}

function handleCancelled() {
  editingPassage.value = null;
  isCreating.value = false;
}
</script>

<template>
  <div class="lore-browser" :class="{ 'lore-browser--split': showEditor }">
    <!-- Passage list panel -->
    <div class="browser-list">
      <div class="browser-header">
        <h2 class="browser-title">典籍</h2>
        <button class="toolbar-btn toolbar-btn--primary" @click="openCreate">
          ＋ 新增篇章
        </button>
      </div>

      <!-- Scope tabs -->
      <div class="scope-tabs">
        <button
          v-for="s in scopes"
          :key="s.key"
          class="scope-tab"
          :class="{
            'scope-tab--active': activeScope === s.key,
            'scope-tab--disabled':
              (s.key === 'series' && !canUseSeries) ||
              (s.key === 'story' && !canUseStory),
          }"
          :disabled="
            (s.key === 'series' && !canUseSeries) ||
            (s.key === 'story' && !canUseStory)
          "
          :title="
            s.key === 'series' && !canUseSeries
              ? '請先選擇系列'
              : s.key === 'story' && !canUseStory
                ? '請先選擇故事'
                : ''
          "
          @click="selectScope(s.key)"
        >
          {{ s.label }}
        </button>
      </div>

      <!-- Tag filter chips -->
      <div v-if="allTags.length" class="tag-chips">
        <button
          v-for="tag in allTags"
          :key="tag"
          class="tag-chip"
          :class="{ 'tag-chip--active': activeTag === tag }"
          @click="toggleTag(tag)"
        >
          {{ tag }}
        </button>
      </div>

      <!-- Error message -->
      <div v-if="error" class="browser-error">{{ error }}</div>

      <!-- Loading indicator -->
      <div v-if="loading" class="browser-loading">載入中…</div>

      <!-- Passage cards -->
      <div v-else-if="passages.length" class="passage-list">
        <button
          v-for="p in passages"
          :key="p.relativePath"
          class="passage-card"
          :class="{
            'passage-card--active':
              editingPassage?.path === p.relativePath && !isCreating,
          }"
          @click="openPassage(p)"
        >
          <div class="passage-name">{{ p.relativePath }}</div>
          <div class="passage-meta">
            <span
              v-for="tag in p.tags"
              :key="tag"
              class="passage-tag"
            >
              {{ tag }}
            </span>
            <span class="passage-priority" title="優先序">⬆ {{ p.priority }}</span>
            <span
              class="passage-enabled"
              :class="p.enabled ? 'passage-enabled--on' : 'passage-enabled--off'"
            >
              {{ p.enabled ? "啟用" : "停用" }}
            </span>
          </div>
        </button>
      </div>

      <!-- Empty state -->
      <div v-else class="browser-empty">
        此範圍尚無篇章，點擊「新增篇章」建立第一個篇章。
      </div>
    </div>

    <!-- Editor panel -->
    <div v-if="showEditor" class="browser-editor">
      <LoreEditor
        v-if="isCreating"
        :scope="activeScope"
        :series="selectedSeries || undefined"
        :story="selectedStory || undefined"
        @saved="handleSaved"
        @cancelled="handleCancelled"
        @deleted="handleDeleted"
      />
      <LoreEditor
        v-else-if="editingPassage"
        :key="editingPassage.path"
        :scope="activeScope"
        :path="editingPassage.path"
        :series="selectedSeries || undefined"
        :story="selectedStory || undefined"
        @saved="handleSaved"
        @cancelled="handleCancelled"
        @deleted="handleDeleted"
      />
    </div>
  </div>
</template>

<style scoped>
.lore-browser {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

.lore-browser--split {
  flex-direction: row;
}

.browser-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.browser-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--border-color);
  padding-left: 16px;
}

.browser-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.browser-title {
  margin: 0;
  color: var(--text-name);
  font-size: 1.2em;
  font-family: var(--font-antique), var(--font-system-ui);
}

/* Scope tabs */
.scope-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 8px;
}

.scope-tab {
  cursor: pointer;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 6px 16px;
  color: var(--text-label);
  font-size: 0.85em;
  font-family: var(--font-antique), var(--font-system-ui);
  transition: background 0.15s, border-color 0.15s;
}

.scope-tab:hover:not(:disabled) {
  background: var(--btn-hover-bg);
}

.scope-tab--active {
  border-color: var(--text-title);
  background: rgba(180, 30, 60, 0.22);
  color: var(--text-name);
}

.scope-tab--disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Tag chips */
.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-chip {
  cursor: pointer;
  border: 1px solid var(--item-border);
  border-radius: 12px;
  background: rgba(224, 80, 112, 0.12);
  padding: 2px 10px;
  color: var(--text-label);
  font-size: 0.8em;
  font-family: var(--font-antique), var(--font-system-ui);
  transition: background 0.15s;
}

.tag-chip:hover {
  background: rgba(224, 80, 112, 0.3);
}

.tag-chip--active {
  border-color: var(--text-title);
  background: rgba(180, 30, 60, 0.35);
  color: var(--text-name);
}

/* Passage list */
.passage-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}

.passage-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  border: 1px solid var(--item-border);
  border-radius: 8px;
  background: var(--item-bg);
  padding: 10px 12px;
  text-align: left;
  color: var(--text-main);
  font-family: var(--font-antique), var(--font-system-ui);
  transition: background 0.15s, border-color 0.15s;
}

.passage-card:hover {
  background: rgba(180, 30, 60, 0.12);
  border-color: var(--btn-hover-border);
}

.passage-card--active {
  border-color: var(--text-title);
  background: rgba(180, 30, 60, 0.22);
}

.passage-name {
  color: var(--text-name);
  font-size: 0.95em;
}

.passage-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.passage-tag {
  border: 1px solid rgba(180, 30, 60, 0.4);
  border-radius: 10px;
  background: rgba(180, 30, 60, 0.15);
  padding: 1px 8px;
  color: var(--text-label);
  font-size: 0.75em;
}

.passage-priority {
  color: var(--text-label);
  font-size: 0.75em;
  opacity: 0.7;
}

.passage-enabled {
  font-size: 0.75em;
}

.passage-enabled--on {
  color: #4ade80;
}

.passage-enabled--off {
  color: #888;
}

/* States */
.browser-error {
  border: 1px solid #dc2626;
  border-radius: 6px;
  background: rgba(220, 38, 38, 0.12);
  padding: 8px 12px;
  color: #fca5a5;
  font-size: 0.85em;
}

.browser-loading {
  color: var(--text-label);
  font-size: 0.9em;
  font-family: var(--font-antique), var(--font-system-ui);
  padding: 16px 0;
  text-align: center;
}

.browser-empty {
  color: var(--text-label);
  font-size: 0.9em;
  font-family: var(--font-antique), var(--font-system-ui);
  padding: 24px 0;
  text-align: center;
  opacity: 0.7;
}

/* Shared toolbar button styles */
.toolbar-btn {
  cursor: pointer;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 6px 14px;
  color: var(--text-label);
  font-size: 0.85em;
  font-family: var(--font-antique), var(--font-system-ui);
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.toolbar-btn:hover {
  background: var(--btn-hover-bg);
}

.toolbar-btn--primary {
  border-color: var(--text-title);
  color: var(--text-name);
}

/* Responsive: stack on mobile */
@media (max-width: 767px) {
  .lore-browser--split {
    flex-direction: column;
  }

  .browser-editor {
    border-left: none;
    border-top: 1px solid var(--border-color);
    padding-left: 0;
    padding-top: 16px;
  }
}
</style>

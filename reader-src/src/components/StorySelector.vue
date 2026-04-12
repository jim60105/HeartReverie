<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useStorySelector } from "@/composables/useStorySelector";

const {
  seriesList,
  storyList,
  selectedSeries,
  selectedStory,
  fetchSeries,
  fetchStories,
  createStory,
  navigateToStory,
} = useStorySelector();

const newStoryName = ref("");
const isOpen = ref(false);

onMounted(() => {
  fetchSeries();
});

async function handleCreate() {
  const series = selectedSeries.value;
  const name = newStoryName.value.trim();
  if (!series || !name) return;

  await createStory(series, name);
  selectedStory.value = name;
  newStoryName.value = "";
  navigateToStory(series, name);
  isOpen.value = false;
}

function handleLoad() {
  const series = selectedSeries.value;
  const story = selectedStory.value;
  if (!series || !story) return;
  navigateToStory(series, story);
  isOpen.value = false;
}
</script>

<template>
  <details
    id="story-selector-details"
    class="story-selector"
    :open="isOpen || undefined"
    @toggle="isOpen = ($event.target as HTMLDetailsElement).open"
  >
    <summary class="themed-btn selector-toggle">
      📖 故事選擇
    </summary>
    <div class="selector-dropdown">
      <div class="selector-fields">
        <label class="field-label">系列</label>
        <select v-model="selectedSeries" class="selector-select">
          <option value="">-- 選擇系列 --</option>
          <option v-for="s in seriesList" :key="s" :value="s">{{ s }}</option>
        </select>

        <label class="field-label">故事</label>
        <select v-model="selectedStory" class="selector-select">
          <option value="">-- 選擇故事 --</option>
          <option v-for="s in storyList" :key="s" :value="s">{{ s }}</option>
        </select>

        <label class="field-label">新故事名稱</label>
        <input
          v-model="newStoryName"
          type="text"
          placeholder="輸入新故事名稱…"
          class="selector-input"
        >

        <div class="selector-actions">
          <button class="themed-btn action-btn" @click="handleCreate">
            ✨ 建立
          </button>
          <button class="themed-btn action-btn" @click="handleLoad">
            📥 載入
          </button>
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
.story-selector {
  position: relative;
}

.selector-toggle {
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--text-name);
  cursor: pointer;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  list-style: none;
}

.selector-toggle::before {
  display: none !important;
}

.selector-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  z-index: 20;
  background: #1a0810;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 10px;
  min-width: 280px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
}

.selector-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  color: var(--text-label);
  font-size: 0.75rem;
}

.selector-select,
.selector-input {
  background: var(--item-bg);
  border: 1px solid var(--item-border);
  border-radius: 6px;
  padding: 4px 8px;
  color: var(--text-main);
  font-size: var(--font-base);
  font-family: var(--font-system-ui);
}

.selector-actions {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}

.action-btn {
  flex: 1;
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--text-name);
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}
</style>

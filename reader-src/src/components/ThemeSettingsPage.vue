<script setup lang="ts">
import { onMounted } from "vue";
import { useTheme } from "@/composables/useTheme";

const { currentThemeId, themes, listThemes, selectTheme } = useTheme();

onMounted(async () => {
  await listThemes();
});

async function handleChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  await selectTheme(target.value);
}
</script>

<template>
  <div class="theme-settings">
    <h2>主題設定</h2>
    <div class="theme-select-group">
      <label for="theme-select">選擇主題</label>
      <select
        id="theme-select"
        :value="currentThemeId"
        @change="handleChange"
      >
        <option
          v-for="theme in themes"
          :key="theme.id"
          :value="theme.id"
        >
          {{ theme.label }}
        </option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.theme-settings {
  max-width: 480px;
}

.theme-settings h2 {
  color: var(--text-title);
  margin-bottom: 1.5rem;
  font-size: 1.2rem;
}

.theme-select-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.theme-select-group label {
  color: var(--text-label);
  font-size: 0.9rem;
}

.theme-select-group select {
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  border: 1px solid var(--btn-border);
  background: var(--btn-bg);
  color: var(--text-main);
  font-size: var(--font-base);
  cursor: pointer;
  outline: none;
  transition: border-color 0.2s;
}

.theme-select-group select:hover {
  border-color: var(--btn-hover-border);
}

.theme-select-group select:focus {
  border-color: var(--text-title);
}
</style>

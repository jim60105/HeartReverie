<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from "vue";
import { useStorySelector } from "@/composables/useStorySelector";
import { useStoryLlmConfig } from "@/composables/useStoryLlmConfig";
import { useNotification } from "@/composables/useNotification";
import type { StoryLlmConfig } from "@/types";

type FieldKey = keyof StoryLlmConfig;

interface FieldDef {
  key: FieldKey;
  label: string;
  type: "string" | "number";
  step?: string;
}

const FIELDS: FieldDef[] = [
  { key: "model", label: "模型 (model)", type: "string" },
  { key: "temperature", label: "溫度 (temperature)", type: "number", step: "0.01" },
  { key: "frequencyPenalty", label: "頻率懲罰 (frequency_penalty)", type: "number", step: "0.01" },
  { key: "presencePenalty", label: "存在懲罰 (presence_penalty)", type: "number", step: "0.01" },
  { key: "topK", label: "Top-K (top_k)", type: "number", step: "1" },
  { key: "topP", label: "Top-P (top_p)", type: "number", step: "0.01" },
  { key: "repetitionPenalty", label: "重複懲罰 (repetition_penalty)", type: "number", step: "0.01" },
  { key: "minP", label: "Min-P (min_p)", type: "number", step: "0.01" },
  { key: "topA", label: "Top-A (top_a)", type: "number", step: "0.01" },
];

const { seriesList, storyList, selectedSeries, selectedStory, fetchSeries, fetchStories } =
  useStorySelector();
const { overrides, loading, saving, error, loadConfig, saveConfig } = useStoryLlmConfig();
const { notify } = useNotification();

// Per-field enabled toggles + typed values
const enabledMap = reactive<Record<FieldKey, boolean>>({
  model: false,
  temperature: false,
  frequencyPenalty: false,
  presencePenalty: false,
  topK: false,
  topP: false,
  repetitionPenalty: false,
  minP: false,
  topA: false,
});

const valueMap = reactive<Record<FieldKey, string>>({
  model: "",
  temperature: "",
  frequencyPenalty: "",
  presencePenalty: "",
  topK: "",
  topP: "",
  repetitionPenalty: "",
  minP: "",
  topA: "",
});

const canSave = computed(
  () => !!selectedSeries.value && !!selectedStory.value && !loading.value && !saving.value,
);

function syncFromOverrides(source: StoryLlmConfig): void {
  for (const f of FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(source, f.key);
    enabledMap[f.key] = present;
    const v = source[f.key];
    valueMap[f.key] = v === undefined || v === null ? "" : String(v);
  }
}

async function handleLoad(): Promise<void> {
  if (!selectedSeries.value || !selectedStory.value) return;
  await loadConfig(selectedSeries.value, selectedStory.value);
  syncFromOverrides(overrides.value);
}

function collectPayload(): StoryLlmConfig | null {
  const payload: StoryLlmConfig = {};
  for (const f of FIELDS) {
    if (!enabledMap[f.key]) continue;
    const raw = valueMap[f.key].trim();
    if (f.type === "string") {
      if (raw === "") {
        notify({ title: "欄位錯誤", body: `${f.label} 不可為空`, level: "error" });
        return null;
      }
      (payload as Record<string, unknown>)[f.key] = raw;
    } else {
      const num = Number(raw);
      if (raw === "" || !Number.isFinite(num)) {
        notify({ title: "欄位錯誤", body: `${f.label} 必須為數字`, level: "error" });
        return null;
      }
      (payload as Record<string, unknown>)[f.key] = num;
    }
  }
  return payload;
}

async function handleSave(): Promise<void> {
  if (!canSave.value) return;
  const payload = collectPayload();
  if (payload === null) return;
  try {
    const persisted = await saveConfig(selectedSeries.value, selectedStory.value, payload);
    syncFromOverrides(persisted);
    notify({ title: "已儲存", body: "此故事的 LLM 設定已更新", level: "success" });
  } catch (e) {
    notify({
      title: "儲存失敗",
      body: e instanceof Error ? e.message : "未知錯誤",
      level: "error",
    });
  }
}

function handleReset(): void {
  syncFromOverrides(overrides.value);
}

onMounted(async () => {
  await fetchSeries();
  if (selectedSeries.value && !storyList.value.length) {
    await fetchStories(selectedSeries.value);
  }
  if (selectedSeries.value && selectedStory.value) {
    await handleLoad();
  }
});

watch(
  () => [selectedSeries.value, selectedStory.value] as const,
  async ([s, n], [ps, pn]) => {
    if (s && s !== ps) {
      await fetchStories(s);
    }
    if (s && n && (s !== ps || n !== pn)) {
      await handleLoad();
    }
  },
);

defineExpose({ handleSave, handleReset, enabledMap, valueMap });
</script>

<template>
  <div class="llm-settings-page">
    <h2 class="page-title">LLM 設定（依故事覆寫）</h2>
    <p class="page-hint">
      此處設定僅套用於選取的故事。未勾選的欄位將使用伺服器預設值。
    </p>

    <div class="selector-row">
      <label>
        系列
        <select v-model="selectedSeries">
          <option value="" disabled>請選擇系列</option>
          <option v-for="s in seriesList" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <label>
        故事
        <select v-model="selectedStory" :disabled="!selectedSeries">
          <option value="" disabled>請選擇故事</option>
          <option v-for="n in storyList" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
    </div>

    <div v-if="loading" class="status">載入中⋯</div>
    <div v-else-if="error" class="status error">讀取失敗：{{ error }}</div>

    <form v-if="selectedSeries && selectedStory && !loading" class="fields" @submit.prevent="handleSave">
      <div v-for="f in FIELDS" :key="f.key" class="field-row">
        <label class="field-toggle">
          <input type="checkbox" v-model="enabledMap[f.key]" />
          <span class="field-label">{{ f.label }}</span>
        </label>
        <input
          class="field-input"
          :type="f.type === 'number' ? 'number' : 'text'"
          :step="f.step"
          :disabled="!enabledMap[f.key]"
          v-model="valueMap[f.key]"
          :placeholder="enabledMap[f.key] ? '' : '使用預設值'"
        />
      </div>

      <div class="actions">
        <button type="button" class="btn" :disabled="saving" @click="handleReset">
          還原
        </button>
        <button type="button" class="btn primary" :disabled="!canSave" @click="handleSave">
          {{ saving ? "儲存中⋯" : "儲存" }}
        </button>
      </div>
    </form>

    <p v-else-if="!selectedSeries || !selectedStory" class="status">
      請先選擇系列與故事。
    </p>
  </div>
</template>

<style scoped>
.llm-settings-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
}

.page-title {
  margin: 0;
  font-size: 1.2rem;
}

.page-hint {
  margin: 0;
  color: var(--muted-color, #888);
  font-size: 0.9rem;
}

.selector-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.selector-row label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9rem;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 2fr;
  gap: 12px;
  align-items: center;
}

.field-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.field-label {
  font-family: ui-monospace, monospace;
  font-size: 0.9rem;
}

.field-input {
  padding: 6px 8px;
  border: 1px solid var(--border-color, #ccc);
  background: var(--input-bg, transparent);
  color: inherit;
  border-radius: 4px;
}

.field-input:disabled {
  opacity: 0.5;
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}

.btn {
  padding: 6px 16px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #ccc);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.btn.primary {
  background: var(--accent-color, #4a90e2);
  color: white;
  border-color: transparent;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.status {
  color: var(--muted-color, #888);
  font-size: 0.9rem;
}

.status.error {
  color: var(--error-color, #c0392b);
}

@media (max-width: 640px) {
  .field-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>

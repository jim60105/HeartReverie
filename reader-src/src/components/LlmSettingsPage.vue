<script setup lang="ts">
import { reactive, computed, watch, onMounted, ref } from "vue";
import { useStorySelector } from "@/composables/useStorySelector";
import { useStoryLlmConfig } from "@/composables/useStoryLlmConfig";
import { useNotification } from "@/composables/useNotification";
import {
  REASONING_EFFORTS,
  type LlmDefaultsResponse,
  type StoryLlmConfig,
} from "@/types";

type FieldKey = keyof StoryLlmConfig;

type FieldDef =
  | { key: FieldKey; label: string; type: "string"; step?: string }
  | { key: FieldKey; label: string; type: "number"; step?: string }
  | { key: FieldKey; label: string; type: "boolean" }
  | { key: FieldKey; label: string; type: "enum"; options: readonly string[] };

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
  { key: "reasoningEnabled", label: "推理啟用 (reasoning_enabled)", type: "boolean" },
  { key: "reasoningEffort", label: "推理強度 (reasoning_effort)", type: "enum", options: REASONING_EFFORTS },
  { key: "maxCompletionTokens", label: "回應上限 (max_completion_tokens)", type: "number", step: "1" },
];

const { seriesList, storyList, selectedSeries, selectedStory, fetchSeries, fetchStories } =
  useStorySelector();
const {
  overrides,
  defaults,
  loading,
  saving,
  defaultsLoading,
  error,
  defaultsError,
  loadConfig,
  loadLlmDefaults,
  saveConfig,
} = useStoryLlmConfig();
const { notify } = useNotification();

// Per-field enabled toggles + typed values.
// `enabledMap[k] === true` means "this story overrides the default" — the
// "覆寫此欄位" checkbox is ticked, the input is editable, and the key is
// included in the PUT body.
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
  reasoningEnabled: false,
  reasoningEffort: false,
  maxCompletionTokens: false,
});

// String-keyed values for `string` / `number` / `enum` field types.
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
  reasoningEnabled: "",
  reasoningEffort: "high",
  maxCompletionTokens: "",
});

// Real boolean values for `boolean` field types.
const booleanMap = reactive<Record<string, boolean>>({
  reasoningEnabled: false,
});

// Tracks which keys were present in the most recent server-side overrides
// payload — used to distinguish "user has not yet touched this field" from
// "user explicitly cleared an override that used to exist". Cleared and
// rebuilt on every `syncFromOverrides` call.
const loadedKeys = reactive(new Set<FieldKey>());
// Tracks keys the user has interacted with locally since the last load —
// suppresses defaults from auto-toggling overrides that the user has just
// cleared. Cleared on every `syncFromOverrides` call.
const dirtyKeys = reactive(new Set<FieldKey>());
// Guard during programmatic mutations so the @input/@change listeners don't
// mistake them for user typing.
const syncingFromServer = ref(false);

function markDirty(key: FieldKey): void {
  if (syncingFromServer.value) return;
  dirtyKeys.add(key);
}

const canSave = computed(
  () =>
    !!selectedSeries.value &&
    !!selectedStory.value &&
    !loading.value &&
    !saving.value,
);

function syncFromOverrides(source: StoryLlmConfig): void {
  syncingFromServer.value = true;
  try {
    loadedKeys.clear();
    dirtyKeys.clear();
    for (const f of FIELDS) {
      const present = Object.prototype.hasOwnProperty.call(source, f.key);
      if (present) loadedKeys.add(f.key);
      enabledMap[f.key] = present;
      const v = source[f.key];
      if (f.type === "boolean") {
        booleanMap[f.key] = typeof v === "boolean" ? v : false;
        valueMap[f.key] = "";
      } else if (f.type === "enum") {
        const fallback = f.key === "reasoningEffort" ? "high" : "";
        valueMap[f.key] =
          typeof v === "string" && f.options.includes(v) ? v : fallback;
      } else {
        valueMap[f.key] = v === undefined || v === null ? "" : String(v);
      }
    }
  } finally {
    syncingFromServer.value = false;
  }
}

/**
 * Format a server default value for display alongside the override input.
 * Returns an empty string when the field is missing from `defaults` (e.g.,
 * defaults are still loading or the request failed).
 */
function formatDefault(key: FieldKey, src: LlmDefaultsResponse | null): string {
  if (src === null) return "";
  const v = (src as Record<string, unknown>)[key];
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

const displayValueMap = computed(() => {
  const out: Record<FieldKey, string> = { ...valueMap } as Record<FieldKey, string>;
  for (const f of FIELDS) {
    if (enabledMap[f.key]) continue;
    out[f.key] = formatDefault(f.key, defaults.value);
  }
  return out;
});

const reasoningEffortMuted = computed(
  () =>
    enabledMap.reasoningEnabled === true &&
    booleanMap.reasoningEnabled === false,
);

async function handleLoad(): Promise<void> {
  if (!selectedSeries.value || !selectedStory.value) return;
  await loadConfig(selectedSeries.value, selectedStory.value);
  syncFromOverrides(overrides.value);
}

function collectPayload(): StoryLlmConfig | null {
  const payload: StoryLlmConfig = {};
  for (const f of FIELDS) {
    if (!enabledMap[f.key]) continue;
    if (f.type === "boolean") {
      (payload as Record<string, unknown>)[f.key] = booleanMap[f.key] === true;
      continue;
    }
    if (f.type === "enum") {
      const value = valueMap[f.key];
      if (!f.options.includes(value)) {
        notify({
          title: "欄位錯誤",
          body: `${f.label} 必須為 ${f.options.join(" / ")}`,
          level: "error",
        });
        return null;
      }
      (payload as Record<string, unknown>)[f.key] = value;
      continue;
    }
    // Vue's v-model on <input type="number"> coerces to a number when the
    // value parses cleanly, so valueMap[key] may be a number at runtime even
    // though the type annotation is `string`. Normalise before trimming.
    const raw = String(valueMap[f.key] ?? "").trim();
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
      if (f.key === "maxCompletionTokens") {
        // Strict positive-integer lexical guard (no exponent notation, no
        // leading zeros, no decimals). Using regex on the raw text avoids
        // silently accepting values like "1e3" that Number() would parse
        // into a finite safe integer.
        if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(num) || num <= 0) {
          notify({
            title: "欄位錯誤",
            body: `${f.label} 必須為正整數`,
            level: "error",
          });
          return null;
        }
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
    const persisted = await saveConfig(
      selectedSeries.value,
      selectedStory.value,
      payload,
    );
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

async function handleReset(): Promise<void> {
  if (!selectedSeries.value || !selectedStory.value) {
    // No story selected — just snap to the cached overrides (which is `{}`).
    syncFromOverrides(overrides.value);
    return;
  }
  // Per spec: Reset SHALL re-fetch BOTH the per-story config AND the
  // env-derived defaults via `Promise.allSettled`, so a defaults-fetch
  // failure does NOT block the per-story refresh.
  const [, defaultsResult] = await Promise.allSettled([
    loadConfig(selectedSeries.value, selectedStory.value),
    loadLlmDefaults(),
  ]);
  syncFromOverrides(overrides.value);
  if (defaultsResult.status === "rejected") {
    notify({
      title: "預設值載入失敗",
      body: "無法重新取得伺服器 LLM 預設值；輸入框將顯示佔位字串。",
      level: "warning",
    });
  } else if (defaults.value === null && defaultsError.value) {
    notify({
      title: "預設值載入失敗",
      body: defaultsError.value,
      level: "warning",
    });
  }
}

/**
 * When the user toggles a field's "override" checkbox ON, seed `valueMap`
 * with the current server default — but only when (a) we're not in the
 * middle of a programmatic sync, (b) the field wasn't already populated
 * by the loaded overrides, and (c) the user hasn't dirtied it locally.
 * This way, a user enabling an override sees the actual baseline they're
 * about to override, instead of an empty input.
 */
function handleEnabledChange(key: FieldKey, next: boolean): void {
  enabledMap[key] = next;
  // Capture whether the field was already locally dirty BEFORE we mark this
  // toggle event as another dirty edit. Spec requires that a previously
  // typed-in value not be overwritten by a seed.
  const wasDirty = dirtyKeys.has(key);
  markDirty(key);
  if (!next || syncingFromServer.value) return;
  if (loadedKeys.has(key)) return;
  if (wasDirty) return;
  if (defaults.value === null) return;
  const f = FIELDS.find((x) => x.key === key);
  if (!f) return;
  const seed = (defaults.value as Record<string, unknown>)[key];
  if (seed === undefined || seed === null) return;
  if (f.type === "boolean") {
    if (typeof seed === "boolean") booleanMap[key] = seed;
  } else if (f.type === "enum") {
    if (typeof seed === "string" && f.options.includes(seed)) {
      valueMap[key] = seed;
    }
  } else if (f.type === "number") {
    if (typeof seed === "number" && Number.isFinite(seed)) {
      valueMap[key] = String(seed);
    }
  } else if (f.type === "string") {
    if (typeof seed === "string" && seed.length > 0) {
      valueMap[key] = seed;
    }
  }
}

onMounted(async () => {
  // Parallel fan-out so a flaky `/api/llm-defaults` doesn't block the rest of
  // the page. `Promise.allSettled` ensures partial failure is acceptable.
  const [, , defaultsResult] = await Promise.allSettled([
    fetchSeries(),
    selectedSeries.value && !storyList.value.length
      ? fetchStories(selectedSeries.value)
      : Promise.resolve(),
    loadLlmDefaults(),
  ]);
  if (defaultsResult.status === "rejected") {
    notify({
      title: "預設值載入失敗",
      body: "無法取得伺服器 LLM 預設值；輸入框將顯示佔位字串。",
      level: "warning",
    });
  } else if (defaults.value === null && defaultsError.value) {
    notify({
      title: "預設值載入失敗",
      body: defaultsError.value,
      level: "warning",
    });
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

defineExpose({
  handleSave,
  handleReset,
  enabledMap,
  valueMap,
  booleanMap,
  reasoningEffortMuted,
  defaults,
  displayValueMap,
  // Exposed for cross-layer parity tests against `STORY_LLM_CONFIG_KEYS`.
  FIELDS,
});
</script>

<template>
  <div class="llm-settings-page">
    <h2 class="page-title">LLM 設定（依故事覆寫）</h2>
    <p class="page-hint">
      此處設定僅套用於選取的故事。未勾選的欄位將使用伺服器預設值（顯示於右側）。
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
    <div v-if="defaultsLoading" class="status">預設值載入中⋯</div>
    <div v-else-if="defaultsError" class="status warning">
      預設值無法取得：{{ defaultsError }}
    </div>

    <form v-if="selectedSeries && selectedStory && !loading" class="fields" @submit.prevent="handleSave">
      <div v-for="f in FIELDS" :key="f.key" class="field-row">
        <label class="field-toggle">
          <input
            type="checkbox"
            :checked="enabledMap[f.key]"
            @change="(ev) => handleEnabledChange(f.key, (ev.target as HTMLInputElement).checked)"
          />
          <span class="field-label">{{ f.label }}</span>
          <span class="field-hint">
            {{ enabledMap[f.key] ? "（已覆寫）" : "（使用預設）" }}
          </span>
        </label>

        <!-- Override-enabled branch: editable input bound via v-model. -->
        <template v-if="enabledMap[f.key]">
          <input
            v-if="f.type === 'boolean'"
            type="checkbox"
            class="field-checkbox"
            v-model="booleanMap[f.key]"
            @change="markDirty(f.key)"
          />
          <select
            v-else-if="f.type === 'enum'"
            class="field-input"
            :class="{ muted: f.key === 'reasoningEffort' && reasoningEffortMuted }"
            v-model="valueMap[f.key]"
            @change="markDirty(f.key)"
          >
            <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt }}</option>
          </select>
          <!--
            Use manual :value + @input instead of v-model for number inputs so
            we always preserve the user's raw lexical text. Vue 3's v-model
            on type="number" silently coerces parseable strings (e.g. "1e3")
            to numbers via looseToNumber, defeating strict integer regex
            validation in collectPayload(). String inputs still use v-model.
          -->
          <input
            v-else-if="f.type === 'number'"
            class="field-input"
            type="text"
            inputmode="decimal"
            :step="f.step"
            :value="valueMap[f.key]"
            @input="(ev) => {
              valueMap[f.key] = (ev.target as HTMLInputElement).value;
              markDirty(f.key);
            }"
          />
          <input
            v-else
            class="field-input"
            type="text"
            v-model="valueMap[f.key]"
            @input="markDirty(f.key)"
          />
        </template>

        <!-- Override-disabled branch: read-only display of the server default. -->
        <template v-else>
          <input
            v-if="f.type === 'boolean'"
            type="checkbox"
            class="field-checkbox default-display"
            disabled
            :checked="defaults?.reasoningEnabled === true"
          />
          <input
            v-else
            class="field-input default-display"
            type="text"
            disabled
            :value="displayValueMap[f.key]"
            :placeholder="defaults === null ? '預設值載入失敗' : '使用預設值'"
          />
        </template>
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
  grid-template-columns: minmax(260px, 1fr) 2fr;
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

.field-hint {
  color: var(--muted-color, #888);
  font-size: 0.8rem;
}

.field-input {
  padding: 6px 8px;
  border: 1px solid var(--border-color, #ccc);
  background: var(--input-bg, transparent);
  color: inherit;
  border-radius: 4px;
}

.field-input:disabled,
.default-display {
  opacity: 0.6;
}

.muted {
  opacity: 0.5;
  border-color: var(--muted-color, #888);
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

.status.warn,
.status.warning {
  color: var(--warn-color, #b07d2b);
}

@media (max-width: 640px) {
  .field-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>

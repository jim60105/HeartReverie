<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { useRoute } from "vue-router";
import { useAuth } from "@/composables/useAuth";
import { useNotification } from "@/composables/useNotification";

const route = useRoute();
const { getAuthHeaders } = useAuth();
const { notify } = useNotification();

const pluginName = computed(() => route.params.pluginName as string);
const schema = ref<Record<string, unknown> | null>(null);
const settings = ref<Record<string, unknown>>({});
const dynamicOptions = ref<Record<string, string[]>>({});
const dynamicOptionsFailed = ref<Set<string>>(new Set());
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const actionLoading = ref<Record<string, boolean>>({});
const actionResult = ref<Record<string, { ok: boolean; error?: string } | null>>({});
const comboboxOpen = ref<Record<string, boolean>>({});
const comboboxFilter = ref<Record<string, string>>({});
const comboboxHighlight = ref<Record<string, number>>({});

interface SchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  items?: { type?: string };
  "x-options-url"?: string;
  "x-input-type"?: string;
}

interface SchemaAction {
  id: string;
  label: string;
  url: string;
  method?: string;
  bodyFields?: string[];
  reloadOptionsOnSuccess?: boolean;
}

async function loadSchema(): Promise<void> {
  schema.value = null;
  error.value = "";
  try {
    const res = await fetch(`/api/plugins/${pluginName.value}/settings-schema`, {
      headers: getAuthHeaders() as Record<string, string>,
    });
    if (!res.ok) {
      error.value = res.status === 404 ? "此插件沒有設定項目" : `載入設定結構失敗 (${res.status})`;
      return;
    }
    schema.value = await res.json();
    await loadDynamicOptionsForSchema();
  } catch {
    error.value = "網路錯誤，無法載入設定結構";
  }
}

async function loadSettings(): Promise<void> {
  try {
    const res = await fetch(`/api/plugins/${pluginName.value}/settings`, {
      headers: getAuthHeaders() as Record<string, string>,
    });
    if (res.ok) {
      settings.value = await res.json();
    }
  } catch {
    // Use defaults from schema
  }
}

async function loadDynamicOptionsForSchema(): Promise<void> {
  if (!schema.value) return;
  const properties = (schema.value as Record<string, unknown>).properties as
    | Record<string, SchemaProperty>
    | undefined;
  if (!properties) return;

  const promises: Promise<void>[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    const optionsUrl = prop["x-options-url"];
    if (optionsUrl) {
      promises.push(loadDynamicOption(key, optionsUrl));
    }
  }
  await Promise.allSettled(promises);
}

async function loadDynamicOption(key: string, url: string): Promise<void> {
  try {
    const res = await fetch(url, { headers: getAuthHeaders() as Record<string, string> });
    if (!res.ok) {
      dynamicOptionsFailed.value.add(key);
      return;
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      dynamicOptions.value[key] = data.map(String);
    } else {
      dynamicOptionsFailed.value.add(key);
    }
  } catch {
    dynamicOptionsFailed.value.add(key);
  }
}

async function executeAction(action: SchemaAction): Promise<void> {
  actionLoading.value = { ...actionLoading.value, [action.id]: true };
  actionResult.value = { ...actionResult.value, [action.id]: null };
  try {
    const body: Record<string, unknown> = {};
    if (action.bodyFields) {
      for (const field of action.bodyFields) {
        body[field] = settings.value[field] ?? "";
      }
    }
    const res = await fetch(action.url, {
      method: action.method || "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" } as Record<string, string>,
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    actionResult.value = { ...actionResult.value, [action.id]: data };

    if (data.ok && action.reloadOptionsOnSuccess) {
      dynamicOptionsFailed.value = new Set();
      await loadDynamicOptionsForSchema();
    }
  } catch {
    actionResult.value = {
      ...actionResult.value,
      [action.id]: { ok: false, error: "網路錯誤，無法執行操作" },
    };
  } finally {
    actionLoading.value = { ...actionLoading.value, [action.id]: false };
  }
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = "";
  try {
    const res = await fetch(`/api/plugins/${pluginName.value}/settings`, {
      method: "PUT",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" } as Record<string, string>,
      body: JSON.stringify(settings.value),
    });
    if (res.ok) {
      notify({ title: "設定已儲存", body: `${pluginName.value} 設定更新成功`, level: "success" });
    } else {
      const body = await res.json().catch(() => null);
      error.value = body?.detail || `儲存失敗 (${res.status})`;
    }
  } catch {
    error.value = "網路錯誤，無法儲存設定";
  } finally {
    saving.value = false;
  }
}

function getFieldType(prop: SchemaProperty, key: string): string {
  if (prop["x-input-type"] === "password" || prop.format === "password") return "password";
  if (prop.type === "array" && prop["x-options-url"]) return "multi-combobox";
  if (prop.type === "array") return "tags";
  if (prop.enum) return "select";
  if (prop["x-options-url"]) return "combobox";
  if (dynamicOptions.value[key]) return "select";
  switch (prop.type) {
    case "boolean":
      return "checkbox";
    case "number":
    case "integer":
      return "number";
    default:
      return "text";
  }
}

function getOptions(prop: SchemaProperty, key: string): string[] {
  if (dynamicOptions.value[key]) return dynamicOptions.value[key];
  if (prop.enum) return prop.enum.map(String);
  return [];
}

function updateField(key: string, value: unknown): void {
  settings.value = { ...settings.value, [key]: value };
}

function getArrayValue(key: string): string[] {
  const val = settings.value[key];
  if (Array.isArray(val)) return val.map(String);
  // Legacy migration: coerce string to single-element array
  if (typeof val === "string" && val.trim()) {
    const arr = [val.trim()];
    settings.value = { ...settings.value, [key]: arr };
    return arr;
  }
  return [];
}

function addToArray(key: string, value: string): void {
  if (!value.trim()) return;
  const current = getArrayValue(key);
  if (!current.includes(value.trim())) {
    updateField(key, [...current, value.trim()]);
  }
}

function removeFromArray(key: string, index: number): void {
  const current = getArrayValue(key);
  updateField(key, current.filter((_, i) => i !== index));
}

function getFilteredOptions(field: { key: string; options: string[] }): string[] {
  const filter = (comboboxFilter.value[field.key] || "").toLowerCase();
  if (!filter) return field.options;
  return field.options.filter(opt => opt.toLowerCase().includes(filter));
}

function isOptionSelected(field: { key: string }, opt: string): boolean {
  return getArrayValue(field.key).includes(opt);
}

function openCombobox(key: string): void {
  for (const k of Object.keys(comboboxOpen.value)) {
    if (k !== key) comboboxOpen.value[k] = false;
  }
  comboboxOpen.value = { ...comboboxOpen.value, [key]: true };
  comboboxHighlight.value = { ...comboboxHighlight.value, [key]: -1 };
}

function closeCombobox(key: string): void {
  comboboxOpen.value = { ...comboboxOpen.value, [key]: false };
}

function comboboxAddOption(key: string, value: string): void {
  if (!value.trim()) return;
  const current = getArrayValue(key);
  if (!current.includes(value.trim())) {
    updateField(key, [...current, value.trim()]);
  }
  comboboxFilter.value = { ...comboboxFilter.value, [key]: "" };
  comboboxHighlight.value = { ...comboboxHighlight.value, [key]: -1 };
}

function handleComboboxKeydown(event: KeyboardEvent, field: { key: string; options: string[] }): void {
  const key = field.key;
  const filtered = getFilteredOptions(field);

  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!comboboxOpen.value[key]) openCombobox(key);
    const current = comboboxHighlight.value[key] ?? -1;
    comboboxHighlight.value = { ...comboboxHighlight.value, [key]: (current + 1) % (filtered.length || 1) };
    scrollHighlightedIntoView(key);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (!comboboxOpen.value[key]) openCombobox(key);
    const current = comboboxHighlight.value[key] ?? 0;
    comboboxHighlight.value = { ...comboboxHighlight.value, [key]: current <= 0 ? filtered.length - 1 : current - 1 };
    scrollHighlightedIntoView(key);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const highlight = comboboxHighlight.value[key] ?? -1;
    if (highlight >= 0 && highlight < filtered.length) {
      comboboxAddOption(key, filtered[highlight]);
    } else {
      const text = comboboxFilter.value[key] || "";
      comboboxAddOption(key, text);
    }
  } else if (event.key === "Escape") {
    closeCombobox(key);
  }
}

function scrollHighlightedIntoView(key: string): void {
  nextTick(() => {
    const safeKey = CSS.escape(key);
    const el = document.querySelector(`.dropdown-panel[data-field="${safeKey}"] .dropdown-option.highlighted`);
    el?.scrollIntoView({ block: "nearest" });
  });
}

function handleClickOutside(event: MouseEvent): void {
  const target = event.target as Element;
  if (!target.closest(".multi-combobox")) {
    for (const key of Object.keys(comboboxOpen.value)) {
      comboboxOpen.value[key] = false;
    }
  }
}

onMounted(() => {
  document.addEventListener("mousedown", handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleClickOutside);
});

const schemaActions = computed((): SchemaAction[] => {
  if (!schema.value) return [];
  const actions = (schema.value as Record<string, unknown>)["x-actions"];
  return Array.isArray(actions) ? (actions as SchemaAction[]) : [];
});

const schemaProperties = computed(() => {
  if (!schema.value) return [];
  const properties = (schema.value as Record<string, unknown>).properties as
    | Record<string, SchemaProperty>
    | undefined;
  if (!properties) return [];
  return Object.entries(properties).map(([key, prop]) => ({
    key,
    prop,
    fieldType: getFieldType(prop, key),
    options: getOptions(prop, key),
    label: prop.title || key,
    description: prop.description || "",
  }));
});

onMounted(async () => {
  loading.value = true;
  await Promise.all([loadSchema(), loadSettings()]);
  loading.value = false;
});

watch(pluginName, async () => {
  loading.value = true;
  dynamicOptions.value = {};
  dynamicOptionsFailed.value = new Set();
  comboboxOpen.value = {};
  comboboxFilter.value = {};
  comboboxHighlight.value = {};
  await Promise.all([loadSchema(), loadSettings()]);
  loading.value = false;
});
</script>

<template>
  <div class="plugin-settings-page">
    <h2 class="page-title">{{ pluginName }} 設定</h2>

    <p v-if="loading" class="status-message">載入中…</p>
    <p v-else-if="error" class="status-message error-message">{{ error }}</p>

    <form v-else-if="schema" class="settings-form" @submit.prevent="save">
      <!-- Actions (x-actions) -->
      <div v-if="schemaActions.length" class="actions-section">
        <div
          v-for="action in schemaActions"
          :key="action.id"
          class="action-item"
        >
          <button
            type="button"
            class="action-btn themed-btn"
            :disabled="actionLoading[action.id]"
            @click="executeAction(action)"
          >
            {{ actionLoading[action.id] ? "測試中…" : action.label }}
          </button>
          <span
            v-if="actionResult[action.id]"
            class="action-result"
            :class="actionResult[action.id]?.ok ? 'result-success' : 'result-error'"
          >
            {{ actionResult[action.id]?.ok ? "✓ 連線成功" : `✗ ${actionResult[action.id]?.error || '連線失敗'}` }}
          </span>
        </div>
      </div>

      <div
        v-for="field in schemaProperties"
        :key="field.key"
        class="form-field"
      >
        <label :for="`field-${field.key}`" class="field-label">
          {{ field.label }}
        </label>
        <p v-if="field.description" class="field-description">
          {{ field.description }}
        </p>

        <!-- Checkbox -->
        <input
          v-if="field.fieldType === 'checkbox'"
          :id="`field-${field.key}`"
          type="checkbox"
          :checked="!!settings[field.key]"
          class="field-checkbox"
          @change="updateField(field.key, ($event.target as HTMLInputElement).checked)"
        />

        <!-- Select (static enum) -->
        <select
          v-else-if="field.fieldType === 'select'"
          :id="`field-${field.key}`"
          :value="settings[field.key] as string ?? ''"
          class="field-input"
          @change="updateField(field.key, ($event.target as HTMLSelectElement).value)"
        >
          <option value="" disabled>— 請選擇 —</option>
          <option
            v-for="opt in field.options"
            :key="opt"
            :value="opt"
          >
            {{ opt }}
          </option>
        </select>

        <!-- Combobox (free text + dynamic dropdown) -->
        <div v-else-if="field.fieldType === 'combobox'" class="combobox-wrapper">
          <input
            :id="`field-${field.key}`"
            type="text"
            :value="settings[field.key] as string ?? ''"
            :list="`datalist-${field.key}`"
            class="field-input"
            :placeholder="field.options.length ? '選擇或輸入…' : '輸入值…'"
            @input="updateField(field.key, ($event.target as HTMLInputElement).value)"
          />
          <datalist :id="`datalist-${field.key}`">
            <option
              v-for="opt in field.options"
              :key="opt"
              :value="opt"
            />
          </datalist>
        </div>

        <!-- Multi-combobox (array + dynamic dropdown) -->
        <div v-else-if="field.fieldType === 'multi-combobox'" class="multi-combobox">
          <div class="tags-list">
            <span
              v-for="(tag, idx) in getArrayValue(field.key)"
              :key="idx"
              class="tag-chip"
            >
              {{ tag }}
              <button type="button" class="tag-remove" @click="removeFromArray(field.key, idx)">×</button>
            </span>
          </div>
          <div class="input-row">
            <input
              :id="`field-${field.key}`"
              type="text"
              class="field-input combobox-input"
              :value="comboboxFilter[field.key] || ''"
              :placeholder="field.options.length ? '選擇或輸入…' : '輸入值…'"
              autocomplete="off"
              role="combobox"
              :aria-expanded="!!comboboxOpen[field.key]"
              :aria-controls="`dropdown-${field.key}`"
              @input="comboboxFilter[field.key] = ($event.target as HTMLInputElement).value; comboboxHighlight[field.key] = -1"
              @focus="openCombobox(field.key)"
              @keydown="handleComboboxKeydown($event, field)"
            />
            <button
              type="button"
              class="chevron-btn"
              tabindex="-1"
              aria-label="開啟選項"
              @mousedown.prevent="if (comboboxOpen[field.key]) { closeCombobox(field.key) } else { openCombobox(field.key); ($event.target as HTMLElement).closest('.input-row')?.querySelector<HTMLInputElement>('.combobox-input')?.focus() }"
            >▼</button>
            <div
              v-show="comboboxOpen[field.key] && field.options.length"
              :id="`dropdown-${field.key}`"
              class="dropdown-panel"
              :data-field="field.key"
              role="listbox"
            >
              <div
                v-for="(opt, optIdx) in getFilteredOptions(field)"
                :key="opt"
                class="dropdown-option"
                :class="{
                  dimmed: isOptionSelected(field, opt),
                  highlighted: comboboxHighlight[field.key] === optIdx
                }"
                role="option"
                :aria-selected="isOptionSelected(field, opt)"
                @mousedown.prevent="comboboxAddOption(field.key, opt)"
              >
                {{ opt }}
              </div>
              <div v-if="getFilteredOptions(field).length === 0" class="dropdown-empty">
                無符合選項
              </div>
            </div>
          </div>
        </div>

        <!-- Tags (array without options) -->
        <div v-else-if="field.fieldType === 'tags'" class="multi-combobox">
          <div class="tags-list">
            <span
              v-for="(tag, idx) in getArrayValue(field.key)"
              :key="idx"
              class="tag-chip"
            >
              {{ tag }}
              <button type="button" class="tag-remove" @click="removeFromArray(field.key, idx)">×</button>
            </span>
          </div>
          <input
            :id="`field-${field.key}`"
            type="text"
            class="field-input"
            placeholder="輸入後按 Enter…"
            @keydown.enter.prevent="addToArray(field.key, ($event.target as HTMLInputElement).value); ($event.target as HTMLInputElement).value = ''"
          />
        </div>

        <!-- Number -->
        <input
          v-else-if="field.fieldType === 'number'"
          :id="`field-${field.key}`"
          type="number"
          :value="settings[field.key] as number ?? field.prop.default ?? ''"
          class="field-input"
          @input="updateField(field.key, Number(($event.target as HTMLInputElement).value))"
        />

        <!-- Password -->
        <input
          v-else-if="field.fieldType === 'password'"
          :id="`field-${field.key}`"
          type="password"
          :value="settings[field.key] as string ?? ''"
          class="field-input"
          @input="updateField(field.key, ($event.target as HTMLInputElement).value)"
        />

        <!-- Text (default) -->
        <input
          v-else
          :id="`field-${field.key}`"
          type="text"
          :value="settings[field.key] as string ?? field.prop.default ?? ''"
          class="field-input"
          @input="updateField(field.key, ($event.target as HTMLInputElement).value)"
        />
      </div>

      <div class="form-actions">
        <button type="submit" class="save-btn themed-btn" :disabled="saving">
          {{ saving ? "儲存中…" : "儲存設定" }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.plugin-settings-page {
  max-width: 640px;
  padding: 1rem;
}

.page-title {
  margin-bottom: 1.5rem;
  font-family: var(--font-antique), var(--font-system-ui);
  color: var(--text-name);
}

.status-message {
  color: var(--text-label);
  font-size: 0.9rem;
}

.error-message {
  color: var(--text-italic);
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.actions-section {
  margin-bottom: 1.5rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid var(--border-color);
}

.action-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.action-btn {
  padding: 0.4rem 1rem;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  color: var(--text-label);
  font-size: 0.85rem;
  cursor: pointer;
  font-family: var(--font-antique), var(--font-system-ui);
}

.action-btn:hover:not(:disabled) {
  background: var(--btn-active-bg);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-result {
  font-size: 0.85rem;
  font-weight: 500;
}

.result-success {
  color: #4caf50;
}

.result-error {
  color: #f44336;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field-label {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-name);
  font-family: var(--font-antique), var(--font-system-ui);
}

.field-description {
  font-size: 0.8rem;
  color: var(--text-label);
  margin: 0;
}

.field-input {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--item-bg);
  color: var(--text-main);
  font-size: 0.9rem;
}

.field-input:focus {
  outline: 2px solid var(--settings-sidebar-active-border);
  outline-offset: -1px;
}

.field-checkbox {
  width: 1.2rem;
  height: 1.2rem;
  accent-color: var(--settings-sidebar-active-border);
}

.form-actions {
  margin-top: 1rem;
}

.save-btn {
  padding: 0.5rem 1.5rem;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  color: var(--text-label);
  font-size: 0.9rem;
  cursor: pointer;
  font-family: var(--font-antique), var(--font-system-ui);
}

.save-btn:hover:not(:disabled) {
  background: var(--btn-active-bg);
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.multi-combobox {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.5rem;
  border-radius: 3px;
  background: var(--item-bg);
  border: 1px solid var(--border-color);
  font-size: 0.8rem;
  color: var(--text-main);
}

.tag-remove {
  background: none;
  border: none;
  color: var(--text-label);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0 0.1rem;
}

.tag-remove:hover {
  color: var(--text-italic);
}

.input-row {
  position: relative;
  display: flex;
  align-items: center;
}

.combobox-input {
  flex: 1;
  padding-right: 2rem;
}

.chevron-btn {
  position: absolute;
  right: 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary, #888);
  font-size: 0.75rem;
  padding: 0.25rem;
  line-height: 1;
}

.chevron-btn:hover {
  color: var(--text-primary, #fff);
}

.dropdown-panel {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
  background: var(--bg-secondary, #2a2a2a);
  border: 1px solid var(--border-color, #444);
  border-radius: 4px;
  margin-top: 2px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.dropdown-option {
  padding: 0.4rem 0.75rem;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background-color 0.1s;
}

.dropdown-option:hover {
  background: var(--bg-hover, #3a3a3a);
}

.dropdown-option.highlighted {
  background: var(--bg-hover, #3a3a3a);
}

.dropdown-option.dimmed {
  opacity: 0.4;
  cursor: default;
}

.dropdown-empty {
  padding: 0.5rem 0.75rem;
  color: var(--text-secondary, #888);
  font-size: 0.85rem;
  font-style: italic;
}
</style>

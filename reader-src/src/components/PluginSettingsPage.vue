<script setup lang="ts">
// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Schema-driven plugin settings page. Replaces the old hand-rolled switch with
// a recursive `<SchemaField>` fed from a per-mount `WidgetRegistry` via the
// `FormContext` provide/inject contract.

import {
  computed,
  markRaw,
  onMounted,
  provide,
  reactive,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { useNotification } from "@/composables/useNotification";
import { apiFetch } from "@/lib/api";
import { emitEvent } from "@/lib/event-bus";
import SchemaField from "@/components/SchemaField.vue";
import {
  createDefaultWidgetRegistry,
  FormContextKey,
  type FormContextValue,
  type JsonSchema,
  type SchemaMeta,
} from "@/lib/widget-registry";
import type { ValidationError } from "@/lib/validation-i18n";
import { formatValidationError } from "@/lib/validation-i18n";
import { diffPaths, isPathHidden } from "./schema-field-helpers";

const route = useRoute();
const router = useRouter();
const { notify } = useNotification();

const pluginName = computed(() => route.params.pluginName as string);
const pluginDisplayName = ref<string>("");

const registry = markRaw(createDefaultWidgetRegistry());

const schema = ref<JsonSchema | null>(null);
const schemaMeta = ref<SchemaMeta | null>(null);
const settings = ref<Record<string, unknown>>({});
const originalSettings = ref<Record<string, unknown>>({});
const legacyWarnings = ref<ValidationError[]>([]);
const errors = ref<ValidationError[]>([]);
const warnings = ref<ValidationError[]>([]);
const loading = ref(true);
const saving = ref(false);
const generalError = ref("");

// x-actions support (preserved from previous page)
interface SchemaAction {
  id: string;
  label: string;
  url: string;
  method?: string;
  bodyFields?: string[];
  reloadOptionsOnSuccess?: boolean;
}
const actionLoading = ref<Record<string, boolean>>({});
const actionResult = ref<Record<string, { ok: boolean; error?: string } | null>>({});

// FormContext provided to descendants
const formContext = reactive({
  registry,
  errors: errors.value,
  schemaMeta: schemaMeta.value,
  basePath: "",
  rootModel: settings.value as Record<string, unknown>,
}) as unknown as FormContextValue;
provide(FormContextKey, formContext);

watch(
  errors,
  (v) => {
    (formContext as { errors: ValidationError[] }).errors = v;
  },
  { deep: true },
);
watch(
  schemaMeta,
  (v) => {
    (formContext as { schemaMeta: SchemaMeta | null }).schemaMeta = v;
  },
);
watch(
  settings,
  (v) => {
    (formContext as { rootModel: Record<string, unknown> }).rootModel = v;
  },
  { deep: true },
);

const schemaProperties = computed<Array<[string, JsonSchema]>>(() => {
  if (!schema.value) return [];
  const props = schema.value["properties"];
  if (!props || typeof props !== "object") return [];
  return Object.entries(props as Record<string, JsonSchema>);
});

const schemaActions = computed<SchemaAction[]>(() => {
  if (!schema.value) return [];
  const raw = schema.value["x-actions"];
  return Array.isArray(raw) ? (raw as SchemaAction[]) : [];
});

const isDirty = computed(() => {
  return JSON.stringify(settings.value) !== JSON.stringify(originalSettings.value);
});

const hasBlockingErrors = computed(() => errors.value.length > 0);
const saveDisabled = computed(() => saving.value || hasBlockingErrors.value);

async function loadSchema(): Promise<void> {
  schema.value = null;
  generalError.value = "";
  try {
    const res = await apiFetch(`/api/plugins/${pluginName.value}/settings-schema`, {
      throwOnError: false,
    });
    if (!res.ok) {
      generalError.value = res.status === 404 ? "此插件沒有設定項目" : `載入設定結構失敗 (${res.status})`;
      return;
    }
    schema.value = await res.json();
  } catch {
    generalError.value = "網路錯誤，無法載入設定結構";
  }
}

async function loadSettings(): Promise<void> {
  try {
    const res = await apiFetch(`/api/plugins/${pluginName.value}/settings`, {
      throwOnError: false,
    });
    if (!res.ok) return;
    const body = (await res.json()) as Record<string, unknown>;
    const lw = body["x-legacy-warnings"];
    legacyWarnings.value = Array.isArray(lw) ? (lw as ValidationError[]) : [];
    const clone: Record<string, unknown> = { ...body };
    delete clone["x-legacy-warnings"];
    settings.value = clone;
    originalSettings.value = JSON.parse(JSON.stringify(clone));
  } catch {
    // keep defaults
  }
}

async function loadSchemaMeta(): Promise<void> {
  try {
    const res = await apiFetch(`/api/plugins/${pluginName.value}/settings/schema-meta`, {
      throwOnError: false,
    });
    if (!res.ok) return;
    schemaMeta.value = (await res.json()) as SchemaMeta;
  } catch {
    // schemaMeta is optional; widgets fall back gracefully
  }
}

async function loadDisplayName(): Promise<void> {
  try {
    const res = await apiFetch(`/api/plugins`, { throwOnError: false });
    if (!res.ok) return;
    const list = (await res.json()) as Array<Record<string, unknown>>;
    const match = list.find((p) => p.name === pluginName.value);
    if (match && typeof match.displayName === "string" && match.displayName.length > 0) {
      pluginDisplayName.value = match.displayName;
    }
  } catch (err) {
    console.warn(
      "[PluginSettingsPage] failed to resolve displayName for",
      pluginName.value,
      err,
    );
  }
}

async function loadAll(): Promise<void> {
  loading.value = true;
  errors.value = [];
  warnings.value = [];
  // Reset displayName BEFORE the fetch so a route change from plugin A → B
  // never leaves A's label visible. If /api/plugins fails or omits B, the
  // heading falls back to the slug via `pluginDisplayName || pluginName`.
  pluginDisplayName.value = "";
  await Promise.all([loadSchema(), loadSettings(), loadSchemaMeta(), loadDisplayName()]);
  loading.value = false;
}

function onRootUpdate(value: unknown): void {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    settings.value = { ...(value as Record<string, unknown>) };
    scheduleValidate();
  }
}

function computeChangedPaths(): string[] {
  if (!schema.value) return [];
  const raw = diffPaths(originalSettings.value, settings.value);
  const filtered: string[] = [];
  for (const p of raw) {
    if (!p) continue;
    if (isPathHidden(schema.value, p, settings.value)) continue;
    filtered.push(p);
  }
  return filtered;
}

async function save(): Promise<void> {
  saving.value = true;
  generalError.value = "";
  try {
    const body = {
      ...settings.value,
      _changedPaths: computeChangedPaths(),
    };
    const res = await apiFetch(`/api/plugins/${pluginName.value}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      throwOnError: false,
    });
    const payload = (await res.json().catch(() => ({}))) as {
      errors?: ValidationError[];
      warnings?: ValidationError[];
      detail?: string;
      title?: string;
    };
    errors.value = Array.isArray(payload.errors) ? payload.errors : [];
    warnings.value = Array.isArray(payload.warnings) ? payload.warnings : [];
    if (res.ok) {
      notify({
        title: "設定已儲存",
        body: `${pluginDisplayName.value || pluginName.value} 設定更新成功`,
        level: "success",
      });
      originalSettings.value = JSON.parse(JSON.stringify(settings.value));
      emitEvent("plugin-settings:changed", {
        name: pluginName.value,
        settings: { ...settings.value },
      });
    } else {
      // Only fall back to a generic message when no structured errors arrived.
      if (errors.value.length === 0) {
        generalError.value = payload.detail || payload.title || `儲存失敗 (${res.status})`;
      }
    }
  } catch {
    generalError.value = "網路錯誤，無法儲存設定";
  } finally {
    saving.value = false;
  }
}

async function reset(): Promise<void> {
  if (isDirty.value) {
    const ok = globalThis.confirm("確定要捨棄目前的編輯，重新讀取已儲存的設定嗎？");
    if (!ok) return;
  }
  errors.value = [];
  warnings.value = [];
  await loadSettings();
}

function cancel(): void {
  if (isDirty.value) {
    const ok = globalThis.confirm("尚有未儲存的變更，確定要離開嗎？");
    if (!ok) return;
  }
  router.back();
}

// Debounced live validation
let validateTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleValidate(): void {
  if (validateTimer !== null) clearTimeout(validateTimer);
  validateTimer = setTimeout(() => {
    void runValidate();
  }, 300);
}

async function runValidate(): Promise<void> {
  if (!schema.value) return;
  try {
    const body = {
      ...settings.value,
      _changedPaths: computeChangedPaths(),
    };
    const res = await apiFetch(`/api/plugins/${pluginName.value}/settings/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      throwOnError: false,
    });
    if (!res.ok) return;
    const payload = (await res.json()) as {
      errors?: ValidationError[];
      warnings?: ValidationError[];
    };
    errors.value = Array.isArray(payload.errors) ? payload.errors : [];
    warnings.value = Array.isArray(payload.warnings) ? payload.warnings : [];
  } catch {
    // ignore — validate is best-effort
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
    const res = await apiFetch(action.url, {
      method: action.method || "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      throwOnError: false,
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    actionResult.value = { ...actionResult.value, [action.id]: data };
  } catch {
    actionResult.value = {
      ...actionResult.value,
      [action.id]: { ok: false, error: "網路錯誤，無法執行操作" },
    };
  } finally {
    actionLoading.value = { ...actionLoading.value, [action.id]: false };
  }
}

onMounted(() => {
  void loadAll();
});

watch(pluginName, () => {
  void loadAll();
});
</script>

<template>
  <div class="plugin-settings-page">
    <h2 class="page-title">{{ pluginDisplayName || pluginName }} 設定</h2>

    <p v-if="loading" class="status-message">載入中…</p>
    <p v-else-if="generalError" class="status-message error-message">{{ generalError }}</p>

    <template v-else-if="schema">
      <!-- Legacy warnings banner (read-only) -->
      <div v-if="legacyWarnings.length" class="legacy-warnings-banner" role="status">
        <p class="banner-title">⚠ 此插件的磁碟設定有 {{ legacyWarnings.length }} 個欄位不符合目前的 schema：</p>
        <ul class="banner-list">
          <li v-for="(w, i) in legacyWarnings" :key="i">
            <code>{{ w.path }}</code>：{{ formatValidationError(w) }}
          </li>
        </ul>
        <p class="banner-hint">編輯並儲存對應欄位後，警告會自動消除。</p>
      </div>

      <form class="settings-form" @submit.prevent="save">
        <!-- x-actions section preserved from the previous page -->
        <div v-if="schemaActions.length" class="actions-section">
          <div v-for="action in schemaActions" :key="action.id" class="action-item">
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
              {{
                actionResult[action.id]?.ok
                  ? "✓ 連線成功"
                  : `✗ ${actionResult[action.id]?.error || '連線失敗'}`
              }}
            </span>
          </div>
        </div>

        <!-- Schema-driven form body -->
        <SchemaField
          v-for="[key, childSchema] in schemaProperties"
          :key="key"
          :schema="childSchema"
          :path="key"
          :property-name="key"
          :model-value="settings[key]"
          @update:model-value="(v) => onRootUpdate({ ...settings, [key]: v })"
        />

        <!-- Warnings (non-blocking) -->
        <div v-if="warnings.length" class="warnings-banner" role="status">
          <p class="banner-title">提示</p>
          <ul class="banner-list">
            <li v-for="(w, i) in warnings" :key="i">
              <code>{{ w.path }}</code>：{{ formatValidationError(w) }}
            </li>
          </ul>
        </div>

        <!-- Top-level errors (e.g., _changedPaths type errors) -->
        <div v-if="errors.length" class="errors-banner" role="alert">
          <p class="banner-title">無法儲存：</p>
          <ul class="banner-list">
            <li v-for="(e, i) in errors" :key="i">
              <code>{{ e.path || "(root)" }}</code>：{{ formatValidationError(e) }}
            </li>
          </ul>
        </div>

        <div class="form-actions">
          <button type="submit" class="save-btn themed-btn" :disabled="saveDisabled">
            {{ saving ? "儲存中…" : "儲存" }}
          </button>
          <button type="button" class="action-btn themed-btn" :disabled="saving" @click="reset">
            重設為已儲存值
          </button>
          <button type="button" class="action-btn themed-btn" :disabled="saving" @click="cancel">
            取消
          </button>
          <span v-if="isDirty" class="dirty-badge">尚未儲存</span>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.plugin-settings-page {
  max-width: 720px;
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
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.action-item {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}

.legacy-warnings-banner,
.warnings-banner,
.errors-banner {
  border-radius: 6px;
  padding: 0.6rem 0.85rem;
  margin: 0;
}

.legacy-warnings-banner {
  background: var(--bg-warning, #fff7ed);
  border: 1px solid var(--border-warning, #f59e0b);
  color: var(--text-warning, #92400e);
}

.warnings-banner {
  background: var(--bg-info, #f0f9ff);
  border: 1px solid var(--border-info, #38bdf8);
  color: var(--text-info, #075985);
}

.errors-banner {
  background: var(--bg-error, #fef2f2);
  border: 1px solid var(--border-error, #ef4444);
  color: var(--text-error, #991b1b);
}

.banner-title {
  margin: 0 0 0.25rem;
  font-weight: 600;
  font-size: 0.9rem;
}

.banner-list {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.85rem;
}

.banner-hint {
  margin: 0.35rem 0 0;
  font-size: 0.8rem;
  opacity: 0.85;
}

.form-actions {
  margin-top: 1rem;
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}

.save-btn,
.action-btn {
  padding: 0.5rem 1.25rem;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  color: var(--text-label);
  font-size: 0.9rem;
  cursor: pointer;
  font-family: var(--font-antique), var(--font-system-ui);
}

.save-btn:hover:not(:disabled),
.action-btn:hover:not(:disabled) {
  background: var(--btn-active-bg);
}

.save-btn:disabled,
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dirty-badge {
  font-size: 0.8rem;
  color: var(--text-italic, #c44);
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

:deep(.field-input) {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--item-bg);
  color: var(--text-main);
  font-size: 0.9rem;
}

:deep(.field-input:focus) {
  outline: 2px solid var(--settings-sidebar-active-border);
  outline-offset: -1px;
}

:deep(.field-checkbox) {
  width: 1.2rem;
  height: 1.2rem;
  accent-color: var(--settings-sidebar-active-border);
}

:deep(.field-label) {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-name);
  font-family: var(--font-antique), var(--font-system-ui);
}

:deep(.field-description) {
  font-size: 0.8rem;
  color: var(--text-label);
  margin: 0;
}
</style>

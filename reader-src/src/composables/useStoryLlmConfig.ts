import { ref, shallowRef, type Ref } from "vue";
import { useAuth } from "@/composables/useAuth";
import {
  REASONING_EFFORTS,
  type LlmDefaultsResponse,
  type ReasoningEffort,
  type StoryLlmConfig,
  type UseStoryLlmConfigReturn,
} from "@/types";

/**
 * Thrown by `loadLlmDefaults` when the server returned 200 OK but the body
 * is not a JSON object whose values match the documented schema (e.g., a
 * stringified number, or a `reasoningEffort` outside the enum). Callers
 * should treat this exactly like a network failure: log, surface a toast,
 * leave `defaults` at `null`, and degrade to placeholder behaviour.
 */
export class LlmDefaultsValidationError extends Error {
  override readonly name = "LlmDefaultsValidationError";
}

const overrides = ref<StoryLlmConfig>({});
const defaults = shallowRef<LlmDefaultsResponse | null>(null);
const loading = ref(false);
const saving = ref(false);
const defaultsLoading = ref(false);
const error = ref<string | null>(null);
const defaultsError = ref<string | null>(null);

function buildUrl(series: string, name: string): string {
  return `/api/${encodeURIComponent(series)}/${encodeURIComponent(name)}/config`;
}

async function loadConfig(series: string, name: string): Promise<void> {
  const { getAuthHeaders } = useAuth();
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(buildUrl(series, name), {
      headers: { ...getAuthHeaders() },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { detail?: string }).detail ?? "Failed to load story config",
      );
    }
    overrides.value = (await res.json()) as StoryLlmConfig;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Unknown error";
    overrides.value = {};
  } finally {
    loading.value = false;
  }
}

/** Whitelist of numeric fields validated by `loadLlmDefaults`. */
const NUMERIC_KEYS = [
  "temperature",
  "frequencyPenalty",
  "presencePenalty",
  "topK",
  "topP",
  "repetitionPenalty",
  "minP",
  "topA",
  "maxCompletionTokens",
] as const;

function validateLlmDefaultsBody(body: unknown): LlmDefaultsResponse {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new LlmDefaultsValidationError(
      "Response body must be a JSON object",
    );
  }
  const src = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // The route is contractually obligated to return the full 12-key resolved
  // defaults snapshot. Treat any missing key as a contract violation so we
  // enter the degraded "defaultsError" state instead of rendering blank
  // disabled inputs that look like a working default.
  if (typeof src.model !== "string" || src.model.length === 0) {
    throw new LlmDefaultsValidationError(
      "Field 'model' must be a non-empty string",
    );
  }
  out.model = src.model;
  for (const key of NUMERIC_KEYS) {
    const v = src[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new LlmDefaultsValidationError(
        `Field '${key}' must be a finite number`,
      );
    }
    if (key === "maxCompletionTokens") {
      if (!Number.isSafeInteger(v) || v <= 0) {
        throw new LlmDefaultsValidationError(
          "Field 'maxCompletionTokens' must be a positive integer",
        );
      }
    }
    out[key] = v;
  }
  if (typeof src.reasoningEnabled !== "boolean") {
    throw new LlmDefaultsValidationError(
      "Field 'reasoningEnabled' must be a boolean",
    );
  }
  out.reasoningEnabled = src.reasoningEnabled;
  const eff = src.reasoningEffort;
  if (
    typeof eff !== "string" ||
    !(REASONING_EFFORTS as readonly string[]).includes(eff)
  ) {
    throw new LlmDefaultsValidationError(
      `Field 'reasoningEffort' must be one of: ${REASONING_EFFORTS.join(", ")}`,
    );
  }
  out.reasoningEffort = eff as ReasoningEffort;
  return out as unknown as LlmDefaultsResponse;
}

async function loadLlmDefaults(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  defaultsLoading.value = true;
  defaultsError.value = null;
  try {
    const res = await fetch("/api/llm-defaults", {
      headers: { ...getAuthHeaders() },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { detail?: string }).detail ??
          `Failed to load defaults (HTTP ${res.status})`,
      );
    }
    const raw: unknown = await res.json();
    defaults.value = validateLlmDefaultsBody(raw);
  } catch (e) {
    defaults.value = null;
    defaultsError.value = e instanceof Error ? e.message : "Unknown error";
  } finally {
    defaultsLoading.value = false;
  }
}

async function saveConfig(
  series: string,
  name: string,
  next: StoryLlmConfig,
): Promise<StoryLlmConfig> {
  const { getAuthHeaders } = useAuth();
  saving.value = true;
  error.value = null;
  try {
    const res = await fetch(buildUrl(series, name), {
      method: "PUT",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { detail?: string }).detail ?? "Failed to save story config",
      );
    }
    const persisted = (await res.json()) as StoryLlmConfig;
    overrides.value = persisted;
    return persisted;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Unknown error";
    throw e;
  } finally {
    saving.value = false;
  }
}

function reset(): void {
  overrides.value = {};
  error.value = null;
}

export function useStoryLlmConfig(): UseStoryLlmConfigReturn {
  return {
    overrides,
    defaults: defaults as Ref<LlmDefaultsResponse | null>,
    loading,
    saving,
    defaultsLoading,
    error,
    defaultsError,
    loadConfig,
    loadLlmDefaults,
    saveConfig,
    reset,
  };
}

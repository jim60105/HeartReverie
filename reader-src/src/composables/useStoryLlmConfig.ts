import { ref } from "vue";
import { useAuth } from "@/composables/useAuth";
import type { StoryLlmConfig, UseStoryLlmConfigReturn } from "@/types";

const overrides = ref<StoryLlmConfig>({});
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

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
    loading,
    saving,
    error,
    loadConfig,
    saveConfig,
    reset,
  };
}

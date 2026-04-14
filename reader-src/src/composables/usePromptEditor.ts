import { ref, computed, watch } from "vue";
import type {
  UsePromptEditorReturn,
  ParameterPill,
  PromptPreviewResult,
} from "@/types";
import { useAuth } from "@/composables/useAuth";
import { useStorySelector } from "@/composables/useStorySelector";

const templateContent = ref("");
const lastSaved = ref("");
const parameters = ref<ParameterPill[]>([]);
const isCustom = ref(false);
const isSaving = ref(false);

const isDirty = computed(() => {
  return templateContent.value !== lastSaved.value;
});

async function loadTemplate(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch("/api/template", { headers: { ...getAuthHeaders() } });
    if (!res.ok) return;
    const data: { content: string; source: "custom" | "default" } = await res.json();
    templateContent.value = data.content;
    lastSaved.value = data.content;
    isCustom.value = data.source === "custom";
  } catch {
    // Ignore fetch errors
  }
}

async function save(): Promise<void> {
  if (!isDirty.value || isSaving.value) return;
  const { getAuthHeaders } = useAuth();
  isSaving.value = true;
  try {
    const res = await fetch("/api/template", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ content: templateContent.value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { detail?: string }).detail ?? "Failed to save template",
      );
    }
    lastSaved.value = templateContent.value;
    isCustom.value = true;
  } finally {
    isSaving.value = false;
  }
}

async function resetTemplate(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    await fetch("/api/template", {
      method: "DELETE",
      headers: { ...getAuthHeaders() },
    });
  } catch {
    // Ignore delete errors
  }
  await loadTemplate();
}

let parametersAbortController: AbortController | null = null;

async function loadParameters(series?: string, story?: string): Promise<void> {
  if (parametersAbortController) {
    parametersAbortController.abort();
  }
  parametersAbortController = new AbortController();
  const { signal } = parametersAbortController;

  const { getAuthHeaders } = useAuth();
  try {
    const url = new URL("/api/plugins/parameters", window.location.origin);
    if (series) url.searchParams.set("series", series);
    if (story) url.searchParams.set("story", story);

    const res = await fetch(url.toString(), {
      headers: { ...getAuthHeaders() },
      signal,
    });
    if (!res.ok) return;
    parameters.value = await res.json();
  } catch {
    // Ignore (includes AbortError from cancelled requests)
  }
}

// Eagerly load both on first import
let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Promise.all([loadTemplate(), loadParameters()]).then(
      () => {},
    );
  }
  return initPromise;
}

async function previewTemplate(
  series: string,
  story: string,
  message: string,
): Promise<PromptPreviewResult> {
  const { getAuthHeaders } = useAuth();
  const body: Record<string, string> = { message: message || "(preview)" };

  // Send current editor content for preview if it differs from saved
  if (isDirty.value) {
    body["template"] = templateContent.value;
  }

  const res = await fetch(
    `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/preview-prompt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(
      (err as { message?: string; detail?: string }).message ??
        (err as { detail?: string }).detail ??
        "Unknown error",
    );
  }

  return res.json() as Promise<PromptPreviewResult>;
}

let watcherInitialized = false;

function initStoryWatcher(): void {
  if (watcherInitialized) return;
  watcherInitialized = true;

  const { selectedSeries, selectedStory } = useStorySelector();

  watch(
    [selectedSeries, selectedStory],
    ([series, story]) => {
      loadParameters(series || undefined, story || undefined);
    },
    { immediate: true },
  );
}

export function usePromptEditor(): UsePromptEditorReturn {
  ensureInit();
  initStoryWatcher();

  return {
    templateContent,
    lastSaved,
    parameters,
    isDirty,
    isCustom,
    isSaving,
    save,
    loadTemplate,
    resetTemplate,
    previewTemplate,
  };
}

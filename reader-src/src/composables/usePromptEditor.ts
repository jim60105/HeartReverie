import { ref, computed } from "vue";
import type {
  UsePromptEditorReturn,
  ParameterPill,
  PromptPreviewResult,
} from "@/types";
import { useAuth } from "@/composables/useAuth";

const STORAGE_KEY = "story-editor-template";

const templateContent = ref("");
const originalTemplate = ref("");
const parameters = ref<ParameterPill[]>([]);

// Restore from localStorage on module load
const stored = localStorage.getItem(STORAGE_KEY);
if (stored) {
  templateContent.value = stored;
}

const savedTemplate = computed<string | undefined>(() => {
  if (
    templateContent.value &&
    templateContent.value !== originalTemplate.value
  ) {
    return templateContent.value;
  }
  return undefined;
});

function saveTemplate(): void {
  if (!originalTemplate.value) return;
  if (templateContent.value === originalTemplate.value) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, templateContent.value);
  }
}

async function loadTemplate(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch("/api/template", { headers: { ...getAuthHeaders() } });
    if (!res.ok) return;
    const data: { content: string } = await res.json();
    originalTemplate.value = data.content;

    // If no localStorage override or it matches server, use server version
    const localStored = localStorage.getItem(STORAGE_KEY);
    if (!localStored || localStored === data.content) {
      templateContent.value = data.content;
    } else {
      templateContent.value = localStored;
    }
  } catch {
    // Ignore fetch errors
  }
}

function resetTemplate(): void {
  if (!originalTemplate.value) return;
  templateContent.value = originalTemplate.value;
  localStorage.removeItem(STORAGE_KEY);
}

async function loadParameters(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch("/api/plugins/parameters", {
      headers: { ...getAuthHeaders() },
    });
    if (!res.ok) return;
    parameters.value = await res.json();
  } catch {
    // Ignore
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
  if (savedTemplate.value) {
    body["template"] = savedTemplate.value;
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

export function usePromptEditor(): UsePromptEditorReturn {
  ensureInit();

  return {
    templateContent,
    originalTemplate,
    parameters,
    savedTemplate,
    saveTemplate,
    loadTemplate,
    resetTemplate,
    previewTemplate,
  };
}

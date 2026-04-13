import { ref } from "vue";
import { useAuth } from "@/composables/useAuth";
import type {
  LorePassageMetadata,
  LorePassageData,
  UseLoreApiReturn,
} from "@/types";

const passages = ref<LorePassageMetadata[]>([]);
const allTags = ref<string[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

function buildScopeUrl(
  scope: string,
  series?: string,
  story?: string,
): string {
  if (scope === "global") return "/api/lore/global";
  if (scope === "series")
    return `/api/lore/series/${encodeURIComponent(series!)}`;
  return `/api/lore/story/${encodeURIComponent(series!)}/${encodeURIComponent(story!)}`;
}

async function fetchPassages(
  scope: string,
  series?: string,
  story?: string,
  tag?: string,
): Promise<void> {
  const { getAuthHeaders } = useAuth();
  loading.value = true;
  error.value = null;
  try {
    const url = new URL(buildScopeUrl(scope, series, story), location.origin);
    if (tag) url.searchParams.set("tag", tag);
    const res = await fetch(url.toString(), {
      headers: { ...getAuthHeaders() },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { detail?: string }).detail ?? "Failed to fetch passages",
      );
    }
    passages.value = await res.json();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Unknown error";
  } finally {
    loading.value = false;
  }
}

async function fetchTags(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch("/api/lore/tags", {
      headers: { ...getAuthHeaders() },
    });
    if (!res.ok) return;
    allTags.value = await res.json();
  } catch {
    // Silent — tags are supplementary
  }
}

async function readPassage(
  scope: string,
  path: string,
  series?: string,
  story?: string,
): Promise<LorePassageData> {
  const { getAuthHeaders } = useAuth();
  const base = buildScopeUrl(scope, series, story);
  const res = await fetch(
    `${base}/${encodeURIComponent(path)}`,
    { headers: { ...getAuthHeaders() } },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { detail?: string }).detail ?? "Failed to read passage",
    );
  }
  return res.json() as Promise<LorePassageData>;
}

async function writePassage(
  scope: string,
  path: string,
  frontmatter: LorePassageData["frontmatter"],
  content: string,
  series?: string,
  story?: string,
): Promise<void> {
  const { getAuthHeaders } = useAuth();
  const base = buildScopeUrl(scope, series, story);
  const res = await fetch(
    `${base}/${encodeURIComponent(path)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ frontmatter, content }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { detail?: string }).detail ?? "Failed to save passage",
    );
  }
}

async function deletePassage(
  scope: string,
  path: string,
  series?: string,
  story?: string,
): Promise<void> {
  const { getAuthHeaders } = useAuth();
  const base = buildScopeUrl(scope, series, story);
  const res = await fetch(
    `${base}/${encodeURIComponent(path)}`,
    {
      method: "DELETE",
      headers: { ...getAuthHeaders() },
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { detail?: string }).detail ?? "Failed to delete passage",
    );
  }
}

export function useLoreApi(): UseLoreApiReturn {
  return {
    passages,
    allTags,
    loading,
    error,
    fetchPassages,
    fetchTags,
    readPassage,
    writePassage,
    deletePassage,
  };
}

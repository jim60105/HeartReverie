// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import { ref } from "vue";
import { apiFetch, apiFetchJson } from "@/lib/api";
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
  loading.value = true;
  error.value = null;
  try {
    const url = new URL(buildScopeUrl(scope, series, story), location.origin);
    if (tag) url.searchParams.set("tag", tag);
    passages.value = await apiFetchJson<LorePassageMetadata[]>(url.toString(), {
      errorMessage: "Failed to fetch passages",
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Unknown error";
  } finally {
    loading.value = false;
  }
}

async function fetchTags(): Promise<void> {
  try {
    const res = await apiFetch("/api/lore/tags", { throwOnError: false });
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
  const base = buildScopeUrl(scope, series, story);
  return apiFetchJson<LorePassageData>(
    `${base}/${encodeURIComponent(path)}`,
    { errorMessage: "Failed to read passage" },
  );
}

async function writePassage(
  scope: string,
  path: string,
  frontmatter: LorePassageData["frontmatter"],
  content: string,
  series?: string,
  story?: string,
): Promise<void> {
  const base = buildScopeUrl(scope, series, story);
  await apiFetch(`${base}/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frontmatter, content }),
    errorMessage: "Failed to save passage",
  });
}

async function deletePassage(
  scope: string,
  path: string,
  series?: string,
  story?: string,
): Promise<void> {
  const base = buildScopeUrl(scope, series, story);
  await apiFetch(`${base}/${encodeURIComponent(path)}`, {
    method: "DELETE",
    errorMessage: "Failed to delete passage",
  });
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

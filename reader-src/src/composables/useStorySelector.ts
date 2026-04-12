import { ref } from "vue";
import type { UseStorySelectorReturn } from "@/types";
import { useAuth } from "@/composables/useAuth";

const seriesList = ref<string[]>([]);
const storyList = ref<string[]>([]);
const selectedSeries = ref("");
const selectedStory = ref("");

async function fetchSeries(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  const res = await fetch("/api/stories", {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to load series");
  seriesList.value = await res.json();
}

async function fetchStories(series: string): Promise<void> {
  const { getAuthHeaders } = useAuth();
  const res = await fetch(`/api/stories/${encodeURIComponent(series)}`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to load stories");
  storyList.value = await res.json();
}

async function createStory(series: string, name: string): Promise<void> {
  const { getAuthHeaders } = useAuth();
  const res = await fetch(
    `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(name)}/init`,
    { method: "POST", headers: { ...getAuthHeaders() } },
  );
  if (!res.ok) throw new Error("Failed to create story");
  await res.json();
}

export function useStorySelector(): UseStorySelectorReturn {
  return {
    seriesList,
    storyList,
    selectedSeries,
    selectedStory,
    fetchSeries,
    fetchStories,
    createStory,
  };
}

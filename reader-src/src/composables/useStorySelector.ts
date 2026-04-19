import { ref, watch } from "vue";
import { useRoute } from "vue-router";
import router from "@/router";
import type { UseStorySelectorReturn } from "@/types";
import { useAuth } from "@/composables/useAuth";
import { useUsage } from "@/composables/useUsage";

const seriesList = ref<string[]>([]);
const storyList = ref<string[]>([]);
const selectedSeries = ref("");
const selectedStory = ref("");
let initialized = false;

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

function navigateToStory(series: string, story: string): void {
  router.push({ name: "story", params: { series, story } });
}

function initRouteSync(): void {
  if (initialized) return;
  initialized = true;

  const route = useRoute();

  // Handle user-initiated series changes (from dropdown v-model)
  watch(selectedSeries, (series) => {
    // If route already has this series, the route watcher handles fetch
    if (route.params.series === series) return;
    selectedStory.value = "";
    if (series) {
      fetchStories(series);
    }
  });

  // Sync from route params — immediate to handle direct URL loads
  watch(
    () => [route.params.series, route.params.story] as const,
    async ([newSeries, newStory]) => {
      if (newSeries) {
        const s = newSeries as string;
        if (s !== selectedSeries.value) {
          selectedSeries.value = s;
          await fetchStories(s);
        }
      }
      if (newStory) {
        selectedStory.value = newStory as string;
      }
      if (newSeries && newStory) {
        const usage = useUsage();
        usage.reset();
        await usage.load(newSeries as string, newStory as string);
      } else {
        useUsage().reset();
      }
    },
    { immediate: true },
  );
}

export function useStorySelector(): UseStorySelectorReturn {
  initRouteSync();

  return {
    seriesList,
    storyList,
    selectedSeries,
    selectedStory,
    fetchSeries,
    fetchStories,
    createStory,
    navigateToStory,
  };
}

import { effectScope, type EffectScope, ref, watch } from "vue";
import router from "@/router";
import type { UseStorySelectorReturn } from "@/types";
import { useAuth } from "@/composables/useAuth";
import { useUsage } from "@/composables/useUsage";

const seriesList = ref<string[]>([]);
const storyList = ref<string[]>([]);
const selectedSeries = ref("");
const selectedStory = ref("");
let initialized = false;
let routeSyncScope: EffectScope | null = null;

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

  // Detached effect scope so the watchers survive component unmounts. Without
  // this, the watchers get tied to whichever component instance first invoked
  // useStorySelector() (e.g. usePromptEditor on /settings/prompt-editor) and
  // are silently disposed when that component unmounts on navigation away —
  // leaving subsequent mounts of StorySelector with no reactive series→fetch
  // bridge, so the story list never repopulates after the user picks a series.
  //
  // `router.currentRoute` is a ref updated by vue-router on navigation.
  // Watching `route.value.params.series` works because each navigation
  // replaces the route object reachable through `route.value`. We use the
  // ref directly instead of `useRoute()` because `useRoute()` requires a
  // component-instance inject and would throw inside `effectScope.run()`.
  routeSyncScope = effectScope(true);
  const route = router.currentRoute;

  routeSyncScope.run(() => {
    // Handle user-initiated series changes (from dropdown v-model)
    watch(selectedSeries, (series) => {
      // If route already has this series, the route watcher handles fetch
      if (route.value.params.series === series) return;
      selectedStory.value = "";
      if (series) {
        fetchStories(series);
      }
    });

    // Sync from route params — immediate to handle direct URL loads
    watch(
      () => [route.value.params.series, route.value.params.story] as const,
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
  });
}

// Dispose the detached scope on Vite HMR module replace so we don't leave
// stale watchers wired to obsolete module-instance state. Production has no
// HMR; the scope simply lives for the page lifetime.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    routeSyncScope?.stop();
    routeSyncScope = null;
    initialized = false;
  });
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

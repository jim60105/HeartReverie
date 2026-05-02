import { ref, shallowRef, triggerRef, computed, watch } from "vue";
import { useRoute } from "vue-router";
import router from "@/router";
import type {
  UseChapterNavReturn,
  ChapterData,
  StorySwitchContext,
  ChapterChangeContext,
} from "@/types";
import { useAuth } from "@/composables/useAuth";
import { useWebSocket } from "@/composables/useWebSocket";
import { frontendHooks } from "@/lib/plugin-hooks";
import { renderDebug } from "@/lib/render-debug";

const POLL_INTERVAL_BASE = 3000;
const POLL_INTERVAL_MAX = 30000;

// Module-level shared refs
const currentIndex = ref(0);
const chapters = ref<ChapterData[]>([]);
const currentContent = shallowRef<string>("");
/**
 * Render-invalidation epoch. Bumped by `commitContent()` every time chapter
 * content is committed, regardless of byte-equality. Effects that need to
 * re-run on any content commit (e.g. the sidebar relocation watch in
 * `ContentArea.vue`) should track `renderEpoch` rather than `currentContent`,
 * because Vue's `triggerRef` only signals dependents that read the ref.
 */
const renderEpoch = ref(0);
const folderName = ref("");

// Private state
let currentSeries: string | null = null;
let currentStory: string | null = null;
let previousSeries: string | null = null;
let previousStory: string | null = null;
let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let currentPollInterval = POLL_INTERVAL_BASE;
let initialized = false;
let isPolling = false;
let loadToken = 0;

const totalChapters = computed(() => chapters.value.length);
const isFirst = computed(() => currentIndex.value <= 0);
const isLast = computed(() => currentIndex.value >= chapters.value.length - 1);
const isLastChapter = computed(
  () => chapters.value.length > 0 && currentIndex.value === chapters.value.length - 1,
);

function dispatchStorySwitch(nextSeries: string, nextStory: string): void {
  const ctx: StorySwitchContext = {
    previousSeries,
    previousStory,
    series: nextSeries,
    story: nextStory,
  };
  frontendHooks.dispatch("story:switch", ctx);
  previousSeries = nextSeries;
  previousStory = nextStory;
}

function dispatchChapterChange(
  prevIndex: number | null,
  nextIndex: number,
): void {
  if (prevIndex === nextIndex) return;
  if (!currentSeries || !currentStory) return;
  const chapterNumber =
    chapters.value[nextIndex]?.number ?? nextIndex + 1;
  const ctx: ChapterChangeContext = {
    previousIndex: prevIndex,
    index: nextIndex,
    chapter: chapterNumber,
    series: currentSeries,
    story: currentStory,
  };
  frontendHooks.dispatch("chapter:change", ctx);
}

/**
 * Bump `renderEpoch` without touching `currentContent`. Used by callers that
 * need to re-trigger downstream effects (e.g. ContentArea's sidebar
 * relocation watch) after a UI state change that does NOT mutate chapter
 * content but DOES recreate DOM Vue believes is unchanged — for example,
 * leaving edit mode where the v-html template is re-mounted.
 */
function bumpRenderEpoch(): void {
  renderEpoch.value += 1;
}

/**
 * Single source of truth for writes to `currentContent`. Always invalidates
 * downstream computeds and effects, including the byte-identical case (Vue's
 * primitive ref reactivity is `Object.is`-based and would otherwise silently
 * skip the update). `triggerRef` re-fires consumers that read
 * `currentContent`; `renderEpoch` re-fires consumers that don't.
 */
function commitContent(next: string): void {
  if (currentContent.value === next) {
    triggerRef(currentContent);
  } else {
    currentContent.value = next;
  }
  renderEpoch.value += 1;
  renderDebug("chapter-content-committed", {
    series: currentSeries,
    story: currentStory,
    chapterIndex: currentIndex.value,
    contentLength: next.length,
    renderEpoch: renderEpoch.value,
  });
}

function clearPolling(): void {
  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

function restartPollInterval(interval: number): void {
  clearPolling();
  currentPollInterval = interval;
  pollIntervalId = setInterval(pollBackend, currentPollInterval);
}

async function pollBackend(): Promise<void> {
  if (!currentSeries || !currentStory) return;
  if (isPolling) return;
  isPolling = true;
  const series = currentSeries;
  const story = currentStory;
  const { getAuthHeaders } = useAuth();

  try {
    const res = await fetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapters`,
      { headers: { ...getAuthHeaders() } },
    );

    // Discard if story changed during fetch
    if (series !== currentSeries || story !== currentStory) return;

    if (res.status === 429) {
      const backoff = Math.min(currentPollInterval * 2, POLL_INTERVAL_MAX);
      restartPollInterval(backoff);
      return;
    }

    if (currentPollInterval !== POLL_INTERVAL_BASE) {
      restartPollInterval(POLL_INTERVAL_BASE);
    }

    const nums: number[] = await res.json();
    const cachedLen = chapters.value.length;

    if (nums.length !== cachedLen) {
      // New chapters detected — reload all and navigate to last
      await loadFromBackendInternal(series, story);
      if (series !== currentSeries || story !== currentStory) return;
      if (chapters.value.length > 0) {
        navigateTo(chapters.value.length - 1);
      }
      return;
    }

    // Poll the last chapter's content for streaming updates
    if (nums.length > 0 && chapters.value.length > 0) {
      const lastNum = nums[nums.length - 1]!;
      const chRes = await fetch(
        `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapters/${lastNum}`,
        { headers: { ...getAuthHeaders() } },
      );
      if (series !== currentSeries || story !== currentStory) return;
      if (!chRes.ok) return;
      const { content, stateDiff } = (await chRes.json()) as { content: string; stateDiff?: import("@/types").StateDiffPayload };
      const lastIdx = chapters.value.length - 1;
      if (content !== chapters.value[lastIdx]?.content) {
        chapters.value[lastIdx] = { ...chapters.value[lastIdx]!, number: lastNum as number, content, stateDiff };
        if (currentIndex.value === lastIdx) {
          commitContent(content);
        }
      }
    }
  } catch {
    // Ignore polling errors silently
  } finally {
    isPolling = false;
  }
}

/** Push the current chapter to the URL. */
function syncRoute(): void {
  if (!currentSeries || !currentStory) return;
  if (chapters.value.length === 0) return;
  router.replace({
    name: "chapter",
    params: {
      series: currentSeries,
      story: currentStory,
      chapter: String(currentIndex.value + 1),
    },
  });
}

function navigateTo(index: number): void {
  if (index < 0 || index >= chapters.value.length) return;
  const prev = currentIndex.value;
  currentIndex.value = index;
  commitContent(chapters.value[index]?.content ?? "");
  dispatchChapterChange(prev, index);
}

function next(): void {
  navigateTo(currentIndex.value + 1);
}

function previous(): void {
  navigateTo(currentIndex.value - 1);
}

function goToFirst(): void {
  if (chapters.value.length === 0) return;
  navigateTo(0);
}

function goToLast(): void {
  const lastIdx = chapters.value.length - 1;
  if (lastIdx < 0) return;
  navigateTo(lastIdx);
}

async function loadFromBackendInternal(
  series: string,
  story: string,
): Promise<void> {
  const { getAuthHeaders } = useAuth();

  const res = await fetch(
    `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapters?include=content`,
    { headers: { ...getAuthHeaders() } },
  );
  if (!res.ok) throw new Error("Failed to load chapters");
  const loaded: ChapterData[] = await res.json();

  chapters.value = loaded;
}

async function loadFromBackend(
  series: string,
  story: string,
  startChapter?: number,
): Promise<void> {
  clearPolling();
  const token = ++loadToken;
  const priorSeries = currentSeries;
  const priorStory = currentStory;
  currentSeries = series;
  currentStory = story;
  folderName.value = `${series} / ${story}`;

  // Dispatch story:switch only for real transitions (different series/story).
  // Reloads of the same story MUST NOT fire the hook.
  const isTransition = priorSeries !== series || priorStory !== story;
  if (isTransition) {
    dispatchStorySwitch(series, story);
  }

  await loadFromBackendInternal(series, story);
  // Discard stale result if a newer load was triggered
  if (token !== loadToken) return;

  if (chapters.value.length === 0) {
    commitContent("");
    currentIndex.value = 0;
    startPollingIfNeeded();
    return;
  }

  const startIdx = startChapter
    ? Math.max(0, Math.min(startChapter - 1, chapters.value.length - 1))
    : 0;
  currentIndex.value = startIdx;
  commitContent(chapters.value[startIdx]?.content ?? "");
  if (isTransition) {
    dispatchChapterChange(null, startIdx);
  }

  syncRoute();
  sendSubscribeIfConnected();
  startPollingIfNeeded();
}

async function reloadToLast(): Promise<void> {
  if (!currentSeries || !currentStory) return;
  clearPolling();
  const token = ++loadToken;

  await loadFromBackendInternal(currentSeries, currentStory);
  if (token !== loadToken) return;

  if (chapters.value.length === 0) {
    startPollingIfNeeded();
    return;
  }

  const prevIdx = currentIndex.value;
  const lastIdx = chapters.value.length - 1;
  currentIndex.value = lastIdx;
  commitContent(chapters.value[lastIdx]?.content ?? "");
  dispatchChapterChange(prevIdx, lastIdx);

  syncRoute();
  startPollingIfNeeded();
}

/**
 * Reload chapters after a chapter edit and stay on the chapter the user
 * just edited (clamped into range when chapters were truncated). Forces a
 * content invalidation via `commitContent` even when the new on-disk text
 * is byte-identical, so the markdown renderer re-runs and
 * `chapter:render:after` re-fires.
 */
async function refreshAfterEdit(targetChapter: number): Promise<void> {
  if (!currentSeries || !currentStory) return;
  clearPolling();
  const token = ++loadToken;

  await loadFromBackendInternal(currentSeries, currentStory);
  if (token !== loadToken) return;

  if (chapters.value.length === 0) {
    currentIndex.value = 0;
    commitContent("");
    startPollingIfNeeded();
    return;
  }

  const targetIdx = Math.max(
    0,
    Math.min(targetChapter - 1, chapters.value.length - 1),
  );
  const prevIdx = currentIndex.value;
  currentIndex.value = targetIdx;
  commitContent(chapters.value[targetIdx]?.content ?? "");
  if (prevIdx !== targetIdx) dispatchChapterChange(prevIdx, targetIdx);

  syncRoute();
  startPollingIfNeeded();
}

function getBackendContext(): {
  series: string | null;
  story: string | null;
  isBackendMode: boolean;
} {
  return {
    series: currentSeries,
    story: currentStory,
    isBackendMode: currentSeries !== null && currentStory !== null,
  };
}

/** Send a subscribe message if WebSocket is connected and authenticated. */
function sendSubscribeIfConnected(): void {
  if (!currentSeries || !currentStory) return;
  const { isConnected, isAuthenticated, send } = useWebSocket();
  if (isConnected.value && isAuthenticated.value) {
    send({ type: 'subscribe', series: currentSeries, story: currentStory });
  }
}

/** Start polling only when WebSocket is not connected. */
function startPollingIfNeeded(): void {
  const { isConnected } = useWebSocket();
  if (!isConnected.value) {
    pollIntervalId = setInterval(pollBackend, POLL_INTERVAL_BASE);
  }
}

function initRouteSync(): void {
  if (initialized) return;
  initialized = true;

  const route = useRoute();

  // Sync URL when chapter changes
  watch(currentIndex, () => {
    syncRoute();
  });

  // Handle external route changes — chapter (browser back/forward)
  watch(
    () => route.params.chapter,
    (newChapter) => {
      if (!newChapter) return;
      const idx = parseInt(newChapter as string, 10) - 1;
      if (idx >= 0 && idx < chapters.value.length && idx !== currentIndex.value) {
        const prev = currentIndex.value;
        currentIndex.value = idx;
        commitContent(chapters.value[idx]?.content ?? "");
        dispatchChapterChange(prev, idx);
      }
    },
  );

  // Handle external route changes — different story (browser back/forward)
  watch(
    () => [route.params.series, route.params.story] as const,
    async ([newSeries, newStory]) => {
      if (!newSeries || !newStory) return;
      const s = newSeries as string;
      const st = newStory as string;
      if (s === currentSeries && st === currentStory) return;
      const chapterParam = route.params.chapter;
      const startChapter = chapterParam
        ? parseInt(chapterParam as string, 10)
        : undefined;
      await loadFromBackend(s, st, startChapter);
    },
  );

  // ── WebSocket integration ──

  const { isConnected, onMessage: wsOnMessage } = useWebSocket();

  // chapters:updated — reload chapters when count changes
  wsOnMessage('chapters:updated', async (msg) => {
    if (msg.series !== currentSeries || msg.story !== currentStory) return;
    const prevLen = chapters.value.length;
    await loadFromBackendInternal(msg.series, msg.story);
    if (chapters.value.length > prevLen) {
      navigateTo(chapters.value.length - 1);
    }
  });

  // chapters:content — update chapter content in-place
  wsOnMessage('chapters:content', (msg) => {
    if (msg.series !== currentSeries || msg.story !== currentStory) return;
    const lastIdx = chapters.value.length - 1;
    if (lastIdx < 0) return;
    if (msg.chapter !== chapters.value[lastIdx]!.number) return;
    chapters.value[lastIdx] = { ...chapters.value[lastIdx]!, content: msg.content, stateDiff: msg.stateDiff };
    if (currentIndex.value === lastIdx) {
      commitContent(msg.content);
    }
  });

  // Re-subscribe on reconnect
  wsOnMessage('auth:ok', () => {
    sendSubscribeIfConnected();
  });

  // Toggle polling based on WebSocket connection state
  watch(isConnected, (connected) => {
    if (connected) {
      clearPolling();
      sendSubscribeIfConnected();
    } else {
      if (!pollIntervalId && currentSeries && currentStory) {
        pollIntervalId = setInterval(pollBackend, POLL_INTERVAL_BASE);
      }
    }
  });
}

export function useChapterNav(): UseChapterNavReturn {
  initRouteSync();

  return {
    currentIndex,
    chapters,
    totalChapters,
    isFirst,
    isLast,
    isLastChapter,
    currentContent,
    renderEpoch,
    folderName,
    next,
    previous,
    goToFirst,
    goToLast,
    loadFromBackend,
    reloadToLast,
    refreshAfterEdit,
    bumpRenderEpoch,
    getBackendContext,
  };
}

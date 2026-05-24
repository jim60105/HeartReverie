import { ref, shallowRef, triggerRef, computed, watch } from "vue";
import { useRoute } from "vue-router";
import router from "@/router";
import type {
  UseChapterNavReturn,
  ChapterData,
  StorySwitchContext,
  ChapterChangeContext,
} from "@/types";
import { useWebSocket } from "@/composables/useWebSocket";
import { apiFetch, apiFetchJson } from "@/lib/api";
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
 * content is committed, regardless of byte-equality, and by
 * `notifyRenderInvalidated()` / `forceTokenRemount()`. This is a
 * **notification** signal: effects that need to re-run on any content
 * commit (e.g. the sidebar relocation watch in `ContentArea.vue` and the
 * `chapter:dom:ready` dispatch watch in `ChapterContent.vue`) should track
 * `renderEpoch` rather than `currentContent` because Vue's `triggerRef`
 * only signals dependents that read the ref. `renderEpoch` MUST NOT be
 * used as a v-for key — keying on it would force a remount on every
 * streaming chunk and snap the user's scroll position to the top.
 */
const renderEpoch = ref(0);
/**
 * Force-remount token. Distinct from `renderEpoch`: this counter is
 * consulted by `ChapterContent.vue`'s v-for `:key`, so a bump unmounts
 * and remounts each rendered token element even when its bound v-html
 * string is byte-identical. Bumped ONLY by `forceTokenRemount()`. It is
 * NOT bumped by `commitContent()` or `notifyRenderInvalidated()`, so
 * ordinary streaming commits keep the v-html DOM stable and preserve
 * the reader's scroll position.
 */
const remountToken = ref(0);
const folderName = ref("");

// Private state
const currentSeries = ref<string | null>(null);
const currentStory = ref<string | null>(null);
let previousSeries: string | null = null;
let previousStory: string | null = null;
let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let currentPollInterval = POLL_INTERVAL_BASE;
let initialized = false;
let isPolling = false;
let loadToken = 0;

const totalChapters = computed(() => chapters.value.length);
const chapterCount = totalChapters;

/**
 * Client-side equivalent of the backend `parseChapterForContinue` empty-check.
 * Returns true when there are no chapters OR the latest chapter has no
 * meaningful content. Mirrors backend semantics: a chapter is considered
 * empty only when BOTH the `<user_message>` body and the prose outside it
 * are empty/whitespace.
 */
const latestChapterIsEmpty = computed(() => {
  if (chapters.value.length === 0) return true;
  const last = chapters.value[chapters.value.length - 1];
  const raw = last?.content ?? "";
  // Extract first <user_message>…</user_message> body (case-insensitive,
  // matching the backend regex).
  const match = raw.match(/<user_message>([\s\S]*?)<\/user_message>/i);
  const userMessageText = (match?.[1] ?? "").trim();
  // Remove all <user_message>…</user_message> blocks (any case) from the
  // prose so the prefill check matches what the backend would compute via
  // `stripPromptTags()` for this tag.
  const prose = raw.replace(/<user_message>[\s\S]*?<\/user_message>/gi, "").trim();
  return userMessageText === "" && prose === "";
});

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
    chapters: chapters.value.map((c) => ({ number: c.number })),
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
  if (!currentSeries.value || !currentStory.value) return;
  const chapterNumber =
    chapters.value[nextIndex]?.number ?? nextIndex + 1;
  const ctx: ChapterChangeContext = {
    previousIndex: prevIndex,
    index: nextIndex,
    chapter: chapterNumber,
    series: currentSeries.value,
    story: currentStory.value,
  };
  frontendHooks.dispatch("chapter:change", ctx);
}

/**
 * Notification-only render invalidation: bumps `renderEpoch` so downstream
 * watchers (`chapter:dom:ready` dispatch, `ContentArea` sidebar relocation)
 * re-run, but does NOT bump `remountToken`. Use this when a caller needs
 * downstream effects to re-run but has NOT externally mutated the rendered
 * DOM. Canonical caller: `usePlugins.ts#subscribeSettingsChanged` after a
 * plugin's settings change — plugins re-walk the existing rendered DOM and
 * re-apply; no v-html remount is required.
 */
function notifyRenderInvalidated(): void {
  renderEpoch.value += 1;
}

/**
 * Force a remount of `ChapterContent`'s rendered token elements even when
 * the token strings are byte-identical to the previous render. Bumps BOTH
 * `remountToken` (drives the v-for `:key` change that triggers the remount)
 * AND `renderEpoch` (so notification-only watchers still fire). Use ONLY
 * when a caller has externally mutated the rendered DOM in a way Vue
 * cannot recover from (e.g. `ContentArea`'s sidebar relocation watch
 * `appendChild`ing `.plugin-sidebar` out of the v-html div). Sole
 * legitimate caller today: `ChapterContent.vue#cancelEditAction`. Do NOT
 * add new call sites without documenting why a byte-identical remount is
 * needed.
 */
function forceTokenRemount(): void {
  remountToken.value += 1;
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
  // remountToken intentionally not bumped here: streaming commits must not
  // cause v-for remount of ChapterContent's token list.
  renderEpoch.value += 1;
  renderDebug("chapter-content-committed", {
    series: currentSeries.value,
    story: currentStory.value,
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
  if (!currentSeries.value || !currentStory.value) return;
  if (isPolling) return;
  isPolling = true;
  const series = currentSeries.value;
  const story = currentStory.value;

  try {
    const res = await apiFetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapters`,
      { throwOnError: false },
    );

    // Discard if story changed during fetch
    if (series !== currentSeries.value || story !== currentStory.value) return;

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
      // New chapters detected — reload all and navigate to last atomically.
      const loaded = await loadFromBackendInternal(series, story);
      if (series !== currentSeries.value || story !== currentStory.value) return;
      const prev = currentIndex.value;
      if (loaded.length > 0) {
        const lastIdx = loaded.length - 1;
        // Atomic: assign currentIndex first, then chapters, so default-flush
        // consumers and plugin hooks never see (length=N_new, index=stale).
        currentIndex.value = lastIdx;
        chapters.value = loaded;
        commitContent(loaded[lastIdx]?.content ?? "");
        dispatchChapterChange(prev, lastIdx);
      } else {
        // Atomic: reset index + content together with the empty array so
        // consumers never see a stale-high index against a zero-length array.
        currentIndex.value = 0;
        chapters.value = loaded;
        commitContent("");
      }
      return;
    }

    // Poll the last chapter's content for streaming updates
    if (nums.length > 0 && chapters.value.length > 0) {
      const lastNum = nums[nums.length - 1]!;
      const chRes = await apiFetch(
        `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapters/${lastNum}`,
        { throwOnError: false },
      );
      if (series !== currentSeries.value || story !== currentStory.value) return;
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
  if (!currentSeries.value || !currentStory.value) return;
  if (chapters.value.length === 0) return;
  router.replace({
    name: "chapter",
    params: {
      series: currentSeries.value,
      story: currentStory.value,
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
): Promise<ChapterData[]> {
  const loaded = await apiFetchJson<ChapterData[]>(
    `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapters?include=content`,
    { errorMessage: "Failed to load chapters" },
  );

  return loaded;
}

async function loadFromBackend(
  series: string,
  story: string,
  startChapter?: number,
  options?: { syncRoute?: boolean },
): Promise<void> {
  clearPolling();
  const token = ++loadToken;
  currentSeries.value = series;
  currentStory.value = story;
  folderName.value = `${series} / ${story}`;

  // Dispatch story:switch only for real transitions (different series/story).
  // Reloads of the same story MUST NOT fire the hook.
  // Use previousSeries/previousStory (only updated after successful dispatch)
  // to detect transitions — this handles the race where a stale-guarded call
  // pre-sets currentSeries before this call completes.
  const isTransition = previousSeries !== series || previousStory !== story;

  const loaded = await loadFromBackendInternal(series, story);
  // Discard stale result if a newer load was triggered
  if (token !== loadToken) return;

  if (loaded.length === 0) {
    // Atomic: clear both refs together before any hook / commit.
    currentIndex.value = 0;
    chapters.value = loaded;
    commitContent("");
    startPollingIfNeeded();
    return;
  }

  const startIdx = startChapter
    ? Math.max(0, Math.min(startChapter - 1, loaded.length - 1))
    : 0;

  // Atomic update: assign currentIndex and chapters in the same synchronous
  // block (no await, no nextTick) BEFORE any plugin-hook dispatch, so that
  // default-flush consumers (e.g. `showChatInput`) and plugin hooks never
  // observe (chapters.length=N_new, currentIndex=stale_high).
  currentIndex.value = startIdx;
  chapters.value = loaded;

  if (isTransition) {
    dispatchStorySwitch(series, story);
  }

  commitContent(loaded[startIdx]?.content ?? "");
  if (isTransition) {
    dispatchChapterChange(null, startIdx);
  }

  if (options?.syncRoute !== false) {
    syncRoute();
  }
  sendSubscribeIfConnected();
  startPollingIfNeeded();
}

async function reloadToLast(): Promise<void> {
  if (!currentSeries.value || !currentStory.value) return;
  clearPolling();
  const token = ++loadToken;

  const loaded = await loadFromBackendInternal(currentSeries.value, currentStory.value);
  if (token !== loadToken) return;

  if (loaded.length === 0) {
    // Atomic: reset index + content together with the empty array.
    currentIndex.value = 0;
    chapters.value = loaded;
    commitContent("");
    startPollingIfNeeded();
    return;
  }

  const prevIdx = currentIndex.value;
  const lastIdx = loaded.length - 1;
  // Atomic update before any plugin-hook dispatch.
  currentIndex.value = lastIdx;
  chapters.value = loaded;
  commitContent(loaded[lastIdx]?.content ?? "");
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
  if (!currentSeries.value || !currentStory.value) return;
  clearPolling();
  const token = ++loadToken;

  const loaded = await loadFromBackendInternal(currentSeries.value, currentStory.value);
  if (token !== loadToken) return;

  if (loaded.length === 0) {
    currentIndex.value = 0;
    chapters.value = loaded;
    commitContent("");
    startPollingIfNeeded();
    return;
  }

  const targetIdx = Math.max(
    0,
    Math.min(targetChapter - 1, loaded.length - 1),
  );
  const prevIdx = currentIndex.value;
  // Atomic update before any plugin-hook dispatch.
  currentIndex.value = targetIdx;
  chapters.value = loaded;
  commitContent(loaded[targetIdx]?.content ?? "");
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
    series: currentSeries.value,
    story: currentStory.value,
    isBackendMode: currentSeries.value !== null && currentStory.value !== null,
  };
}

/** Send a subscribe message if WebSocket is connected and authenticated. */
function sendSubscribeIfConnected(): void {
  if (!currentSeries.value || !currentStory.value) return;
  const { isConnected, isAuthenticated, send } = useWebSocket();
  if (isConnected.value && isAuthenticated.value) {
    send({ type: 'subscribe', series: currentSeries.value, story: currentStory.value });
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
      if (s === currentSeries.value && st === currentStory.value) return;
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
    if (msg.series !== currentSeries.value || msg.story !== currentStory.value) return;
    const prevLen = chapters.value.length;
    const loaded = await loadFromBackendInternal(msg.series, msg.story);
    if (msg.series !== currentSeries.value || msg.story !== currentStory.value) return;
    if (loaded.length > prevLen && loaded.length > 0) {
      // Atomic update: jump to the new last chapter without leaving a
      // (chapters.length=N+k, currentIndex=stale) window for default-flush
      // consumers (e.g. `showChatInput`) or plugin hooks.
      const lastIdx = loaded.length - 1;
      const prev = currentIndex.value;
      currentIndex.value = lastIdx;
      chapters.value = loaded;
      commitContent(loaded[lastIdx]?.content ?? "");
      dispatchChapterChange(prev, lastIdx);
    } else if (loaded.length === 0) {
      // Atomic: reset index + content alongside the empty array so stale-high
      // currentIndex never lingers against a now-empty chapters array.
      currentIndex.value = 0;
      chapters.value = loaded;
      commitContent("");
    } else {
      // Shrink (still non-empty): clamp currentIndex into the new range
      // BEFORE swapping the array so consumers never observe a stale-high
      // index against the shorter chapters list.
      const clampedIdx = Math.min(currentIndex.value, loaded.length - 1);
      if (clampedIdx !== currentIndex.value) {
        currentIndex.value = clampedIdx;
      }
      chapters.value = loaded;
      commitContent(loaded[clampedIdx]?.content ?? "");
    }
  });

  // chapters:content — update chapter content in-place
  wsOnMessage('chapters:content', (msg) => {
    if (msg.series !== currentSeries.value || msg.story !== currentStory.value) return;
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
      if (!pollIntervalId && currentSeries.value && currentStory.value) {
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
    chapterCount,
    latestChapterIsEmpty,
    isFirst,
    isLast,
    isLastChapter,
    currentContent,
    renderEpoch,
    remountToken,
    folderName,
    next,
    previous,
    goToFirst,
    goToLast,
    loadFromBackend,
    reloadToLast,
    refreshAfterEdit,
    notifyRenderInvalidated,
    forceTokenRemount,
    getBackendContext,
  };
}

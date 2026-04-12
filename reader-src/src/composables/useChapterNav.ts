import { ref, computed, watch } from "vue";
import { useRoute } from "vue-router";
import router from "@/router";
import type { UseChapterNavReturn, ChapterData } from "@/types";
import { useAuth } from "@/composables/useAuth";
import { useFileReader } from "@/composables/useFileReader";
import { isNumericMdFile, numericSort } from "@/lib/file-utils";

const POLL_INTERVAL_BASE = 3000;
const POLL_INTERVAL_MAX = 30000;

// Module-level shared refs
const currentIndex = ref(0);
const chapters = ref<ChapterData[]>([]);
const currentContent = ref("");
const mode = ref<"fsa" | "backend">("fsa");
const folderName = ref("");
const fsaFiles = ref<FileSystemFileHandle[]>([]);

// Private state
let currentSeries: string | null = null;
let currentStory: string | null = null;
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

async function listChapterFiles(
  dirHandle: FileSystemDirectoryHandle,
): Promise<FileSystemFileHandle[]> {
  const entries: { name: string; handle: FileSystemFileHandle }[] = [];
  for await (const [name, handle] of dirHandle) {
    if (handle.kind === "file" && isNumericMdFile(name)) {
      entries.push({ name, handle: handle as FileSystemFileHandle });
    }
  }
  entries.sort((a, b) => numericSort(a.name, b.name));
  return entries.map((e) => e.handle);
}

async function pollDirectory(): Promise<void> {
  const { directoryHandle } = useFileReader();
  if (!directoryHandle.value) return;
  try {
    const newFiles = await listChapterFiles(directoryHandle.value);
    if (newFiles.length !== fsaFiles.value.length) {
      fsaFiles.value = newFiles;
      // Update chapters array to reflect new file count
      chapters.value = newFiles.map((_, i) => ({
        number: i + 1,
        content: i === currentIndex.value ? currentContent.value : "",
      }));
    }
  } catch {
    // Directory may have been removed or permission revoked
  }
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
      const { content } = (await chRes.json()) as { content: string };
      const lastIdx = chapters.value.length - 1;
      if (content !== chapters.value[lastIdx]?.content) {
        chapters.value[lastIdx] = { ...chapters.value[lastIdx]!, number: lastNum as number, content };
        if (currentIndex.value === lastIdx) {
          currentContent.value = content;
        }
      }
    }
  } catch {
    // Ignore polling errors silently
  } finally {
    isPolling = false;
  }
}

/** Push the current chapter to the URL in backend mode. */
function syncRoute(): void {
  if (mode.value !== "backend" || !currentSeries || !currentStory) return;
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
  currentIndex.value = index;
  currentContent.value = chapters.value[index]?.content ?? "";
}

async function loadFSAChapter(index: number): Promise<void> {
  if (index < 0 || index >= fsaFiles.value.length) return;
  const { readFile } = useFileReader();
  const content = await readFile(fsaFiles.value[index]!);
  chapters.value[index] = { number: index + 1, content };
  currentIndex.value = index;
  currentContent.value = content;
}

function next(): void {
  const nextIdx = currentIndex.value + 1;
  if (mode.value === "fsa") {
    loadFSAChapter(nextIdx);
  } else {
    navigateTo(nextIdx);
  }
}

function previous(): void {
  const prevIdx = currentIndex.value - 1;
  if (mode.value === "fsa") {
    loadFSAChapter(prevIdx);
  } else {
    navigateTo(prevIdx);
  }
}

async function loadFromFSA(handle: FileSystemDirectoryHandle): Promise<void> {
  clearPolling();
  mode.value = "fsa";
  currentSeries = null;
  currentStory = null;
  folderName.value = handle.name;
  router.replace({ name: "home" }).catch(() => {});

  const fileHandles = await listChapterFiles(handle);
  fsaFiles.value = fileHandles;

  if (fileHandles.length === 0) {
    chapters.value = [];
    currentContent.value = "";
    currentIndex.value = 0;
    return;
  }

  // Build initial chapter data
  const { readFile } = useFileReader();
  const chapterData: ChapterData[] = [];
  for (let i = 0; i < fileHandles.length; i++) {
    const content = await readFile(fileHandles[i]!);
    chapterData.push({ number: i + 1, content });
  }
  chapters.value = chapterData;

  currentIndex.value = 0;
  currentContent.value = chapters.value[currentIndex.value]?.content ?? "";

  // Start FSA polling (1s interval)
  pollIntervalId = setInterval(pollDirectory, 1000);
}

async function loadFromBackendInternal(
  series: string,
  story: string,
): Promise<void> {
  const { getAuthHeaders } = useAuth();

  const res = await fetch(
    `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapters`,
    { headers: { ...getAuthHeaders() } },
  );
  if (!res.ok) throw new Error("Failed to load chapters");
  const chapterNums: number[] = await res.json();

  const loaded: ChapterData[] = [];
  for (const num of chapterNums) {
    const chRes = await fetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapters/${num}`,
      { headers: { ...getAuthHeaders() } },
    );
    if (!chRes.ok) continue;
    const { content } = (await chRes.json()) as { content: string };
    loaded.push({ number: num, content });
  }

  chapters.value = loaded;
}

async function loadFromBackend(
  series: string,
  story: string,
  startChapter?: number,
): Promise<void> {
  clearPolling();
  const token = ++loadToken;
  mode.value = "backend";
  fsaFiles.value = [];
  currentSeries = series;
  currentStory = story;
  folderName.value = `${series} / ${story}`;

  await loadFromBackendInternal(series, story);
  // Discard stale result if a newer load was triggered
  if (token !== loadToken) return;

  if (chapters.value.length === 0) {
    currentContent.value = "";
    currentIndex.value = 0;
    pollIntervalId = setInterval(pollBackend, POLL_INTERVAL_BASE);
    return;
  }

  const startIdx = startChapter
    ? Math.max(0, Math.min(startChapter - 1, chapters.value.length - 1))
    : 0;
  currentIndex.value = startIdx;
  currentContent.value = chapters.value[startIdx]?.content ?? "";

  syncRoute();
  pollIntervalId = setInterval(pollBackend, POLL_INTERVAL_BASE);
}

async function reloadToLast(): Promise<void> {
  if (!currentSeries || !currentStory) return;
  clearPolling();
  const token = ++loadToken;

  await loadFromBackendInternal(currentSeries, currentStory);
  if (token !== loadToken) return;

  if (chapters.value.length === 0) {
    pollIntervalId = setInterval(pollBackend, POLL_INTERVAL_BASE);
    return;
  }

  const lastIdx = chapters.value.length - 1;
  currentIndex.value = lastIdx;
  currentContent.value = chapters.value[lastIdx]?.content ?? "";

  syncRoute();
  pollIntervalId = setInterval(pollBackend, POLL_INTERVAL_BASE);
}

function getBackendContext(): {
  series: string | null;
  story: string | null;
  isBackendMode: boolean;
} {
  return {
    series: currentSeries,
    story: currentStory,
    isBackendMode: mode.value === "backend",
  };
}

function initRouteSync(): void {
  if (initialized) return;
  initialized = true;

  const route = useRoute();

  // Sync URL when chapter changes in backend mode
  watch(currentIndex, () => {
    syncRoute();
  });

  // Handle external route changes — chapter (browser back/forward)
  watch(
    () => route.params.chapter,
    (newChapter) => {
      if (!newChapter || mode.value !== "backend") return;
      const idx = parseInt(newChapter as string, 10) - 1;
      if (idx >= 0 && idx < chapters.value.length && idx !== currentIndex.value) {
        currentIndex.value = idx;
        currentContent.value = chapters.value[idx]?.content ?? "";
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
    mode,
    folderName,
    next,
    previous,
    loadFromFSA,
    loadFromBackend,
    reloadToLast,
    getBackendContext,
  };
}

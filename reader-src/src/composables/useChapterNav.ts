import { ref, computed, watch, onUnmounted } from "vue";
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
  const { getAuthHeaders } = useAuth();

  try {
    const res = await fetch(
      `/api/stories/${encodeURIComponent(currentSeries)}/${encodeURIComponent(currentStory)}/chapters`,
      { headers: { ...getAuthHeaders() } },
    );

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
      await loadFromBackendInternal(currentSeries, currentStory);
      if (chapters.value.length > 0) {
        navigateTo(chapters.value.length - 1);
      }
      return;
    }

    // Poll the last chapter's content for streaming updates
    if (nums.length > 0 && chapters.value.length > 0) {
      const lastNum = nums[nums.length - 1]!;
      const chRes = await fetch(
        `/api/stories/${encodeURIComponent(currentSeries)}/${encodeURIComponent(currentStory)}/chapters/${lastNum}`,
        { headers: { ...getAuthHeaders() } },
      );
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
  }
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

  // Check URL hash for starting chapter
  const hashMatch = window.location.hash.match(/chapter=(\d+)/);
  const startIndex = hashMatch
    ? Math.min(parseInt(hashMatch[1]!, 10) - 1, fileHandles.length - 1)
    : 0;

  currentIndex.value = Math.max(0, startIndex);
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

async function loadFromBackend(series: string, story: string): Promise<void> {
  clearPolling();
  mode.value = "backend";
  fsaFiles.value = [];
  currentSeries = series;
  currentStory = story;
  folderName.value = `${series} / ${story}`;

  await loadFromBackendInternal(series, story);

  if (chapters.value.length === 0) {
    currentContent.value = "";
    currentIndex.value = 0;
    // Keep polling so new chapters are detected after send/resend
    pollIntervalId = setInterval(pollBackend, POLL_INTERVAL_BASE);
    return;
  }

  currentIndex.value = 0;
  currentContent.value = chapters.value[0]?.content ?? "";

  pollIntervalId = setInterval(pollBackend, POLL_INTERVAL_BASE);
}

async function reloadToLast(): Promise<void> {
  if (!currentSeries || !currentStory) return;
  clearPolling();

  await loadFromBackendInternal(currentSeries, currentStory);

  if (chapters.value.length === 0) {
    pollIntervalId = setInterval(pollBackend, POLL_INTERVAL_BASE);
    return;
  }

  const lastIdx = chapters.value.length - 1;
  currentIndex.value = lastIdx;
  currentContent.value = chapters.value[lastIdx]?.content ?? "";

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

function initHashSync(): void {
  if (initialized) return;
  initialized = true;

  // Sync URL hash on chapter change
  watch(currentIndex, (idx) => {
    if (chapters.value.length > 0) {
      history.replaceState(null, "", `#chapter=${idx + 1}`);
    }
  });

  // Listen for hash changes
  window.addEventListener("hashchange", () => {
    if (chapters.value.length === 0) return;
    const match = window.location.hash.match(/chapter=(\d+)/);
    if (!match) return;
    const idx = parseInt(match[1]!, 10) - 1;
    if (idx >= 0 && idx < chapters.value.length && idx !== currentIndex.value) {
      if (mode.value === "fsa") {
        loadFSAChapter(idx);
      } else {
        navigateTo(idx);
      }
    }
  });
}

export function useChapterNav(): UseChapterNavReturn {
  initHashSync();

  onUnmounted(() => {
    clearPolling();
  });

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

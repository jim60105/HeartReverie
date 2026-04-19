import { stubSessionStorage } from "@/__tests__/setup";
import { nextTick, reactive, ref } from "vue";

const routeParams = reactive<Record<string, string | undefined>>({});
const wsConnected = ref(false);
const wsAuthenticated = ref(true);
const wsSend = vi.fn();
const wsHandlers = new Map<string, (msg: any) => void>();
const wsOnMessage = vi.fn((type: string, handler: (msg: any) => void) => {
  wsHandlers.set(type, handler);
  return vi.fn(() => wsHandlers.delete(type));
});

const directoryHandleRef = ref<FileSystemDirectoryHandle | null>(null);
const readFileMock = vi.fn(async (handle: any) => String(handle.__content ?? ""));

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: routeParams }),
}));

vi.mock("@/router", () => ({
  default: {
    replace: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({}),
  }),
}));

vi.mock("@/composables/useFileReader", () => ({
  useFileReader: () => ({
    isSupported: ref(true),
    directoryHandle: directoryHandleRef,
    files: ref([]),
    hasStoredHandle: ref(false),
    openDirectory: vi.fn(),
    restoreHandle: vi.fn(),
    readFile: readFileMock,
    clearStoredHandle: vi.fn(),
  }),
}));

vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: () => ({
    isConnected: wsConnected,
    isAuthenticated: wsAuthenticated,
    send: wsSend,
    onMessage: wsOnMessage,
  }),
}));

function chapterListResponse(chapters: Array<{ number: number; content: string }>) {
  return {
    ok: true,
    status: 200,
    json: async () => chapters,
    headers: new Headers(),
  };
}

function chapterNumbersResponse(nums: number[]) {
  return {
    ok: true,
    status: 200,
    json: async () => nums,
    headers: new Headers(),
  };
}

function chapterContentResponse(content: string, chapter: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content, chapter }),
    headers: new Headers(),
  };
}

function createFsaHandle(entries: Array<{ name: string; kind: "file" | "directory"; content?: string }>) {
  return {
    name: "local-story",
    async *[Symbol.asyncIterator]() {
      for (const entry of entries) {
        if (entry.kind === "file") {
          yield [
            entry.name,
            { kind: "file", __content: entry.content ?? "" } as unknown as FileSystemFileHandle,
          ] as [string, FileSystemFileHandle];
        } else {
          yield [
            entry.name,
            { kind: "directory" } as unknown as FileSystemDirectoryHandle,
          ] as [string, FileSystemDirectoryHandle];
        }
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe("useChapterNav coverage branches", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    routeParams.series = undefined;
    routeParams.story = undefined;
    routeParams.chapter = undefined;
    wsConnected.value = false;
    wsAuthenticated.value = true;
    wsSend.mockReset();
    wsHandlers.clear();
    wsOnMessage.mockClear();
    readFileMock.mockClear();
    directoryHandleRef.value = null;
    vi.spyOn(globalThis, "setInterval").mockReturnValue(1 as unknown as ReturnType<typeof setInterval>);
    vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function getNav() {
    const mod = await import("@/composables/useChapterNav");
    return mod.useChapterNav();
  }

  async function flushReactive() {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("loadFromFSA builds chapters, dispatches initial state and starts directory polling", async () => {
    const nav = await getNav();
    const handle = createFsaHandle([
      { name: "2.md", kind: "file", content: "second" },
      { name: "1.md", kind: "file", content: "first" },
      { name: "note.txt", kind: "file", content: "ignored" },
    ]);
    directoryHandleRef.value = handle;

    await nav.loadFromFSA(handle);

    expect(nav.mode.value).toBe("fsa");
    expect(nav.folderName.value).toBe("local-story");
    expect(nav.chapters.value).toEqual([
      { number: 1, content: "first" },
      { number: 2, content: "second" },
    ]);
    expect(nav.currentIndex.value).toBe(0);
    expect(nav.currentContent.value).toBe("first");
    expect(setInterval).toHaveBeenCalled();
  });

  it("loadFromBackend handles empty chapter list and starts polling fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(chapterListResponse([])),
    );

    const nav = await getNav();
    await nav.loadFromBackend("series-a", "story-a");

    expect(nav.mode.value).toBe("backend");
    expect(nav.currentIndex.value).toBe(0);
    expect(nav.currentContent.value).toBe("");
    expect(setInterval).toHaveBeenCalled();
  });

  it("reloadToLast handles empty backend reload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chapterListResponse([{ number: 1, content: "c1" }]))
      .mockResolvedValueOnce(chapterListResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const nav = await getNav();
    await nav.loadFromBackend("series-a", "story-a");
    await nav.reloadToLast();

    expect(nav.chapters.value).toEqual([]);
    expect(setInterval).toHaveBeenCalled();
  });

  it("reacts to route chapter changes in backend mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        chapterListResponse([
          { number: 1, content: "c1" },
          { number: 2, content: "c2" },
        ]),
      ),
    );
    const nav = await getNav();
    await nav.loadFromBackend("series-a", "story-a");

    routeParams.chapter = "2";
    await flushReactive();

    expect(nav.currentIndex.value).toBe(1);
    expect(nav.currentContent.value).toBe("c2");
  });

  it("reacts to route story changes and reloads backend story", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chapterListResponse([{ number: 1, content: "old" }]))
      .mockResolvedValueOnce(chapterListResponse([{ number: 1, content: "new" }]))
      .mockResolvedValue(chapterListResponse([{ number: 1, content: "new" }]));
    vi.stubGlobal("fetch", fetchMock);

    const nav = await getNav();
    await nav.loadFromBackend("series-a", "story-a");

    Object.assign(routeParams, {
      series: "series-b",
      story: "story-b",
      chapter: "1",
    });
    await flushReactive();

    expect(nav.getBackendContext()).toEqual({
      series: "series-b",
      story: "story-b",
      isBackendMode: true,
    });
    expect(nav.currentContent.value).toBe("new");
  });

  it("handles WebSocket chapters:updated by reloading and navigating to last chapter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chapterListResponse([{ number: 1, content: "c1" }]))
      .mockResolvedValueOnce(
        chapterListResponse([
          { number: 1, content: "c1" },
          { number: 2, content: "c2" },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const nav = await getNav();
    await nav.loadFromBackend("series-a", "story-a");

    await wsHandlers.get("chapters:updated")?.({
      type: "chapters:updated",
      series: "series-a",
      story: "story-a",
      count: 2,
    });

    expect(nav.currentIndex.value).toBe(1);
    expect(nav.currentContent.value).toBe("c2");
  });

  it("handles WebSocket chapters:content by updating the current last chapter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(chapterListResponse([{ number: 1, content: "old" }])),
    );
    const nav = await getNav();
    await nav.loadFromBackend("series-a", "story-a");

    wsHandlers.get("chapters:content")?.({
      type: "chapters:content",
      series: "series-a",
      story: "story-a",
      chapter: 1,
      content: "updated",
      stateDiff: { added: [], removed: [], changed: [] },
    });

    expect(nav.chapters.value[0]?.content).toBe("updated");
    expect(nav.currentContent.value).toBe("updated");
  });

  it("handles auth:ok by sending subscribe when connected", async () => {
    wsConnected.value = true;
    wsAuthenticated.value = true;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(chapterListResponse([{ number: 1, content: "c1" }])),
    );

    const nav = await getNav();
    await nav.loadFromBackend("series-a", "story-a");
    wsSend.mockClear();

    wsHandlers.get("auth:ok")?.({ type: "auth:ok" });

    expect(wsSend).toHaveBeenCalledWith({
      type: "subscribe",
      series: "series-a",
      story: "story-a",
    });
  });

  it("handles polling 429 by applying backoff interval", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chapterListResponse([{ number: 1, content: "c1" }]))
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => [1] });
    vi.stubGlobal("fetch", fetchMock);

    const nav = await getNav();
    await nav.loadFromBackend("series-a", "story-a");

    const firstPollFn = (setInterval as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as () => Promise<void>;
    expect(firstPollFn).toBeTypeOf("function");

    await firstPollFn();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const hadBackoffInterval = (setInterval as unknown as ReturnType<typeof vi.fn>).mock.calls
      .some((call) => call[1] === 6000);
    expect(hadBackoffInterval).toBe(true);
  });

  it("polling updates last chapter content when backend content changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chapterListResponse([{ number: 1, content: "c1" }]))
      .mockResolvedValueOnce(chapterNumbersResponse([1]))
      .mockResolvedValueOnce(chapterContentResponse("c1-updated", 1));
    vi.stubGlobal("fetch", fetchMock);

    const nav = await getNav();
    await nav.loadFromBackend("series-a", "story-a");

    const pollFn = (setInterval as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as () => Promise<void>;
    expect(pollFn).toBeTypeOf("function");
    await pollFn();

    expect(nav.currentContent.value).toBe("c1-updated");
  });
});

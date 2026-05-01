import { flushPromises } from "@vue/test-utils";
import { useChapterNav } from "@/composables/useChapterNav";
import { frontendHooks } from "@/lib/plugin-hooks";

const readFileMock = vi.fn();

vi.mock("@/composables/useFileReader", () => ({
  useFileReader: () => ({
    isSupported: { value: true },
    directoryHandle: { value: null },
    openDirectory: vi.fn(),
    readFile: readFileMock,
  }),
}));

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({}),
    isAuthenticated: { value: true },
  }),
}));

vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: () => ({
    state: { value: "disconnected" },
    isConnected: { value: false },
    onMessage: vi.fn(() => () => {}),
    sendMessage: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock("vue-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("vue-router");
  return {
    ...actual,
    useRoute: () => ({
      name: "home",
      params: {},
      path: "/",
    }),
  };
});

vi.mock("@/router", () => ({
  default: {
    replace: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("useChapterNav boundary jumps", () => {
  beforeEach(() => {
    const nav = useChapterNav();
    nav.chapters.value = [];
    nav.currentIndex.value = 0;
    nav.mode.value = "backend";
    readFileMock.mockReset();
  });

  it("goToFirst is a no-op when chapter list is empty", () => {
    const nav = useChapterNav();
    nav.chapters.value = [];
    const dispatch = vi.spyOn(frontendHooks, "dispatch");
    nav.goToFirst();
    expect(nav.currentIndex.value).toBe(0);
    expect(dispatch).not.toHaveBeenCalledWith("chapter:change", expect.anything());
    dispatch.mockRestore();
  });

  it("goToLast is a no-op when chapter list is empty", () => {
    const nav = useChapterNav();
    nav.chapters.value = [];
    const dispatch = vi.spyOn(frontendHooks, "dispatch");
    nav.goToLast();
    expect(nav.currentIndex.value).toBe(0);
    expect(dispatch).not.toHaveBeenCalledWith("chapter:change", expect.anything());
    dispatch.mockRestore();
  });

  it("goToFirst from index 5 in backend mode lands on index 0 and dispatches chapter:change", () => {
    const nav = useChapterNav();
    nav.mode.value = "backend";
    nav.chapters.value = Array.from({ length: 11 }, (_, i) => ({
      number: i + 1,
      content: `c${i + 1}`,
    }));
    nav.currentIndex.value = 5;

    const dispatch = vi.spyOn(frontendHooks, "dispatch");
    nav.goToFirst();
    expect(nav.currentIndex.value).toBe(0);
    expect(dispatch).toHaveBeenCalledWith(
      "chapter:change",
      expect.objectContaining({ previousIndex: 5, index: 0 }),
    );
    dispatch.mockRestore();
  });

  it("goToLast from index 2 with 11 chapters in backend mode lands on index 10", () => {
    const nav = useChapterNav();
    nav.mode.value = "backend";
    nav.chapters.value = Array.from({ length: 11 }, (_, i) => ({
      number: i + 1,
      content: `c${i + 1}`,
    }));
    nav.currentIndex.value = 2;

    const dispatch = vi.spyOn(frontendHooks, "dispatch");
    nav.goToLast();
    expect(nav.currentIndex.value).toBe(10);
    expect(dispatch).toHaveBeenCalledWith(
      "chapter:change",
      expect.objectContaining({ previousIndex: 2, index: 10 }),
    );
    dispatch.mockRestore();
  });

  it("goToLast in FSA mode invokes loadFSAChapter, which reads the last file via useFileReader.readFile", async () => {
    const nav = useChapterNav();

    const fileHandles = Array.from({ length: 5 }, (_, i) => ({
      kind: "file",
      name: `${i + 1}.md`,
    })) as unknown as FileSystemFileHandle[];

    const dirHandle = {
      name: "fake-dir",
      [Symbol.asyncIterator]: async function* () {
        for (const fh of fileHandles) {
          yield [fh.name, fh] as [string, FileSystemFileHandle];
        }
      },
    } as unknown as FileSystemDirectoryHandle;

    readFileMock.mockImplementation(
      (h: FileSystemFileHandle) => Promise.resolve(`content for ${h.name}`),
    );

    await nav.loadFromFSA(dirHandle);
    await flushPromises();

    expect(nav.mode.value).toBe("fsa");
    expect(nav.chapters.value.length).toBe(5);

    nav.currentIndex.value = 1;
    readFileMock.mockClear();

    nav.goToLast();
    await flushPromises();

    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(readFileMock).toHaveBeenLastCalledWith(fileHandles[4]);
    expect(nav.currentIndex.value).toBe(4);
  });

  it("goToFirst in FSA mode invokes loadFSAChapter for index 0 (does not fall through to navigateTo)", async () => {
    const nav = useChapterNav();

    const fileHandles = Array.from({ length: 5 }, (_, i) => ({
      kind: "file",
      name: `${i + 1}.md`,
    })) as unknown as FileSystemFileHandle[];

    const dirHandle = {
      name: "fake-dir",
      [Symbol.asyncIterator]: async function* () {
        for (const fh of fileHandles) {
          yield [fh.name, fh] as [string, FileSystemFileHandle];
        }
      },
    } as unknown as FileSystemDirectoryHandle;

    readFileMock.mockImplementation(
      (h: FileSystemFileHandle) => Promise.resolve(`content for ${h.name}`),
    );

    await nav.loadFromFSA(dirHandle);
    await flushPromises();

    nav.currentIndex.value = 3;
    readFileMock.mockClear();

    nav.goToFirst();
    await flushPromises();

    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(readFileMock).toHaveBeenLastCalledWith(fileHandles[0]);
    expect(nav.currentIndex.value).toBe(0);
  });
});

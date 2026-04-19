import { stubSessionStorage } from "@/__tests__/setup";

describe("useFileReader", () => {
  type IndexedDbOptions = {
    seedHandle?: FileSystemDirectoryHandle;
    openError?: boolean;
    putError?: boolean;
    getError?: boolean;
    deleteError?: boolean;
  };

  function createIndexedDbMock(options: IndexedDbOptions = {}) {
    const store = new Map<string, unknown>();
    if (options.seedHandle) {
      store.set("directoryHandle", options.seedHandle);
    }

    let objectStoreCreated = false;
    const createObjectStore = vi.fn(() => {
      objectStoreCreated = true;
    });

    const open = vi.fn(() => {
      const request: {
        result?: IDBDatabase;
        error?: Error;
        onupgradeneeded?: () => void;
        onsuccess?: () => void;
        onerror?: () => void;
      } = {};

      queueMicrotask(() => {
        if (options.openError) {
          request.error = new Error("open failed");
          request.onerror?.();
          return;
        }

        const db = {
          objectStoreNames: {
            contains: () => objectStoreCreated,
          },
          createObjectStore,
          transaction: (_name: string, _mode: IDBTransactionMode) => {
            const tx: {
              objectStore: (_store: string) => {
                put: (value: unknown, key: string) => void;
                delete: (key: string) => void;
                get: (key: string) => {
                  result?: unknown;
                  error?: Error;
                  onsuccess?: () => void;
                  onerror?: () => void;
                };
              };
              oncomplete?: () => void;
              onerror?: () => void;
              error?: Error;
            } = {
              objectStore: () => ({
                put: (value: unknown, key: string) => {
                  queueMicrotask(() => {
                    if (options.putError) {
                      tx.error = new Error("put failed");
                      tx.onerror?.();
                      return;
                    }
                    store.set(key, value);
                    tx.oncomplete?.();
                  });
                },
                delete: (key: string) => {
                  queueMicrotask(() => {
                    if (options.deleteError) {
                      tx.error = new Error("delete failed");
                      tx.onerror?.();
                      return;
                    }
                    store.delete(key);
                    tx.oncomplete?.();
                  });
                },
                get: (key: string) => {
                  const req: {
                    result?: unknown;
                    error?: Error;
                    onsuccess?: () => void;
                    onerror?: () => void;
                  } = {};
                  queueMicrotask(() => {
                    if (options.getError) {
                      req.error = new Error("get failed");
                      req.onerror?.();
                      return;
                    }
                    req.result = store.get(key);
                    req.onsuccess?.();
                  });
                  return req;
                },
              }),
            };
            return tx;
          },
        } as unknown as IDBDatabase;

        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });

      return request;
    });

    vi.stubGlobal("indexedDB", { open } as unknown as IDBFactory);
    return { open, createObjectStore };
  }

  function createDirectoryHandle(
    entries: Array<{ name: string; kind: "file" | "directory"; content?: string }>,
    permission: PermissionState = "granted",
  ): FileSystemDirectoryHandle {
    return {
      name: "chapters",
      requestPermission: vi.fn().mockResolvedValue(permission),
      async *[Symbol.asyncIterator]() {
        for (const entry of entries) {
          if (entry.kind === "file") {
            yield [
              entry.name,
              {
                kind: "file",
                getFile: vi.fn(async () => ({
                  text: async () => entry.content ?? "",
                })),
              } as unknown as FileSystemFileHandle,
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

  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getFileReader() {
    const mod = await import("@/composables/useFileReader");
    return mod.useFileReader();
  }

  it("isSupported reflects showDirectoryPicker availability", async () => {
    vi.stubGlobal("showDirectoryPicker", vi.fn());
    const fr = await getFileReader();
    expect(fr.isSupported.value).toBe(true);
  });

  it("directoryHandle starts as null", async () => {
    const fr = await getFileReader();
    expect(fr.directoryHandle.value).toBeNull();
  });

  it("files starts as empty array", async () => {
    const fr = await getFileReader();
    expect(fr.files.value).toEqual([]);
  });

  it("hasStoredHandle starts as false", async () => {
    const fr = await getFileReader();
    expect(fr.hasStoredHandle.value).toBe(false);
  });

  it("readFile reads text from a FileSystemFileHandle", async () => {
    const fr = await getFileReader();
    const mockHandle = {
      getFile: vi.fn(() =>
        Promise.resolve({
          text: () => Promise.resolve("file content"),
        }),
      ),
    } as unknown as FileSystemFileHandle;
    const content = await fr.readFile(mockHandle);
    expect(content).toBe("file content");
  });

  it("openDirectory loads and sorts numeric markdown files, then stores handle", async () => {
    createIndexedDbMock();
    const dirHandle = createDirectoryHandle([
      { name: "2.md", kind: "file", content: "chapter 2" },
      { name: "notes.txt", kind: "file", content: "ignore" },
      { name: "1.md", kind: "file", content: "chapter 1" },
      { name: "3", kind: "directory" },
    ]);
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(dirHandle));

    const fr = await getFileReader();
    await fr.openDirectory();

    expect(fr.directoryHandle.value).toBe(dirHandle);
    expect(fr.hasStoredHandle.value).toBe(true);
    expect(fr.files.value).toHaveLength(2);
    const first = await fr.readFile(fr.files.value[0]!);
    const second = await fr.readFile(fr.files.value[1]!);
    expect([first, second]).toEqual(["chapter 1", "chapter 2"]);
  });

  it("openDirectory ignores AbortError from picker", async () => {
    createIndexedDbMock();
    const abortError = new DOMException("aborted", "AbortError");
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockRejectedValue(abortError));

    const fr = await getFileReader();
    await expect(fr.openDirectory()).resolves.toBeUndefined();
  });

  it("openDirectory rethrows non-abort picker errors", async () => {
    createIndexedDbMock();
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockRejectedValue(new Error("picker failed")));

    const fr = await getFileReader();
    await expect(fr.openDirectory()).rejects.toThrow("picker failed");
  });

  it("openDirectory continues even when IndexedDB save fails", async () => {
    createIndexedDbMock({ openError: true });
    const dirHandle = createDirectoryHandle([{ name: "1.md", kind: "file", content: "ok" }]);
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(dirHandle));

    const fr = await getFileReader();
    await fr.openDirectory();

    expect(fr.hasStoredHandle.value).toBe(true);
    expect(fr.files.value).toHaveLength(1);
  });

  it("restoreHandle returns false when no stored handle exists", async () => {
    createIndexedDbMock();

    const fr = await getFileReader();
    await expect(fr.restoreHandle()).resolves.toBe(false);
    expect(fr.hasStoredHandle.value).toBe(false);
  });

  it("restoreHandle returns false when permission is denied", async () => {
    createIndexedDbMock({
      seedHandle: createDirectoryHandle([{ name: "1.md", kind: "file", content: "x" }], "denied"),
    });

    const fr = await getFileReader();
    await expect(fr.restoreHandle()).resolves.toBe(false);
    expect(fr.hasStoredHandle.value).toBe(false);
  });

  it("restoreHandle restores files when handle and permission are valid", async () => {
    const handle = createDirectoryHandle([
      { name: "10.md", kind: "file", content: "chapter 10" },
      { name: "2.md", kind: "file", content: "chapter 2" },
      { name: "abc.md", kind: "file", content: "ignore me" },
    ]);
    createIndexedDbMock({ seedHandle: handle });

    const fr = await getFileReader();
    await expect(fr.restoreHandle()).resolves.toBe(true);
    expect(fr.directoryHandle.value).toBe(handle);
    expect(fr.hasStoredHandle.value).toBe(true);
    expect(fr.files.value).toHaveLength(2);
    const first = await fr.readFile(fr.files.value[0]!);
    const second = await fr.readFile(fr.files.value[1]!);
    expect([first, second]).toEqual(["chapter 2", "chapter 10"]);
  });

  it("restoreHandle returns false when IndexedDB read fails", async () => {
    createIndexedDbMock({ getError: true });

    const fr = await getFileReader();
    await expect(fr.restoreHandle()).resolves.toBe(false);
    expect(fr.hasStoredHandle.value).toBe(false);
  });

  it("clearStoredHandle removes persisted handle", async () => {
    const handle = createDirectoryHandle([{ name: "1.md", kind: "file", content: "x" }]);
    createIndexedDbMock({ seedHandle: handle });

    const fr = await getFileReader();
    await expect(fr.restoreHandle()).resolves.toBe(true);
    await fr.clearStoredHandle();
    await expect(fr.restoreHandle()).resolves.toBe(false);
  });

  it("clearStoredHandle silently ignores IndexedDB delete errors", async () => {
    createIndexedDbMock({ deleteError: true });

    const fr = await getFileReader();
    await expect(fr.clearStoredHandle()).resolves.toBeUndefined();
  });
});

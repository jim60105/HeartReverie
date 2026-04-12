import { stubSessionStorage } from "@/__tests__/setup";

describe("useFileReader", () => {
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

  it("exposes openDirectory function", async () => {
    const fr = await getFileReader();
    expect(typeof fr.openDirectory).toBe("function");
  });

  it("exposes restoreHandle function", async () => {
    const fr = await getFileReader();
    expect(typeof fr.restoreHandle).toBe("function");
  });

  it("exposes clearStoredHandle function", async () => {
    const fr = await getFileReader();
    expect(typeof fr.clearStoredHandle).toBe("function");
  });
});

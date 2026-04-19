import { stubSessionStorage } from "@/__tests__/setup";

describe("useStoryExport", () => {
  let createdAnchors: Array<{ href: string; download: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }>;
  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    sessionStorage.setItem("passphrase", "secret-pass");

    createdAnchors = [];
    originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") {
        const anchor = {
          href: "",
          download: "",
          click: vi.fn(),
          remove: vi.fn(),
        };
        createdAnchors.push(anchor);
        return anchor as unknown as HTMLAnchorElement;
      }
      return originalCreateElement(tag);
    });

    vi.spyOn(document.body, "appendChild").mockImplementation(
      (node: Node) => node,
    );

    if (typeof URL.createObjectURL !== "function") {
      (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => "";
    }
    if (typeof URL.revokeObjectURL !== "function") {
      (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};
    }
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function getExporter() {
    const mod = await import("@/composables/useStoryExport");
    return mod;
  }

  function mockOkBlob() {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          blob: () => Promise.resolve(new Blob(["payload"], { type: "text/markdown" })),
          headers: new Headers(),
        }),
      ),
    );
  }

  it("calls the correct URL with auth header and downloads via anchor", async () => {
    mockOkBlob();
    const { exportStory } = await getExporter();
    await exportStory("系列", "故事", "md");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/api/stories/");
    expect(url).toContain(encodeURIComponent("系列"));
    expect(url).toContain(encodeURIComponent("故事"));
    expect(url).toContain("format=md");
    expect((init as RequestInit).headers).toMatchObject({ "X-Passphrase": "secret-pass" });

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    expect(createdAnchors.length).toBe(1);
    const anchor = createdAnchors[0]!;
    expect(anchor.href).toBe("blob:mock-url");
    expect(anchor.download).toBe("系列-故事.md");
    expect(anchor.click).toHaveBeenCalled();
    expect(anchor.remove).toHaveBeenCalled();
  });

  it("appends the json extension when format=json", async () => {
    mockOkBlob();
    const { exportStory } = await getExporter();
    await exportStory("S", "T", "json");
    expect(createdAnchors[0]!.download).toBe("S-T.json");
  });

  it("appends the txt extension when format=txt", async () => {
    mockOkBlob();
    const { exportStory } = await getExporter();
    await exportStory("S", "T", "txt");
    expect(createdAnchors[0]!.download).toBe("S-T.txt");
  });

  it("throws when series or name is empty", async () => {
    mockOkBlob();
    const { exportStory } = await getExporter();
    await expect(exportStory("", "story", "md")).rejects.toThrow(/Missing/);
    await expect(exportStory("series", "", "md")).rejects.toThrow(/Missing/);
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          blob: () => Promise.resolve(new Blob()),
          headers: new Headers(),
        }),
      ),
    );
    const { exportStory } = await getExporter();
    await expect(exportStory("S", "T", "md")).rejects.toThrow(/404/);
  });
});

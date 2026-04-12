import { stubSessionStorage } from "@/__tests__/setup";

/**
 * Routing fetch mock that handles template and parameter endpoints.
 */
function installFetchMock(
  content = "server template content",
  source: "custom" | "default" = "default",
) {
  const mock = vi.fn(
    (url: string, init?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/api/plugins/parameters")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });
      }

      const method = init?.method ?? "GET";

      if (method === "PUT" || method === "DELETE") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          headers: new Headers(),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content, source }),
        headers: new Headers(),
      });
    },
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("usePromptEditor", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getEditor() {
    const mod = await import("@/composables/usePromptEditor");
    return mod.usePromptEditor();
  }

  it("templateContent starts as empty string", async () => {
    const editor = await getEditor();
    expect(editor.templateContent.value).toBe("");
  });

  it("loadTemplate fetches from backend", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    expect(fetch).toHaveBeenCalled();
  });

  it("parameters starts as empty array", async () => {
    const editor = await getEditor();
    expect(Array.isArray(editor.parameters.value)).toBe(true);
  });

  it("isDirty is false after loadTemplate", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    expect(editor.isDirty.value).toBe(false);
  });

  it("isDirty is true after modifying templateContent", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "modified content";
    expect(editor.isDirty.value).toBe(true);
  });

  it("save() calls PUT /api/template and resets dirty state", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "modified content";
    expect(editor.isDirty.value).toBe(true);

    await editor.save();

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    const putCall = calls.find(
      (c: unknown[]) =>
        (c[1] as { method?: string } | undefined)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    expect(editor.isDirty.value).toBe(false);
  });

  it("resetTemplate() calls DELETE then re-fetches via GET", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "modified";

    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const callsBefore = fetchMock.mock.calls.length;

    await editor.resetTemplate();

    const newCalls = fetchMock.mock.calls.slice(callsBefore);
    const deleteCall = newCalls.find(
      (c: unknown[]) =>
        (c[1] as { method?: string } | undefined)?.method === "DELETE",
    );
    expect(deleteCall).toBeDefined();

    const getCalls = newCalls.filter((c: unknown[]) => {
      const method = (c[1] as { method?: string } | undefined)?.method;
      return (
        typeof c[0] === "string" &&
        (c[0] as string).includes("/api/template") &&
        (!method || method === "GET")
      );
    });
    expect(getCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("isCustom is true when source is 'custom'", async () => {
    installFetchMock("custom content", "custom");
    const editor = await getEditor();
    await editor.loadTemplate();
    expect(editor.isCustom.value).toBe(true);
  });

  it("isCustom is false when source is 'default'", async () => {
    installFetchMock("default content", "default");
    const editor = await getEditor();
    await editor.loadTemplate();
    expect(editor.isCustom.value).toBe(false);
  });

  it("does not reference localStorage", async () => {
    const ls = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    };
    vi.stubGlobal("localStorage", ls);

    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "changed";
    await editor.save();
    await editor.resetTemplate();

    expect(ls.getItem).not.toHaveBeenCalled();
    expect(ls.setItem).not.toHaveBeenCalled();
    expect(ls.removeItem).not.toHaveBeenCalled();
  });
});

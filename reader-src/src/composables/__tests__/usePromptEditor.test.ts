import { stubLocalStorage, stubSessionStorage } from "@/__tests__/setup";

describe("usePromptEditor", () => {
  beforeEach(() => {
    vi.resetModules();
    stubLocalStorage();
    stubSessionStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ content: "server template content" }),
          text: () => Promise.resolve("server template content"),
          headers: new Headers(),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getEditor() {
    const mod = await import("@/composables/usePromptEditor");
    return mod.usePromptEditor();
  }

  it("templateContent starts as empty string when no localStorage", async () => {
    const editor = await getEditor();
    expect(editor.templateContent.value).toBe("");
  });

  it("loadTemplate fetches from backend", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    expect(fetch).toHaveBeenCalled();
  });

  it("loadTemplate populates templateContent and originalTemplate", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    expect(editor.originalTemplate.value).toBe("server template content");
    expect(editor.templateContent.value).toBe("server template content");
  });

  it("resetTemplate reverts to originalTemplate", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "modified";
    editor.resetTemplate();
    expect(editor.templateContent.value).toBe("server template content");
  });

  it("savedTemplate returns undefined when unchanged", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = editor.originalTemplate.value;
    expect(editor.savedTemplate.value).toBeUndefined();
  });

  it("savedTemplate returns value when changed", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "customized template";
    expect(editor.savedTemplate.value).toBe("customized template");
  });

  it("saveTemplate persists to localStorage when different from original", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "different content";
    editor.saveTemplate();
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "story-editor-template",
      "different content",
    );
  });

  it("saveTemplate removes localStorage when same as original", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = editor.originalTemplate.value;
    editor.saveTemplate();
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      "story-editor-template",
    );
  });

  it("parameters starts as empty array", async () => {
    const editor = await getEditor();
    expect(Array.isArray(editor.parameters.value)).toBe(true);
  });

  it("localStorage restores templateContent on module load", async () => {
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
      "saved from localStorage",
    );
    const editor = await getEditor();
    expect(editor.templateContent.value).toBe("saved from localStorage");
  });
});

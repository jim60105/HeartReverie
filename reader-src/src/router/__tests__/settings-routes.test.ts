import { settingsChildren } from "@/router";

vi.mock("vue-router", () => ({
  createRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
  })),
  createWebHistory: vi.fn(),
}));

describe("settings route configuration", () => {
  it("settingsChildren contains the prompt-editor child route", () => {
    const promptEditor = settingsChildren.find(
      (r) => r.name === "settings-prompt-editor",
    );
    expect(promptEditor).toBeDefined();
    expect(promptEditor!.path).toBe("prompt-editor");
  });

  it("prompt-editor route has correct meta title", () => {
    const promptEditor = settingsChildren.find(
      (r) => r.name === "settings-prompt-editor",
    );
    expect(promptEditor!.meta?.title).toBe("編排器");
  });

  it("prompt-editor route has a component defined", () => {
    const promptEditor = settingsChildren.find(
      (r) => r.name === "settings-prompt-editor",
    );
    expect(promptEditor!.component).toBeDefined();
  });

  it("/settings redirects to settings-prompt-editor", async () => {
    const { createRouter } = await import("vue-router");
    const { default: _router } = await import("@/router");

    // createRouter was called with a config containing the /settings redirect
    expect(createRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        routes: expect.arrayContaining([
          expect.objectContaining({
            path: "/settings",
            redirect: { name: "settings-prompt-editor" },
            children: expect.arrayContaining([
              expect.objectContaining({
                path: "prompt-editor",
                name: "settings-prompt-editor",
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it("settingsChildren entries all have name and meta.title", () => {
    for (const child of settingsChildren) {
      expect(child.name).toBeDefined();
      expect(child.meta?.title).toBeDefined();
    }
  });
});

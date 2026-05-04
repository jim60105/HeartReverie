// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program. If not, see <https://www.gnu.org/licenses/>.

import { ref } from "vue";
import type { PluginDescriptor } from "@/types";

const pluginsRef = ref<PluginDescriptor[]>([]);
const isLastChapterRef = ref(true);
const chaptersRef = ref<{ number: number }[]>([{ number: 1 }]);
const currentIndexRef = ref(0);
const reloadToLastMock = vi.fn().mockResolvedValue(undefined);
const runPluginPromptMock = vi.fn().mockResolvedValue({
  content: "",
  usage: null,
  chapterUpdated: false,
  chapterReplaced: false,
  appendedTag: null,
});

vi.mock("@/composables/usePlugins", () => ({
  usePlugins: () => ({
    plugins: pluginsRef,
    pluginsReady: ref(true),
    pluginsSettled: ref(true),
    initPlugins: () => Promise.resolve(),
    applyDisplayStrip: (s: string) => s,
  }),
}));

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    isLastChapter: isLastChapterRef,
    chapters: chaptersRef,
    currentIndex: currentIndexRef,
    getBackendContext: () => ({
      series: "series-a",
      story: "story-a",
      isBackendMode: true,
    }),
    reloadToLast: reloadToLastMock,
  }),
}));

vi.mock("@/composables/useChatApi", () => ({
  useChatApi: () => ({
    isLoading: ref(false),
    errorMessage: ref(""),
    streamingContent: ref(""),
    sendMessage: vi.fn(),
    resendMessage: vi.fn(),
    runPluginPrompt: runPluginPromptMock,
    abortCurrentRequest: vi.fn(),
  }),
}));

import { __resetNotificationStateForTests } from "@/composables/useNotification";

describe("usePluginActions", () => {
  beforeEach(async () => {
    vi.resetModules();
    pluginsRef.value = [];
    isLastChapterRef.value = true;
    chaptersRef.value = [{ number: 1 }];
    currentIndexRef.value = 0;
    runPluginPromptMock.mockClear();
    reloadToLastMock.mockClear();
    __resetNotificationStateForTests();
  });

  async function getApi() {
    const mod = await import("@/composables/usePluginActions");
    return mod.usePluginActions();
  }

  it("returns no buttons when no plugins declared any", async () => {
    pluginsRef.value = [
      { name: "p1", hasFrontendModule: true } as PluginDescriptor,
    ];
    const api = await getApi();
    expect(api.actionButtons.value).toEqual([]);
  });

  it("sorts by priority then plugin-name then declaration order", async () => {
    pluginsRef.value = [
      {
        name: "z-plugin",
        hasFrontendModule: true,
        actionButtons: [
          { id: "z1", label: "Z1", priority: 100 },
          { id: "z2", label: "Z2", priority: 100 },
        ],
      },
      {
        name: "a-plugin",
        hasFrontendModule: true,
        actionButtons: [
          { id: "a1", label: "A1", priority: 50 },
          { id: "a2", label: "A2" },
        ],
      },
    ] as PluginDescriptor[];

    const api = await getApi();
    const ids = api.actionButtons.value.map((b) => `${b.pluginName}:${b.id}`);
    // priority 50 first; then priority-100 sorted by plugin name then decl order
    expect(ids).toEqual([
      "a-plugin:a1",
      "a-plugin:a2",
      "z-plugin:z1",
      "z-plugin:z2",
    ]);
  });

  it("visibility: non-last chapter shows backend-only only", async () => {
    pluginsRef.value = [
      {
        name: "p",
        hasFrontendModule: true,
        actionButtons: [
          { id: "lc", label: "LC", visibleWhen: "last-chapter-backend" },
          { id: "bo", label: "BO", visibleWhen: "backend-only" },
        ],
      },
    ] as PluginDescriptor[];
    isLastChapterRef.value = false;
    chaptersRef.value = [{ number: 1 }, { number: 2 }];
    currentIndexRef.value = 0;
    const api = await getApi();
    const ids = api.actionButtons.value.map((b) => b.id);
    expect(ids).toEqual(["bo"]);
  });

  it("visibility: last chapter shows both", async () => {
    pluginsRef.value = [
      {
        name: "p",
        hasFrontendModule: true,
        actionButtons: [
          { id: "lc", label: "LC", visibleWhen: "last-chapter-backend" },
          { id: "bo", label: "BO", visibleWhen: "backend-only" },
        ],
      },
    ] as PluginDescriptor[];
    isLastChapterRef.value = true;
    const api = await getApi();
    const ids = api.actionButtons.value.map((b) => b.id);
    expect(ids.sort()).toEqual(["bo", "lc"]);
  });

  it("qualified pendingKey across plugins: two 'refresh' ids do not collide", async () => {
    pluginsRef.value = [
      {
        name: "alpha",
        hasFrontendModule: true,
        actionButtons: [{ id: "refresh", label: "Refresh A" }],
      },
      {
        name: "beta",
        hasFrontendModule: true,
        actionButtons: [{ id: "refresh", label: "Refresh B" }],
      },
    ] as PluginDescriptor[];

    // Register a hook for alpha that we can pause to capture pendingKey
    const { frontendHooks } = await import("@/lib/plugin-hooks");
    let resume: (() => void) | undefined;
    frontendHooks.register(
      "action-button:click",
      () => new Promise<void>((r) => {
        resume = r;
      }),
      100,
      "alpha",
    );
    const api = await getApi();
    const promise = api.clickButton("refresh", "alpha");
    expect(api.pendingKey.value).toBe("alpha:refresh");
    // beta:refresh is NOT pending
    expect(api.pendingKey.value).not.toBe("beta:refresh");
    resume!();
    await promise;
    expect(api.pendingKey.value).toBeNull();
  });

  it("clickButton dispatches with curried context including helpers", async () => {
    pluginsRef.value = [
      {
        name: "state",
        hasFrontendModule: true,
        actionButtons: [{ id: "recompute-state", label: "🧮" }],
      },
    ] as PluginDescriptor[];

    const { frontendHooks } = await import("@/lib/plugin-hooks");
    type Snapshot = { pluginName: string; series: string; name: string };
    let captured: Snapshot | null = null;
    frontendHooks.register(
      "action-button:click",
      async (ctx) => {
        captured = {
          pluginName: ctx.pluginName,
          series: ctx.series,
          name: ctx.name,
        };
        await ctx.runPluginPrompt("state-recompute.md", { append: true, appendTag: "UpdateVariable" });
        await ctx.reload();
      },
      100,
      "state",
    );

    const api = await getApi();
    await api.clickButton("recompute-state", "state");
    expect(captured).not.toBeNull();
    const snap = captured as Snapshot | null;
    expect(snap?.pluginName).toBe("state");
    expect(snap?.series).toBe("series-a");
    expect(snap?.name).toBe("story-a");
    expect(runPluginPromptMock).toHaveBeenCalledWith(
      "state",
      "state-recompute.md",
      expect.objectContaining({
        append: true,
        appendTag: "UpdateVariable",
        series: "series-a",
        name: "story-a",
      }),
    );
    expect(reloadToLastMock).toHaveBeenCalledTimes(1);
  });

  it("emits default error toast when handler rejects", async () => {
    pluginsRef.value = [
      {
        name: "p",
        hasFrontendModule: true,
        actionButtons: [{ id: "x", label: "X" }],
      },
    ] as PluginDescriptor[];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { frontendHooks } = await import("@/lib/plugin-hooks");
    frontendHooks.register(
      "action-button:click",
      () => {
        throw new Error("kaboom");
      },
      100,
      "p",
    );
    const api = await getApi();
    await api.clickButton("x", "p");
    const notifMod = await import("@/composables/useNotification");
    const { toasts } = notifMod.useNotification();
    expect(toasts.value.some((t) => t.level === "error")).toBe(true);
    expect(toasts.value.some((t) => (t.body ?? "").includes("kaboom"))).toBe(true);
    expect(api.pendingKey.value).toBeNull();
    errSpy.mockRestore();
  });

  it("polish button is disabled (no-op + warning toast) when editor has unsaved buffer for last chapter", async () => {
    pluginsRef.value = [
      {
        name: "polish",
        hasFrontendModule: true,
        actionButtons: [{ id: "polish", label: "✨ 潤飾" }],
      },
    ] as PluginDescriptor[];

    const api = await getApi();

    // Dynamically import to get the same instance usePluginActions uses
    const { useChapterEditor } = await import("@/composables/useChapterEditor");
    const editor = useChapterEditor();
    editor.beginEdit(0, "some content");

    const { frontendHooks } = await import("@/lib/plugin-hooks");
    const hookSpy = vi.fn();
    frontendHooks.register("action-button:click", hookSpy, 100, "polish");

    await api.clickButton("polish", "polish");

    // Hook handler should NOT have been called
    expect(hookSpy).not.toHaveBeenCalled();
    // runPluginPrompt should NOT have been called
    expect(runPluginPromptMock).not.toHaveBeenCalled();
    // Warning toast should have been shown
    const notifMod = await import("@/composables/useNotification");
    const { toasts } = notifMod.useNotification();
    expect(toasts.value.some((t) => t.level === "warning")).toBe(true);
    expect(
      toasts.value.some((t) => (t.body ?? "").includes("請先儲存或捨棄章節編輯內容後再潤飾")),
    ).toBe(true);
  });

  it("polish button works normally when editor has no unsaved buffer", async () => {
    pluginsRef.value = [
      {
        name: "polish",
        hasFrontendModule: true,
        actionButtons: [{ id: "polish", label: "✨ 潤飾" }],
      },
    ] as PluginDescriptor[];

    runPluginPromptMock.mockResolvedValue({
      content: "polished",
      usage: null,
      chapterUpdated: true,
      chapterReplaced: false,
      appendedTag: null,
    });

    const { frontendHooks } = await import("@/lib/plugin-hooks");
    const hookSpy = vi.fn(async (ctx) => {
      await ctx.runPluginPrompt("polish-instruction.md", { replace: true });
    });
    frontendHooks.register("action-button:click", hookSpy, 100, "polish");

    const api = await getApi();
    await api.clickButton("polish", "polish");

    expect(hookSpy).toHaveBeenCalled();
    expect(runPluginPromptMock).toHaveBeenCalled();
  });

  it("force-closes editor on chapterReplaced: true", async () => {
    pluginsRef.value = [
      {
        name: "polish",
        hasFrontendModule: true,
        actionButtons: [{ id: "polish", label: "✨ 潤飾" }],
      },
    ] as PluginDescriptor[];

    runPluginPromptMock.mockResolvedValue({
      content: "polished",
      usage: null,
      chapterUpdated: true,
      chapterReplaced: true,
      appendedTag: null,
    });

    const api = await getApi();

    const { frontendHooks } = await import("@/lib/plugin-hooks");
    const { useChapterEditor } = await import("@/composables/useChapterEditor");
    const editor = useChapterEditor();

    // Register a hook that opens the editor mid-flight, then calls runPluginPrompt
    frontendHooks.register(
      "action-button:click",
      async (ctx) => {
        // Simulate user opening editor during WS stream
        editor.beginEdit(0, "typing...");
        await ctx.runPluginPrompt("polish-instruction.md", { replace: true });
      },
      100,
      "polish",
    );

    await api.clickButton("polish", "polish");

    // After chapterReplaced: true, editor should be force-closed
    expect(editor.isEditing.value).toBe(false);
    expect(editor.editBuffer.value).toBe("");
    expect(editor.editingChapterIndex.value).toBeNull();
  });
});

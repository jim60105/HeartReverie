// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { flushPromises, mount } from "@vue/test-utils";
import { ref, nextTick } from "vue";
import ChapterContent from "@/components/ChapterContent.vue";

const mockState = vi.hoisted(() => {
  // Use Vue refs for properties that need to drive reactivity in the
  // component under test (renderEpoch, pluginsReady, etc.).
  return {
    chaptersRef: { value: [{ number: 2, stateDiff: { hp: "+1" } }] },
    currentIndexRef: { value: 0 },
    renderEpochRef: null as unknown as { value: number },
    remountTokenRef: null as unknown as { value: number },
    pluginsReadyRef: { value: true },
    pluginsSettledRef: { value: true },
    backendContextRef: { value: {
      series: "series-a" as string | null,
      story: "story-a" as string | null,
      isBackendMode: true,
    } },
    reloadToLastMock: vi.fn().mockResolvedValue(undefined),
    refreshAfterEditMock: vi.fn().mockResolvedValue(undefined),
    forceTokenRemountMock: vi.fn(),
    notifyRenderInvalidatedMock: vi.fn(),
    loadFromBackendMock: vi.fn().mockResolvedValue(undefined),
    editChapterMock: vi.fn().mockResolvedValue(undefined),
    rewindAfterMock: vi.fn().mockResolvedValue(undefined),
    branchFromMock: vi.fn().mockResolvedValue({ series: "next-s", name: "next-n" }),
    routerPushMock: vi.fn(() => Promise.resolve()),
    renderChapterMock: vi.fn(() => [
      { type: "html", content: "<p>rendered</p>" },
      { type: "vento-error", data: { title: "錯誤", detail: "bad" } },
    ]),
  };
});

// Initialise renderEpochRef and remountTokenRef as real Vue refs so
// reactivity-dependent assertions work.
mockState.renderEpochRef = ref(0);
mockState.remountTokenRef = ref(0);

// The spies installed below bump the underlying refs the same way the real
// composable does, so component reactivity reacts to the call.
mockState.forceTokenRemountMock.mockImplementation(() => {
  mockState.remountTokenRef.value++;
  mockState.renderEpochRef.value++;
});
mockState.notifyRenderInvalidatedMock.mockImplementation(() => {
  mockState.renderEpochRef.value++;
});

vi.mock("@/composables/useMarkdownRenderer", () => ({
  useMarkdownRenderer: () => ({ renderChapter: mockState.renderChapterMock }),
}));

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    chapters: mockState.chaptersRef,
    currentIndex: mockState.currentIndexRef,
    renderEpoch: mockState.renderEpochRef,
    remountToken: mockState.remountTokenRef,
    getBackendContext: () => mockState.backendContextRef.value,
    reloadToLast: mockState.reloadToLastMock,
    refreshAfterEdit: mockState.refreshAfterEditMock,
    forceTokenRemount: mockState.forceTokenRemountMock,
    notifyRenderInvalidated: mockState.notifyRenderInvalidatedMock,
    loadFromBackend: mockState.loadFromBackendMock,
  }),
}));

vi.mock("@/composables/usePlugins", () => ({
  usePlugins: () => ({
    pluginsReady: mockState.pluginsReadyRef,
    pluginsSettled: mockState.pluginsSettledRef,
  }),
}));

vi.mock("@/composables/useChapterActions", () => ({
  useChapterActions: () => ({
    editChapter: mockState.editChapterMock,
    rewindAfter: mockState.rewindAfterMock,
    branchFrom: mockState.branchFromMock,
  }),
}));

vi.mock("@/router", () => ({
  default: { push: mockState.routerPushMock },
}));

describe("ChapterContent", () => {
  beforeEach(() => {
    mockState.currentIndexRef.value = 0;
    mockState.renderEpochRef.value = 0;
    mockState.remountTokenRef.value = 0;
    mockState.pluginsReadyRef.value = true;
    mockState.pluginsSettledRef.value = true;
    mockState.backendContextRef.value = { series: "series-a", story: "story-a", isBackendMode: true };
    mockState.chaptersRef.value = [{ number: 2, stateDiff: { hp: "+1" } }];
    mockState.renderChapterMock.mockClear();
    mockState.editChapterMock.mockClear();
    mockState.rewindAfterMock.mockClear();
    mockState.branchFromMock.mockClear();
    mockState.reloadToLastMock.mockClear();
    mockState.refreshAfterEditMock.mockClear();
    mockState.forceTokenRemountMock.mockClear();
    mockState.notifyRenderInvalidatedMock.mockClear();
    mockState.loadFromBackendMock.mockClear();
    mockState.routerPushMock.mockClear();
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("prompt", vi.fn(() => "new-branch"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mountComponent() {
    return mount(ChapterContent, {
      props: { rawMarkdown: "raw content", isLastChapter: true },
      global: {
        stubs: {
          VentoErrorCard: {
            template: "<div class='vento-error-stub'></div>",
          },
        },
      },
    });
  }

  it("renders markdown tokens and toolbar", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".chapter-toolbar").exists()).toBe(true);
    expect(wrapper.html()).toContain("<p>rendered</p>");
    expect(wrapper.find(".vento-error-stub").exists()).toBe(true);
    expect(mockState.renderChapterMock).toHaveBeenCalledWith("raw content", {
      isLastChapter: true,
      stateDiff: { hp: "+1" },
      series: "series-a",
      story: "story-a",
      chapterNumber: 2,
    });
  });

  it("saves edited content and refreshes the edited chapter (not last)", async () => {
    const wrapper = mountComponent();
    await wrapper.findAll("button")[0]!.trigger("click");
    const editor = wrapper.find("textarea.chapter-editor");
    await editor.setValue("updated chapter");

    await wrapper.findAll("button")[0]!.trigger("click");
    await flushPromises();

    expect(mockState.editChapterMock).toHaveBeenCalledWith("series-a", "story-a", 2, "updated chapter");
    expect(mockState.refreshAfterEditMock).toHaveBeenCalledWith(1);
    expect(mockState.reloadToLastMock).not.toHaveBeenCalled();
    expect(wrapper.find("textarea.chapter-editor").exists()).toBe(false);
  });

  it("asks confirmation before rewind and aborts on cancel", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const wrapper = mountComponent();

    await wrapper.findAll("button")[1]!.trigger("click");
    await flushPromises();

    expect(mockState.rewindAfterMock).not.toHaveBeenCalled();
  });

  it("branches from current chapter and navigates to new story", async () => {
    const wrapper = mountComponent();

    await wrapper.findAll("button")[2]!.trigger("click");
    await flushPromises();

    expect(mockState.branchFromMock).toHaveBeenCalledWith("series-a", "story-a", 2, "new-branch");
    expect(mockState.loadFromBackendMock).toHaveBeenCalledWith("next-s", "next-n", 1);
    expect(mockState.routerPushMock).toHaveBeenCalledWith({
      name: "chapter",
      params: { series: "next-s", story: "next-n", chapter: "1" },
    });
  });

  it("shows fallback error messages for non-Error failures", async () => {
    mockState.rewindAfterMock.mockRejectedValueOnce("x");
    mockState.branchFromMock.mockRejectedValueOnce("x");
    vi.stubGlobal("prompt", vi.fn(() => " "));

    const wrapper = mountComponent();
    await wrapper.findAll("button")[1]!.trigger("click");
    await flushPromises();
    expect(wrapper.find(".toolbar-error").text()).toContain("倒回失敗");

    await wrapper.findAll("button")[2]!.trigger("click");
    await flushPromises();
    expect(wrapper.find(".toolbar-error").text()).toContain("分支失敗");
    expect(mockState.branchFromMock).toHaveBeenCalledWith("series-a", "story-a", 2, undefined);
  });

  // Regression: during LLM streaming, `commitContent()` bumps `renderEpoch`
  // many times per second but MUST NOT bump `remountToken`. The v-for key
  // depends on `remountToken`, so a renderEpoch-only bump must keep the
  // existing v-html element instance — preserving scroll position and any
  // imperative DOM markers (e.g. plugin-attached attributes) on the v-html
  // ROOT element.
  it("WHEN renderEpoch bumps without remountToken THEN v-html div is NOT remounted", async () => {
    mockState.renderChapterMock.mockImplementation(() => [
      { type: "html" as const, content: "<div class='plugin-sidebar'>panel</div>" },
    ]);

    const wrapper = mountComponent();
    await flushPromises();
    const initialDiv = wrapper.find(".chapter-content > div:not(.chapter-toolbar)").element;
    expect(initialDiv).toBeTruthy();
    // Place an imperative marker on the v-html ROOT element (the wrapper
    // div). Vue will patch its innerHTML in place on subsequent commits,
    // re-parsing descendants — but the root element instance is reused.
    (initialDiv as HTMLElement).setAttribute("data-test-marker", "kept");

    mockState.renderEpochRef.value++;
    await flushPromises();
    await nextTick();

    const afterDiv = wrapper.find(".chapter-content > div:not(.chapter-toolbar)").element;
    expect(afterDiv).toBe(initialDiv);
    expect((afterDiv as HTMLElement).getAttribute("data-test-marker")).toBe("kept");
  });

  // Regression: when ContentArea's sidebar relocation watch externally moves
  // .plugin-sidebar nodes out of the v-html div, a `forceTokenRemount()` call
  // (which bumps remountToken AND renderEpoch) must cause Vue to remount the
  // v-html div so the panel is restored in the DOM. Without keying on
  // `remountToken`, Vue would skip the v-html update on byte-identical
  // strings and the panel would be permanently lost on the next sidebar
  // clear.
  it("WHEN remountToken bumps with byte-identical tokens THEN v-html div remounts", async () => {
    mockState.renderChapterMock.mockImplementation(() => [
      { type: "html" as const, content: "<div class='plugin-sidebar'>panel</div>" },
    ]);

    const wrapper = mountComponent();
    await flushPromises();
    const initialPanel = wrapper.find(".plugin-sidebar").element as HTMLElement;
    expect(initialPanel).toBeTruthy();

    // Simulate ContentArea's relocation: remove the panel from the v-html
    // div as if it had been appendChild'd into the sidebar.
    initialPanel.remove();
    expect(wrapper.findAll(".plugin-sidebar")).toHaveLength(0);

    // Bumping remountToken (which forceTokenRemount also does) must cause
    // Vue to remount the v-html div even with byte-identical content.
    mockState.remountTokenRef.value++;
    mockState.renderEpochRef.value++;
    await flushPromises();

    const restored = wrapper.findAll(".plugin-sidebar");
    expect(restored).toHaveLength(1);
  });

  // Regression: pressing 取消 (cancel) after entering edit mode must call
  // `forceTokenRemount()` so ContentArea's sidebar relocation watch re-runs
  // AND the v-for is remounted. Without this, the v-html template re-mount
  // on cancel recreates panels in chapter content while stale copies remain
  // in the sidebar, producing duplicates.
  it("WHEN cancel is pressed THEN forceTokenRemount is called", async () => {
    const wrapper = mountComponent();
    await wrapper.findAll("button")[0]!.trigger("click");
    expect(wrapper.find("textarea.chapter-editor").exists()).toBe(true);

    await wrapper.findAll("button")[1]!.trigger("click");
    await flushPromises();

    expect(mockState.forceTokenRemountMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find("textarea.chapter-editor").exists()).toBe(false);
  });

  it("dispatches chapter:dom:ready after mount and on renderEpoch bump", async () => {
    const { frontendHooks } = await import("@/lib/plugin-hooks");
    const dispatchSpy = vi.spyOn(frontendHooks, "dispatch");
    const wrapper = mountComponent();
    await flushPromises();
    await nextTick();
    const readyCalls = dispatchSpy.mock.calls.filter(
      (c) => c[0] === "chapter:dom:ready",
    );
    expect(readyCalls.length).toBeGreaterThanOrEqual(1);
    const ctx = readyCalls[0]![1] as {
      container: HTMLElement;
      chapterIndex: number;
    };
    expect(ctx.container).toBe(wrapper.find(".chapter-content").element);
    expect(ctx.chapterIndex).toBe(0);

    const before = dispatchSpy.mock.calls.filter(
      (c) => c[0] === "chapter:dom:ready",
    ).length;
    mockState.renderEpochRef.value += 1;
    await flushPromises();
    await nextTick();
    const after = dispatchSpy.mock.calls.filter(
      (c) => c[0] === "chapter:dom:ready",
    ).length;
    expect(after).toBeGreaterThan(before);
    dispatchSpy.mockRestore();
  });

  it("does NOT dispatch chapter:dom:ready while editing", async () => {
    const { frontendHooks } = await import("@/lib/plugin-hooks");
    const wrapper = mountComponent();
    await flushPromises();
    await nextTick();
    const dispatchSpy = vi.spyOn(frontendHooks, "dispatch");
    await wrapper.findAll("button")[0]!.trigger("click");
    await flushPromises();
    await nextTick();
    const readyCalls = dispatchSpy.mock.calls.filter(
      (c) => c[0] === "chapter:dom:ready",
    );
    expect(readyCalls.length).toBe(0);
    dispatchSpy.mockRestore();
  });

  it("dispatches chapter:dom:dispose exactly once on unmount", async () => {
    const { frontendHooks } = await import("@/lib/plugin-hooks");
    const wrapper = mountComponent();
    await flushPromises();
    const container = wrapper.find(".chapter-content").element;
    const dispatchSpy = vi.spyOn(frontendHooks, "dispatch");
    wrapper.unmount();
    const disposeCalls = dispatchSpy.mock.calls.filter(
      (c) => c[0] === "chapter:dom:dispose",
    );
    expect(disposeCalls.length).toBe(1);
    const ctx = disposeCalls[0]![1] as {
      container: HTMLElement;
      chapterIndex: number;
    };
    expect(ctx.container).toBe(container);
    expect(ctx.chapterIndex).toBe(0);
    dispatchSpy.mockRestore();
  });
});

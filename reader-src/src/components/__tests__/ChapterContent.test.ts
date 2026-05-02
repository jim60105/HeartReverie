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
    pluginsReadyRef: { value: true },
    pluginsSettledRef: { value: true },
    backendContextRef: { value: {
      series: "series-a" as string | null,
      story: "story-a" as string | null,
      isBackendMode: true,
    } },
    reloadToLastMock: vi.fn().mockResolvedValue(undefined),
    refreshAfterEditMock: vi.fn().mockResolvedValue(undefined),
    bumpRenderEpochMock: vi.fn(),
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

// Initialise renderEpochRef as a real Vue ref so reactivity-dependent
// assertions (e.g. v-for key change on renderEpoch bump) work.
mockState.renderEpochRef = ref(0);

vi.mock("@/composables/useMarkdownRenderer", () => ({
  useMarkdownRenderer: () => ({ renderChapter: mockState.renderChapterMock }),
}));

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    chapters: mockState.chaptersRef,
    currentIndex: mockState.currentIndexRef,
    renderEpoch: mockState.renderEpochRef,
    getBackendContext: () => mockState.backendContextRef.value,
    reloadToLast: mockState.reloadToLastMock,
    refreshAfterEdit: mockState.refreshAfterEditMock,
    bumpRenderEpoch: mockState.bumpRenderEpochMock,
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
    mockState.bumpRenderEpochMock.mockClear();
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
    expect(mockState.refreshAfterEditMock).toHaveBeenCalledWith(2);
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
    expect(mockState.loadFromBackendMock).toHaveBeenCalledWith("next-s", "next-n", 2);
    expect(mockState.routerPushMock).toHaveBeenCalledWith({
      name: "chapter",
      params: { series: "next-s", story: "next-n", chapter: "2" },
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

  // Regression: when ContentArea's sidebar relocation watch externally moves
  // .plugin-sidebar nodes out of the v-html div, a subsequent renderEpoch
  // bump with byte-identical token content must still cause Vue to remount
  // the v-html div so the panel is restored in the DOM (where the watch can
  // pick it up again). Without `:key` including `renderEpoch`, Vue would
  // skip the v-html update on byte-identical strings and the panel would be
  // permanently lost on the next sidebar.innerHTML clear.
  it("WHEN renderEpoch bumps with byte-identical tokens THEN v-html div remounts", async () => {
    mockState.renderChapterMock.mockImplementation(() => [
      { type: "html" as const, content: "<div class='plugin-sidebar'>panel</div>" },
    ]);

    const wrapper = mountComponent();
    await flushPromises();
    const callsBefore = mockState.renderChapterMock.mock.calls.length;
    const initialPanel = wrapper.find(".plugin-sidebar").element as HTMLElement;
    expect(initialPanel).toBeTruthy();

    // Simulate the sidebar relocation watch removing the panel from the
    // v-html div (as ContentArea.vue does via sidebar.appendChild).
    initialPanel.remove();
    expect(wrapper.findAll(".plugin-sidebar")).toHaveLength(0);

    // Bump renderEpoch with the SAME token output — Vue must remount the
    // v-html div because the v-for key changed.
    mockState.renderEpochRef.value++;
    await flushPromises();
    const callsAfter = mockState.renderChapterMock.mock.calls.length;
    expect(callsAfter).toBeGreaterThan(callsBefore);

    const restoredPanels = wrapper.findAll(".plugin-sidebar");
    expect(restoredPanels).toHaveLength(1);
  });

  // Regression: pressing 取消 (cancel) after entering edit mode must bump
  // renderEpoch so ContentArea's sidebar relocation watch re-runs. Without
  // this bump, the v-html template re-mount on cancel recreates panels in
  // chapter content while stale copies remain in the sidebar, producing
  // duplicates.
  it("WHEN cancel is pressed THEN renderEpoch is bumped via bumpRenderEpoch", async () => {
    const wrapper = mountComponent();
    // Enter edit mode (button index 0 is the edit button when not editing).
    await wrapper.findAll("button")[0]!.trigger("click");
    expect(wrapper.find("textarea.chapter-editor").exists()).toBe(true);

    // Click cancel (button index 1 in edit mode: 儲存=0, 取消=1).
    await wrapper.findAll("button")[1]!.trigger("click");
    await flushPromises();

    expect(mockState.bumpRenderEpochMock).toHaveBeenCalledTimes(1);
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

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

import { nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import ContentArea from "@/components/ContentArea.vue";

const currentContentRef = ref<string | null>(null);
const isLastChapterRef = ref(false);
const renderEpochRef = ref(0);
const pluginsReadyRef = ref(true);
const pluginsSettledRef = ref(true);

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    currentContent: currentContentRef,
    isLastChapter: isLastChapterRef,
    renderEpoch: renderEpochRef,
  }),
}));

vi.mock("@/composables/usePlugins", () => ({
  usePlugins: () => ({
    pluginsReady: pluginsReadyRef,
    pluginsSettled: pluginsSettledRef,
  }),
}));

describe("ContentArea", () => {
  beforeEach(() => {
    currentContentRef.value = null;
    isLastChapterRef.value = false;
    renderEpochRef.value = 0;
    pluginsReadyRef.value = true;
    pluginsSettledRef.value = true;
  });

  it("WHEN currentContent is empty THEN welcome empty-state is rendered", () => {
    const wrapper = mount(ContentArea);
    expect(wrapper.find(".welcome-content").exists()).toBe(true);
    expect(wrapper.text()).toContain("故事選擇");
    expect(wrapper.find(".sidebar").exists()).toBe(true);
  });

  it("WHEN pluginsSettled is false THEN ChapterContent is gated and a loading placeholder is shown", () => {
    pluginsSettledRef.value = false;
    pluginsReadyRef.value = false;
    currentContentRef.value = "第 1 章內容";

    const wrapper = mount(ContentArea, {
      global: {
        stubs: {
          ChapterContent: { template: "<div class='chapter-stub'>content</div>" },
        },
      },
    });

    expect(wrapper.find(".chapter-stub").exists()).toBe(false);
    expect(wrapper.find(".content-loading").exists()).toBe(true);
  });

  it("WHEN chapter content exists THEN it renders ChapterContent and moves plugin-sidebars to Sidebar", async () => {
    currentContentRef.value = "第 1 章內容";
    isLastChapterRef.value = true;

    const wrapper = mount(ContentArea, {
      global: {
        stubs: {
          ChapterContent: {
            props: ["rawMarkdown", "isLastChapter"],
            template:
              "<div class='chapter-stub' :data-raw='rawMarkdown' :data-last='String(isLastChapter)'><div class='plugin-sidebar'>A</div><div class='plugin-sidebar'>B</div></div>",
          },
        },
      },
    });

    await nextTick();
    await nextTick();

    const chapter = wrapper.find(".chapter-stub");
    expect(chapter.exists()).toBe(true);
    expect(chapter.attributes("data-raw")).toBe("第 1 章內容");
    expect(chapter.attributes("data-last")).toBe("true");

    const sidebar = wrapper.find(".sidebar");
    expect(sidebar.findAll(".plugin-sidebar")).toHaveLength(2);
    expect(sidebar.text()).toContain("A");
    expect(sidebar.text()).toContain("B");
  });

  it("WHEN renderEpoch bumps with same content THEN sidebar keeps existing panels and duplicates are removed", async () => {
    currentContentRef.value = "第 1 章內容";

    const wrapper = mount(ContentArea, {
      global: {
        stubs: {
          ChapterContent: {
            props: ["rawMarkdown", "isLastChapter"],
            template: `<div class='chapter-stub'><div class='plugin-sidebar'>populated</div></div>`,
          },
        },
      },
    });

    await nextTick();
    await nextTick();

    let sidebar = wrapper.find(".sidebar");
    expect(sidebar.findAll(".plugin-sidebar")).toHaveLength(1);
    expect(sidebar.text()).toContain("populated");

    // Simulate epoch bump producing a duplicate empty panel in content (as
    // happens when v-html re-renders the same markdown). The sidebar's
    // populated panel must be preserved, and the duplicate removed.
    const stub = wrapper.find(".chapter-stub").element as HTMLElement;
    stub.innerHTML = "<div class='plugin-sidebar'></div>";
    renderEpochRef.value++;
    await nextTick();
    await nextTick();

    sidebar = wrapper.find(".sidebar");
    expect(sidebar.findAll(".plugin-sidebar")).toHaveLength(1);
    expect(sidebar.text()).toContain("populated");
    // Duplicate in content should be removed.
    expect(stub.querySelectorAll(".plugin-sidebar")).toHaveLength(0);
  });

  it("WHEN content text changes THEN sidebar is re-relocated against the latest DOM", async () => {
    currentContentRef.value = "第 1 章內容";

    const wrapper = mount(ContentArea, {
      global: {
        stubs: {
          ChapterContent: {
            props: ["rawMarkdown", "isLastChapter"],
            template: `<div class='chapter-stub'><div class='plugin-sidebar'>old</div></div>`,
          },
        },
      },
    });

    await nextTick();
    await nextTick();

    let sidebar = wrapper.find(".sidebar");
    expect(sidebar.findAll(".plugin-sidebar")).toHaveLength(1);
    expect(sidebar.text()).toContain("old");

    // Navigate to a different chapter (content text changes).
    const stub = wrapper.find(".chapter-stub").element as HTMLElement;
    stub.innerHTML = "<div class='plugin-sidebar'>new</div>";
    currentContentRef.value = "第 2 章內容";
    renderEpochRef.value++;
    await nextTick();
    await nextTick();

    sidebar = wrapper.find(".sidebar");
    expect(sidebar.findAll(".plugin-sidebar")).toHaveLength(1);
    expect(sidebar.text()).toContain("new");
  });

  it("WHEN content has no plugin-sidebar panels THEN sidebar is cleared", async () => {
    currentContentRef.value = "第 1 章內容";
    const wrapper = mount(ContentArea, {
      global: {
        stubs: {
          ChapterContent: {
            template: "<div class='chapter-stub'><div class='plugin-sidebar'>A</div></div>",
          },
        },
      },
    });
    await nextTick();
    await nextTick();
    expect(wrapper.find(".sidebar").findAll(".plugin-sidebar")).toHaveLength(1);

    // Navigate to a chapter with no panels.
    currentContentRef.value = "第 2 章";
    const stub = wrapper.find(".chapter-stub").element as HTMLElement;
    stub.innerHTML = "no panels here";
    renderEpochRef.value++;
    await nextTick();
    await nextTick();

    expect(wrapper.find(".sidebar").findAll(".plugin-sidebar")).toHaveLength(0);
  });

  it("WHEN pluginsSettled flips to true while pluginsReady stays false THEN ChapterContent mounts and sidebar relocation runs", async () => {
    pluginsSettledRef.value = false;
    pluginsReadyRef.value = false;
    currentContentRef.value = "第 1 章內容";

    const wrapper = mount(ContentArea, {
      global: {
        stubs: {
          ChapterContent: {
            template: "<div class='chapter-stub'><div class='plugin-sidebar'>P</div></div>",
          },
        },
      },
    });

    await nextTick();
    expect(wrapper.find(".chapter-stub").exists()).toBe(false);
    expect(wrapper.find(".content-loading").exists()).toBe(true);

    // Simulate plugin loader settling with a failure (settled=true, ready stays false).
    pluginsSettledRef.value = true;
    await nextTick();
    await nextTick();

    expect(wrapper.find(".chapter-stub").exists()).toBe(true);
    const sidebar = wrapper.find(".sidebar");
    expect(sidebar.findAll(".plugin-sidebar")).toHaveLength(1);
    expect(sidebar.text()).toContain("P");
  });

  it("WHEN renderEpoch bumps with identical panel HTML THEN sidebar child node identity is preserved", async () => {
    currentContentRef.value = "第 1 章內容";

    const wrapper = mount(ContentArea, {
      global: {
        stubs: {
          ChapterContent: {
            props: ["rawMarkdown", "isLastChapter"],
            template: `<div class='chapter-stub'><div class='plugin-sidebar'><span>status: idle</span></div></div>`,
          },
        },
      },
    });

    await nextTick();
    await nextTick();

    const sidebar = wrapper.find(".sidebar").element as HTMLElement;
    const initialPanel = sidebar.firstElementChild;
    expect(initialPanel).not.toBeNull();
    expect(initialPanel?.classList.contains("plugin-sidebar")).toBe(true);

    // Simulate a streaming chunk: the content area gets the same panel HTML
    // re-emitted (e.g. by plugin frontend-render re-running) and renderEpoch
    // bumps. The sidebar's already-relocated panel node MUST be the exact
    // same DOM node afterwards — no clear-and-re-append.
    const stub = wrapper.find(".chapter-stub").element as HTMLElement;
    stub.innerHTML = `<div class='plugin-sidebar'><span>status: idle</span></div>`;
    renderEpochRef.value++;
    await nextTick();
    await nextTick();

    const sidebarAfter = wrapper.find(".sidebar").element as HTMLElement;
    expect(sidebarAfter.firstElementChild).toBe(initialPanel);
    expect(sidebarAfter.querySelectorAll(".plugin-sidebar")).toHaveLength(1);
    // Duplicate in content area should be removed.
    expect(stub.querySelectorAll(".plugin-sidebar")).toHaveLength(0);
  });

  it("WHEN chapter text changes AND panel HTML changes THEN sidebar is cleared and the fresh panel is relocated", async () => {
    currentContentRef.value = "第 1 章內容";

    const wrapper = mount(ContentArea, {
      global: {
        stubs: {
          ChapterContent: {
            props: ["rawMarkdown", "isLastChapter"],
            template: `<div class='chapter-stub'><div class='plugin-sidebar'><span>v1</span></div></div>`,
          },
        },
      },
    });

    await nextTick();
    await nextTick();

    const sidebar = wrapper.find(".sidebar").element as HTMLElement;
    const initialPanel = sidebar.firstElementChild;
    expect(initialPanel?.textContent).toContain("v1");

    // Chapter navigation: currentContent changes AND panel HTML changes.
    currentContentRef.value = "第 2 章內容";
    const stub = wrapper.find(".chapter-stub").element as HTMLElement;
    stub.innerHTML = `<div class='plugin-sidebar'><span>v2</span></div>`;
    renderEpochRef.value++;
    await nextTick();
    await nextTick();

    const sidebarAfter = wrapper.find(".sidebar").element as HTMLElement;
    expect(sidebarAfter.querySelectorAll(".plugin-sidebar")).toHaveLength(1);
    expect(sidebarAfter.firstElementChild).not.toBe(initialPanel);
    expect(sidebarAfter.textContent).toContain("v2");
    expect(sidebarAfter.textContent).not.toContain("v1");
  });
});

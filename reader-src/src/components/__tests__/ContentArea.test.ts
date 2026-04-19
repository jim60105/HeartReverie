import { nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import ContentArea from "@/components/ContentArea.vue";

const currentContentRef = ref<string | null>(null);
const isLastChapterRef = ref(false);

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    currentContent: currentContentRef,
    isLastChapter: isLastChapterRef,
  }),
}));

describe("ContentArea", () => {
  beforeEach(() => {
    currentContentRef.value = null;
    isLastChapterRef.value = false;
  });

  it("WHEN currentContent is empty THEN welcome empty-state is rendered", () => {
    const wrapper = mount(ContentArea);
    expect(wrapper.find(".welcome-content").exists()).toBe(true);
    expect(wrapper.text()).toContain("選擇資料夾");
    expect(wrapper.find(".sidebar").exists()).toBe(true);
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
});

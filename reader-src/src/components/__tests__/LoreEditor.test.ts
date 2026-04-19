import { ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import LoreEditor from "@/components/lore/LoreEditor.vue";

const allTagsRef = ref<string[]>(["角色", "世界觀", "設定"]);
const mockReadPassage = vi.fn();
const mockWritePassage = vi.fn();
const mockDeletePassage = vi.fn();

vi.mock("@/composables/useLoreApi", () => ({
  useLoreApi: () => ({
    readPassage: mockReadPassage,
    writePassage: mockWritePassage,
    deletePassage: mockDeletePassage,
    allTags: allTagsRef,
  }),
}));

describe("LoreEditor", () => {
  beforeEach(() => {
    allTagsRef.value = ["角色", "世界觀", "設定"];
    vi.clearAllMocks();
  });

  it("loads existing passage in edit mode", async () => {
    mockReadPassage.mockResolvedValueOnce({
      frontmatter: { tags: ["角色"], priority: 3, enabled: false },
      content: "內文",
    });

    const wrapper = mount(LoreEditor, { props: { scope: "story", path: "a.md", series: "s", story: "t" } });
    await flushPromises();

    expect(mockReadPassage).toHaveBeenCalledWith("story", "a.md", "s", "t");
    expect((wrapper.find('input[placeholder="example.md"]').element as HTMLInputElement).value).toBe("a.md");
    expect((wrapper.find('textarea[placeholder="Markdown 內容..."]').element as HTMLTextAreaElement).value).toBe("內文");
    expect(wrapper.text()).toContain("停用");
  });

  it("shows tag suggestions and inserts selected tag", async () => {
    const wrapper = mount(LoreEditor, { props: { scope: "global" } });
    const tagsInput = wrapper.find('input[placeholder="角色, 世界觀, 設定"]');

    await tagsInput.setValue("角");
    await tagsInput.trigger("focus");
    await flushPromises();

    const suggestion = wrapper.find(".tag-suggestion");
    expect(suggestion.text()).toBe("角色");
    await suggestion.trigger("mousedown");

    expect((tagsInput.element as HTMLInputElement).value).toBe(" 角色, ");
  });

  it("saves new passage and emits saved", async () => {
    mockWritePassage.mockResolvedValueOnce(undefined);
    const wrapper = mount(LoreEditor, { props: { scope: "series", series: "s" } });

    await wrapper.find('input[placeholder="example.md"]').setValue("new.md");
    await wrapper.find('input[placeholder="角色, 世界觀, 設定"]').setValue("角色, 設定");
    await wrapper.find('textarea[placeholder="Markdown 內容..."]').setValue("lore text");
    await wrapper.find(".toolbar-btn--save").trigger("click");
    await flushPromises();

    expect(mockWritePassage).toHaveBeenCalledWith(
      "series",
      "new.md",
      { tags: ["角色", "設定"], priority: 0, enabled: true },
      "lore text",
      "s",
      undefined,
    );
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });

  it("shows save/delete fallback errors for non-Error exceptions", async () => {
    mockWritePassage.mockRejectedValueOnce("x");
    mockDeletePassage.mockRejectedValueOnce("x");
    mockReadPassage.mockResolvedValueOnce({
      frontmatter: { tags: [], priority: 0, enabled: true },
      content: "",
    });

    const wrapper = mount(LoreEditor, { props: { scope: "global", path: "x.md" } });
    await flushPromises();
    await wrapper.find(".toolbar-btn--save").trigger("click");
    await flushPromises();
    expect(wrapper.find(".editor-error").text()).toContain("儲存失敗");

    await wrapper.find(".toolbar-btn--danger").trigger("click");
    await wrapper.find(".confirm-actions .toolbar-btn--danger").trigger("click");
    await flushPromises();
    expect(wrapper.find(".editor-error").text()).toContain("刪除失敗");
  });

  it("deletes passage and emits deleted", async () => {
    mockReadPassage.mockResolvedValueOnce({
      frontmatter: { tags: [], priority: 0, enabled: true },
      content: "",
    });
    mockDeletePassage.mockResolvedValueOnce(undefined);

    const wrapper = mount(LoreEditor, { props: { scope: "global", path: "x.md" } });
    await flushPromises();
    await wrapper.find(".toolbar-btn--danger").trigger("click");
    await wrapper.find(".confirm-actions .toolbar-btn--danger").trigger("click");
    await flushPromises();

    expect(mockDeletePassage).toHaveBeenCalledWith("global", "x.md", undefined, undefined);
    expect(wrapper.emitted("deleted")).toHaveLength(1);
  });
});

import { mount } from "@vue/test-utils";
import LoreEditor from "@/components/lore/LoreEditor.vue";

const mockReadPassage = vi.fn();
const mockWritePassage = vi.fn();
const mockDeletePassage = vi.fn();

vi.mock("@/composables/useLoreApi", () => ({
  useLoreApi: () => ({
    readPassage: mockReadPassage,
    writePassage: mockWritePassage,
    deletePassage: mockDeletePassage,
  }),
}));

describe("LoreEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "新增篇章" title when no path prop', () => {
    const wrapper = mount(LoreEditor, {
      props: { scope: "global" },
    });
    expect(wrapper.find(".editor-title").text()).toBe("新增篇章");
  });

  it('renders "編輯篇章" title when path prop is given', () => {
    mockReadPassage.mockResolvedValue({
      frontmatter: { tags: [], priority: 0, enabled: true },
      content: "",
    });
    const wrapper = mount(LoreEditor, {
      props: { scope: "global", path: "test.md" },
    });
    expect(wrapper.find(".editor-title").text()).toBe("編輯篇章");
  });

  it("filename input is editable in create mode", () => {
    const wrapper = mount(LoreEditor, {
      props: { scope: "global" },
    });
    const input = wrapper.find('input[type="text"][placeholder="example.md"]');
    expect(input.attributes("readonly")).toBeUndefined();
  });

  it("filename input is readonly in edit mode", () => {
    mockReadPassage.mockResolvedValue({
      frontmatter: { tags: [], priority: 0, enabled: true },
      content: "",
    });
    const wrapper = mount(LoreEditor, {
      props: { scope: "global", path: "test.md" },
    });
    const input = wrapper.find('input[type="text"][placeholder="example.md"]');
    expect(input.attributes("readonly")).toBeDefined();
  });

  it("shows filename validation error when not ending with .md", async () => {
    const wrapper = mount(LoreEditor, {
      props: { scope: "global" },
    });
    const input = wrapper.find('input[type="text"][placeholder="example.md"]');
    await input.setValue("noext");

    expect(wrapper.find(".field-hint--error").text()).toBe(
      "檔名必須以 .md 結尾",
    );
  });

  it("save button is disabled when filename is invalid", async () => {
    const wrapper = mount(LoreEditor, {
      props: { scope: "global" },
    });
    const input = wrapper.find('input[type="text"][placeholder="example.md"]');
    await input.setValue("bad");

    const saveBtn = wrapper.find(".toolbar-btn--save");
    expect(saveBtn.attributes("disabled")).toBeDefined();
  });

  it('emits "cancelled" when cancel button clicked', async () => {
    const wrapper = mount(LoreEditor, {
      props: { scope: "global" },
    });
    const cancelBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("取消"));
    expect(cancelBtn).toBeDefined();

    await cancelBtn!.trigger("click");
    expect(wrapper.emitted("cancelled")).toHaveLength(1);
  });

  it("delete button only shown in edit mode", () => {
    const createWrapper = mount(LoreEditor, {
      props: { scope: "global" },
    });
    expect(createWrapper.find(".toolbar-btn--danger").exists()).toBe(false);

    mockReadPassage.mockResolvedValue({
      frontmatter: { tags: [], priority: 0, enabled: true },
      content: "",
    });
    const editWrapper = mount(LoreEditor, {
      props: { scope: "global", path: "test.md" },
    });
    expect(editWrapper.find(".toolbar-btn--danger").exists()).toBe(true);
  });

  it("delete shows confirmation dialog before proceeding", async () => {
    mockReadPassage.mockResolvedValue({
      frontmatter: { tags: [], priority: 0, enabled: true },
      content: "",
    });
    const wrapper = mount(LoreEditor, {
      props: { scope: "global", path: "test.md" },
    });

    // No confirm dialog initially
    expect(wrapper.find(".confirm-overlay").exists()).toBe(false);

    // Click delete button
    const deleteBtn = wrapper.find(".toolbar-btn--danger");
    await deleteBtn.trigger("click");

    // Confirm dialog appears
    expect(wrapper.find(".confirm-overlay").exists()).toBe(true);
    expect(wrapper.find(".confirm-text").text()).toContain("test.md");
  });
});

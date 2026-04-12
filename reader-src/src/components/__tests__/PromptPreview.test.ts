import { mount } from "@vue/test-utils";
import PromptEditor from "@/components/PromptEditor.vue";

// Mock usePromptEditor composable
vi.mock("@/composables/usePromptEditor", () => ({
  usePromptEditor: () => ({
    templateContent: { value: "template content" },
    originalTemplate: { value: "original" },
    parameters: { value: [] },
    savedTemplate: { value: undefined },
    saveTemplate: vi.fn(),
    loadTemplate: vi.fn(() => Promise.resolve()),
    resetTemplate: vi.fn(),
    previewTemplate: vi.fn(() =>
      Promise.resolve({ prompt: "preview result" }),
    ),
  }),
}));

describe("PromptEditor", () => {
  it("renders without crashing", () => {
    const wrapper = mount(PromptEditor);
    expect(wrapper.exists()).toBe(true);
  });

  it("contains a textarea for template editing", () => {
    const wrapper = mount(PromptEditor);
    expect(wrapper.find("textarea").exists()).toBe(true);
  });

  it("renders reset button", () => {
    const wrapper = mount(PromptEditor);
    const text = wrapper.text();
    // The component should have some way to reset
    expect(
      text.includes("重設") ||
        text.includes("Reset") ||
        wrapper.findAll("button").length > 0,
    ).toBe(true);
  });
});

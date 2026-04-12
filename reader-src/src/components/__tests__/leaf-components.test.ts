import { mount } from "@vue/test-utils";
import StatusBar from "@/components/StatusBar.vue";
import OptionsPanel from "@/components/OptionsPanel.vue";
import VariableDisplay from "@/components/VariableDisplay.vue";
import type { StatusBarProps, OptionItem } from "@/types";

describe("StatusBar", () => {
  function mountStatus(props: Partial<StatusBarProps> = {}) {
    const defaults: StatusBarProps = {
      name: "",
      title: "",
      scene: "",
      thought: "",
      items: "",
      clothes: "",
      shoes: "",
      socks: "",
      accessories: "",
      closeUps: [],
    };
    return mount(StatusBar, { props: { ...defaults, ...props } });
  }

  it("renders name and title", () => {
    const wrapper = mountStatus({ name: "Alice", title: "勇者" });
    expect(wrapper.text()).toContain("Alice");
    expect(wrapper.text()).toContain("勇者");
  });

  it("renders scene info row", () => {
    const wrapper = mountStatus({ scene: "森林" });
    expect(wrapper.text()).toContain("場景:");
    expect(wrapper.text()).toContain("森林");
  });

  it("renders thought info row", () => {
    const wrapper = mountStatus({ thought: "好奇" });
    expect(wrapper.text()).toContain("想法:");
    expect(wrapper.text()).toContain("好奇");
  });

  it("renders items info row", () => {
    const wrapper = mountStatus({ items: "長劍" });
    expect(wrapper.text()).toContain("物品:");
    expect(wrapper.text()).toContain("長劍");
  });

  it("renders outfit section when clothes provided", () => {
    const wrapper = mountStatus({ clothes: "洋裝", shoes: "高跟鞋" });
    expect(wrapper.text()).toContain("穿着");
    expect(wrapper.text()).toContain("洋裝");
    expect(wrapper.text()).toContain("高跟鞋");
  });

  it("renders close-ups section", () => {
    const wrapper = mountStatus({
      closeUps: [{ part: "臉部", description: "微笑" }],
    });
    expect(wrapper.text()).toContain("特寫");
    expect(wrapper.text()).toContain("臉部");
    expect(wrapper.text()).toContain("微笑");
  });

  it("does not render header when name and title are empty", () => {
    const wrapper = mountStatus();
    expect(wrapper.find(".char-header").exists()).toBe(false);
  });

  it("does not render outfit when no clothing fields", () => {
    const wrapper = mountStatus();
    expect(wrapper.text()).not.toContain("穿着");
  });

  it("does not render close-ups when empty", () => {
    const wrapper = mountStatus();
    expect(wrapper.text()).not.toContain("特寫");
  });
});

describe("OptionsPanel", () => {
  it("renders 4-cell grid with items", () => {
    const items: OptionItem[] = [
      { number: 1, text: "A" },
      { number: 2, text: "B" },
      { number: 3, text: "C" },
      { number: 4, text: "D" },
    ];
    const wrapper = mount(OptionsPanel, { props: { items } });
    const buttons = wrapper.findAll(".era-action-btn");
    expect(buttons.length).toBe(4);
    expect(wrapper.text()).toContain("A");
    expect(wrapper.text()).toContain("D");
  });

  it("renders empty slots when fewer than 4 items", () => {
    const items: OptionItem[] = [{ number: 1, text: "Only" }];
    const wrapper = mount(OptionsPanel, { props: { items } });
    const empty = wrapper.findAll(".era-action-btn--empty");
    expect(empty.length).toBe(3);
  });

  it("emits 'select' on button click", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(() => Promise.resolve()) },
    });
    const items: OptionItem[] = [{ number: 1, text: "Go" }];
    const wrapper = mount(OptionsPanel, { props: { items } });
    await wrapper.find(".era-action-btn").trigger("click");
    expect(wrapper.emitted("select")).toBeTruthy();
    expect(wrapper.emitted("select")![0]).toEqual(["Go"]);
    vi.unstubAllGlobals();
  });

  it("renders header with title", () => {
    const wrapper = mount(OptionsPanel, { props: { items: [] } });
    expect(wrapper.text()).toContain("行動選項");
  });

  it("renders 4 empty cells when no items", () => {
    const wrapper = mount(OptionsPanel, { props: { items: [] } });
    const empty = wrapper.findAll(".era-action-btn--empty");
    expect(empty.length).toBe(4);
  });
});

describe("VariableDisplay", () => {
  it("renders complete block with correct summary", () => {
    const wrapper = mount(VariableDisplay, {
      props: { content: "data", isComplete: true },
    });
    expect(wrapper.text()).toContain("變數更新詳情");
    expect(wrapper.find(".variable-block").exists()).toBe(true);
  });

  it("renders incomplete block with streaming summary", () => {
    const wrapper = mount(VariableDisplay, {
      props: { content: "partial", isComplete: false },
    });
    expect(wrapper.text()).toContain("變數更新中...");
  });

  it("renders content in pre element", () => {
    const wrapper = mount(VariableDisplay, {
      props: { content: "var = 42", isComplete: true },
    });
    expect(wrapper.find("pre").text()).toContain("var = 42");
  });

  it("renders as collapsed details element", () => {
    const wrapper = mount(VariableDisplay, {
      props: { content: "x", isComplete: true },
    });
    expect(wrapper.find("details").exists()).toBe(true);
  });
});

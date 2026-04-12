import { mount } from "@vue/test-utils";
import VentoErrorCard from "@/components/VentoErrorCard.vue";

describe("VentoErrorCard", () => {
  it("renders error card with message", () => {
    const wrapper = mount(VentoErrorCard, {
      props: { message: "Something broke" },
    });
    expect(wrapper.find(".vento-error-card").exists()).toBe(true);
    expect(wrapper.text()).toContain("模板渲染錯誤");
    expect(wrapper.text()).toContain("Something broke");
  });

  it("renders source file info", () => {
    const wrapper = mount(VentoErrorCard, {
      props: { message: "err", source: "template.vto" },
    });
    expect(wrapper.text()).toContain("檔案: template.vto");
  });

  it("renders source with line number", () => {
    const wrapper = mount(VentoErrorCard, {
      props: { message: "err", source: "a.vto", line: 42 },
    });
    expect(wrapper.text()).toContain("a.vto");
    expect(wrapper.text()).toContain("42");
  });

  it("renders suggestion", () => {
    const wrapper = mount(VentoErrorCard, {
      props: { message: "err", suggestion: "Try this" },
    });
    expect(wrapper.text()).toContain("Try this");
  });

  it("omits source section when not provided", () => {
    const wrapper = mount(VentoErrorCard, {
      props: { message: "err" },
    });
    expect(wrapper.find(".vento-error-source").exists()).toBe(false);
  });

  it("omits suggestion section when not provided", () => {
    const wrapper = mount(VentoErrorCard, {
      props: { message: "err" },
    });
    expect(wrapper.find(".vento-error-suggestion").exists()).toBe(false);
  });

  it("renders all fields together", () => {
    const wrapper = mount(VentoErrorCard, {
      props: {
        message: "Undefined variable",
        source: "main.vto",
        line: 7,
        suggestion: "Check variable name",
      },
    });
    expect(wrapper.text()).toContain("Undefined variable");
    expect(wrapper.text()).toContain("main.vto");
    expect(wrapper.text()).toContain("7");
    expect(wrapper.text()).toContain("Check variable name");
  });
});

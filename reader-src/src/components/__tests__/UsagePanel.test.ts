import { mount } from "@vue/test-utils";
import UsagePanel from "@/components/UsagePanel.vue";
import { useUsage } from "@/composables/useUsage";

describe("UsagePanel", () => {
  beforeEach(() => {
    useUsage().reset();
  });

  it("renders nothing when count is zero", () => {
    const wrapper = mount(UsagePanel);
    expect(wrapper.find(".usage-panel").exists()).toBe(false);
  });

  it("renders summary with totals and most recent record", async () => {
    const api = useUsage();
    api.pushRecord({
      chapter: 1,
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
      model: "gpt-test",
      timestamp: "2026-01-01T00:00:00Z",
    });
    api.pushRecord({
      chapter: 2,
      promptTokens: 50,
      completionTokens: 150,
      totalTokens: 200,
      model: "gpt-test",
      timestamp: "2026-01-01T00:01:00Z",
    });
    const wrapper = mount(UsagePanel);
    const summary = wrapper.find("summary").text();
    expect(summary).toContain("總計：500 tokens");
    expect(summary).toContain("最近：50+150");
  });

  it("renders recent records in reverse order, last 10", async () => {
    const api = useUsage();
    for (let i = 0; i < 12; i++) {
      api.pushRecord({
        chapter: i + 1,
        promptTokens: i,
        completionTokens: i,
        totalTokens: i * 2,
        model: "m",
        timestamp: `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`,
      });
    }
    const wrapper = mount(UsagePanel);
    const rows = wrapper.findAll("tbody tr");
    expect(rows.length).toBe(10);
    // Most recent (chapter 12) first
    expect(rows[0]?.text()).toContain("12");
    expect(rows[9]?.text()).toContain("3");
  });
});

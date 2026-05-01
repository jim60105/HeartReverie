import { flushPromises, mount } from "@vue/test-utils";
import PromptPreview from "@/components/PromptPreview.vue";

const getAuthHeadersMock = vi.fn(() => ({ "X-Passphrase": "pw" }));

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({ getAuthHeaders: getAuthHeadersMock }),
}));

describe("PromptPreview", () => {
  beforeEach(() => {
    getAuthHeadersMock.mockClear();
  });

  it("shows missing-story message when series/story is empty", async () => {
    const wrapper = mount(PromptPreview, {
      props: { series: "", story: "", message: "hi" },
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".preview-error").text()).toContain("尚未選擇故事");
  });

  it("fetches and renders preview with metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [
          { role: "system", content: "system body" },
          { role: "user", content: "user body" },
        ],
        fragments: ["plugin-a"],
        variables: { previous_context: 4 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(PromptPreview, {
      props: { series: "s", story: "t", message: "hello", template: "{{ x }}" },
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(options.body)).toContain("\"template\":\"{{ x }}\"");
    const cards = wrapper.findAll(".message-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.classes()).toContain("message-card--system");
    expect(cards[0]!.text()).toContain("system");
    expect(cards[0]!.text()).toContain("system body");
    expect(cards[1]!.classes()).toContain("message-card--user");
    expect(cards[1]!.text()).toContain("user body");
    expect(wrapper.find(".preview-meta").text()).toContain("Messages: 2");
    expect(wrapper.find(".preview-meta").text()).toContain("Plugins: plugin-a");
    expect(wrapper.find(".preview-meta").text()).toContain("Chapters: 4");
  });

  it("renders a single auto-rolled system message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [{ role: "system", content: "auto-rolled system" }],
        variables: { previous_context: 0 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(PromptPreview, {
      props: { series: "s", story: "t", message: "hello" },
    });
    await flushPromises();

    const cards = wrapper.findAll(".message-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.classes()).toContain("message-card--system");
    expect(cards[0]!.text()).toContain("auto-rolled system");
    expect(wrapper.find(".preview-meta").text()).toContain("Messages: 1");
  });

  it("uses HTTP status when error body is not JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("bad json");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(PromptPreview, {
      props: { series: "s", story: "t", message: "hello" },
    });
    await flushPromises();

    expect(wrapper.find(".preview-error").text()).toContain("HTTP 500");
  });

  it("supports manual refetch and unknown-error fallback", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce("boom")
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: "bad request" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(PromptPreview, {
      props: { series: "s", story: "t", message: "hello" },
    });
    await flushPromises();
    expect(wrapper.find(".preview-error").text()).toContain("Unknown error");

    await (wrapper.vm as unknown as { fetchPreview: () => Promise<void> }).fetchPreview();
    await flushPromises();
    expect(wrapper.find(".preview-error").text()).toContain("bad request");
  });
});

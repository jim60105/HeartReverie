/**
 * Component-level regression tests for the chat-input visibility-on-transitions
 * bug. Unlike the sibling `MainLayout.test.ts` (which injects synthetic refs via
 * a global `vi.mock("@/composables/useChapterNav")`), these tests wire the REAL
 * `useChapterNav` composable and assert the DOM mount of `<ChatInput>`.
 *
 * Covers the same scenarios as
 * `composables/__tests__/useChapterNav-chat-input-visibility.test.ts`, but at
 * the rendered-component layer to guard against any regression that would
 * decouple `MainLayout.vue#showChatInput` from the composable's reactive state.
 *
 * IMPORTANT: This file deliberately does NOT mock `useChapterNav`. It is
 * sibling to (not part of) `MainLayout.test.ts`, so the global mock there does
 * not leak across files.
 */
import { nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { stubSessionStorage } from "@/__tests__/setup";

const mockRouteParams = ref<Record<string, string | undefined>>({});
vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => ({ params: mockRouteParams.value }),
  };
});

vi.mock("@/router", () => ({
  default: { push: vi.fn(), replace: vi.fn() },
}));

const mockWsIsConnected = ref(false);
const mockWsSend = vi.fn();
const mockWsOnMessage = vi.fn(() => vi.fn());
vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: () => ({
    isConnected: mockWsIsConnected,
    isAuthenticated: ref(true),
    send: mockWsSend,
    onMessage: mockWsOnMessage,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

const isLoadingRef = ref(false);
const errorMessageRef = ref("");
const streamingContentRef = ref("");
vi.mock("@/composables/useChatApi", () => ({
  useChatApi: () => ({
    isLoading: isLoadingRef,
    errorMessage: errorMessageRef,
    streamingContent: streamingContentRef,
    abortCurrentRequest: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(true),
    resendMessage: vi.fn().mockResolvedValue(true),
    continueLastChapter: vi.fn().mockResolvedValue(true),
  }),
}));

function jsonRes(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  };
}

function chapters(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    content: `chapter ${i + 1}`,
  }));
}

async function mountWithRealNav() {
  // Dynamic imports AFTER module reset so the singleton composable starts fresh.
  const MainLayout = (await import("@/components/MainLayout.vue")).default;
  const ChatInput = (await import("@/components/ChatInput.vue")).default;
  const nav = (await import("@/composables/useChapterNav")).useChapterNav();
  const wrapper = mount(MainLayout, {
    global: {
      stubs: {
        AppHeader: { template: "<div class='app-header-stub'></div>" },
        ContentArea: { template: "<div class='content-area-stub'></div>" },
        UsagePanel: { template: "<div class='usage-panel-stub'></div>" },
        PluginActionBar: {
          template: "<div class='plugin-action-bar-stub'></div>",
        },
      },
    },
  });
  return { wrapper, nav, ChatInput };
}

describe("MainLayout chat-input visibility (real useChapterNav)", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockRouteParams.value = {};
    mockWsIsConnected.value = false;
    mockWsSend.mockClear();
    mockWsOnMessage.mockClear();
    mockWsOnMessage.mockImplementation(() => vi.fn());
    isLoadingRef.value = false;
    errorMessageRef.value = "";
    streamingContentRef.value = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("repro A — single-chapter story loaded after cold mount renders ChatInput", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonRes(chapters(1)))));

    const { wrapper, nav, ChatInput } = await mountWithRealNav();
    // Cold mount: no backend mode → no chat input.
    expect(wrapper.findComponent(ChatInput).exists()).toBe(false);

    await nav.loadFromBackend("s1", "story1");
    await nextTick();

    expect(wrapper.findComponent(ChatInput).exists()).toBe(true);
  });

  it("repro B1 — goToLast on a multi-chapter story after cold mount renders ChatInput", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonRes(chapters(3)))));

    const { wrapper, nav, ChatInput } = await mountWithRealNav();
    expect(wrapper.findComponent(ChatInput).exists()).toBe(false);

    await nav.loadFromBackend("s1", "story1");
    await nextTick();
    expect(wrapper.findComponent(ChatInput).exists()).toBe(false);

    nav.goToLast();
    await nextTick();

    expect(wrapper.findComponent(ChatInput).exists()).toBe(true);
  });

  it("repro B2 — deeplink start, goToLast after pre-loaded backend renders ChatInput", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonRes(chapters(3)))));

    // Pre-load BEFORE mount, simulating the deeplink path where backend mode is
    // already true when MainLayout first paints.
    mockRouteParams.value = { series: "s1", story: "story1", chapter: "1" };
    const navModule = await import("@/composables/useChapterNav");
    const pre = navModule.useChapterNav();
    await pre.loadFromBackend("s1", "story1", 1);

    const { wrapper, nav, ChatInput } = await mountWithRealNav();
    expect(wrapper.findComponent(ChatInput).exists()).toBe(false);

    nav.goToLast();
    await nextTick();

    expect(wrapper.findComponent(ChatInput).exists()).toBe(true);
  });

  it("atomic transition — no inconsistent intermediate render between two stories", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        call += 1;
        return Promise.resolve(jsonRes(chapters(call === 1 ? 3 : 1)));
      }),
    );

    const { wrapper, nav, ChatInput } = await mountWithRealNav();
    await nav.loadFromBackend("seriesA", "storyA");
    await nextTick();
    // On chapter 1 of 3 → not last → hidden.
    expect(wrapper.findComponent(ChatInput).exists()).toBe(false);

    // Switch to a 1-chapter story. After the transition completes (a single
    // synchronous tuple-write inside loadFromBackend, then await nextTick), the
    // DOM must show ChatInput. The atomicity contract guarantees no
    // intermediate render where chapters.length=1 with the wrong index.
    await nav.loadFromBackend("seriesB", "storyB");
    await nextTick();

    expect(nav.chapters.value.length).toBe(1);
    expect(nav.isLastChapter.value).toBe(true);
    expect(wrapper.findComponent(ChatInput).exists()).toBe(true);
  });

  it("syncRoute:false direct load — bypassing router navigation still renders ChatInput", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonRes(chapters(1)))));

    const { wrapper, nav, ChatInput } = await mountWithRealNav();
    expect(wrapper.findComponent(ChatInput).exists()).toBe(false);

    await nav.loadFromBackend("s1", "story1", undefined, { syncRoute: false });
    await nextTick();

    expect(wrapper.findComponent(ChatInput).exists()).toBe(true);
  });
});

import { stubSessionStorage } from "@/__tests__/setup";
import { ref } from "vue";

const mockRouteParams = ref<Record<string, string | undefined>>({});
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: mockRouteParams.value }),
}));

vi.mock("@/router", () => ({
  default: { push: vi.fn(), replace: vi.fn() },
}));

const mockWsIsConnected = ref(false);
vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: () => ({
    isConnected: mockWsIsConnected,
    isAuthenticated: ref(true),
    send: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

describe("useChapterNav — chapterCount & latestChapterIsEmpty", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockRouteParams.value = {};
    mockWsIsConnected.value = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getNav() {
    const mod = await import("@/composables/useChapterNav");
    return mod.useChapterNav();
  }

  it("chapterCount mirrors chapters length", async () => {
    const nav = await getNav();
    nav.chapters.value = [];
    expect(nav.chapterCount.value).toBe(0);
    nav.chapters.value = [
      { number: 1, content: "a" },
      { number: 2, content: "b" },
    ];
    expect(nav.chapterCount.value).toBe(2);
  });

  it("latestChapterIsEmpty: empty chapter array → true", async () => {
    const nav = await getNav();
    nav.chapters.value = [];
    expect(nav.latestChapterIsEmpty.value).toBe(true);
  });

  it("latestChapterIsEmpty: last chapter content is whitespace → true", async () => {
    const nav = await getNav();
    nav.chapters.value = [{ number: 1, content: "   \n\t  " }];
    expect(nav.latestChapterIsEmpty.value).toBe(true);
  });

  it("latestChapterIsEmpty: only empty <user_message></user_message> → true", async () => {
    const nav = await getNav();
    nav.chapters.value = [
      { number: 1, content: "<user_message>   </user_message>\n\n" },
    ];
    expect(nav.latestChapterIsEmpty.value).toBe(true);
  });

  it("latestChapterIsEmpty: <user_message> with body → false", async () => {
    const nav = await getNav();
    nav.chapters.value = [
      { number: 1, content: "<user_message>hello</user_message>" },
    ];
    expect(nav.latestChapterIsEmpty.value).toBe(false);
  });

  it("latestChapterIsEmpty: prose only, no user_message → false", async () => {
    const nav = await getNav();
    nav.chapters.value = [{ number: 1, content: "Some prose body." }];
    expect(nav.latestChapterIsEmpty.value).toBe(false);
  });

  it("latestChapterIsEmpty: case-insensitive <USER_MESSAGE> recognised", async () => {
    const nav = await getNav();
    nav.chapters.value = [
      { number: 1, content: "<USER_MESSAGE></USER_MESSAGE>   " },
    ];
    expect(nav.latestChapterIsEmpty.value).toBe(true);
  });

  it("latestChapterIsEmpty: prose alongside empty user_message → false", async () => {
    const nav = await getNav();
    nav.chapters.value = [
      {
        number: 1,
        content: "<user_message></user_message>\nactual prose tail",
      },
    ];
    expect(nav.latestChapterIsEmpty.value).toBe(false);
  });
});

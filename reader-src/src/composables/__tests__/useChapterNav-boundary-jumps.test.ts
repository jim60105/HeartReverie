import { useChapterNav } from "@/composables/useChapterNav";
import { frontendHooks } from "@/lib/plugin-hooks";

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({}),
    isAuthenticated: { value: true },
  }),
}));

vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: () => ({
    state: { value: "disconnected" },
    isConnected: { value: false },
    onMessage: vi.fn(() => () => {}),
    sendMessage: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock("vue-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("vue-router");
  return {
    ...actual,
    useRoute: () => ({
      name: "home",
      params: {},
      path: "/",
    }),
  };
});

vi.mock("@/router", () => ({
  default: {
    replace: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("useChapterNav boundary jumps", () => {
  beforeEach(() => {
    const nav = useChapterNav();
    nav.chapters.value = [];
    nav.currentIndex.value = 0;
  });

  it("goToFirst is a no-op when chapter list is empty", () => {
    const nav = useChapterNav();
    nav.chapters.value = [];
    const dispatch = vi.spyOn(frontendHooks, "dispatch");
    nav.goToFirst();
    expect(nav.currentIndex.value).toBe(0);
    expect(dispatch).not.toHaveBeenCalledWith("chapter:change", expect.anything());
    dispatch.mockRestore();
  });

  it("goToLast is a no-op when chapter list is empty", () => {
    const nav = useChapterNav();
    nav.chapters.value = [];
    const dispatch = vi.spyOn(frontendHooks, "dispatch");
    nav.goToLast();
    expect(nav.currentIndex.value).toBe(0);
    expect(dispatch).not.toHaveBeenCalledWith("chapter:change", expect.anything());
    dispatch.mockRestore();
  });

  it("goToFirst from index 5 lands on index 0 and dispatches chapter:change", async () => {
    const chapters = Array.from({ length: 11 }, (_, i) => ({
      number: i + 1,
      content: `c${i + 1}`,
    }));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(chapters),
    }) as unknown as typeof fetch;

    const nav = useChapterNav();
    await nav.loadFromBackend("S", "T");
    nav.currentIndex.value = 5;

    const dispatch = vi.spyOn(frontendHooks, "dispatch");
    nav.goToFirst();
    expect(nav.currentIndex.value).toBe(0);
    expect(dispatch).toHaveBeenCalledWith(
      "chapter:change",
      expect.objectContaining({ previousIndex: 5, index: 0 }),
    );
    dispatch.mockRestore();
  });

  it("goToLast from index 2 with 11 chapters lands on index 10", async () => {
    const chapters = Array.from({ length: 11 }, (_, i) => ({
      number: i + 1,
      content: `c${i + 1}`,
    }));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(chapters),
    }) as unknown as typeof fetch;

    const nav = useChapterNav();
    await nav.loadFromBackend("S2", "T2");
    nav.currentIndex.value = 2;

    const dispatch = vi.spyOn(frontendHooks, "dispatch");
    nav.goToLast();
    expect(nav.currentIndex.value).toBe(10);
    expect(dispatch).toHaveBeenCalledWith(
      "chapter:change",
      expect.objectContaining({ previousIndex: 2, index: 10 }),
    );
    dispatch.mockRestore();
  });
});

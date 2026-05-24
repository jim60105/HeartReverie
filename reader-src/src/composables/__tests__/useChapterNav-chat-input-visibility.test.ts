/**
 * Regression tests for the chat-input visibility-on-transitions bug.
 *
 * These tests pin the contract from
 * `openspec/changes/fix-chat-input-visibility-on-transitions`:
 *
 * 1. `currentSeries`/`currentStory` are reactive — `getBackendContext()` reads
 *    them inside a `computed` and the computed must re-evaluate when they
 *    change (the cold-mount subscription path that broke repro A and B1).
 * 2. `loadFromBackend` / `reloadToLast` / `refreshAfterEdit` perform the
 *    `chapters` + `currentIndex` writes atomically: default-flush consumers
 *    and plugin hooks never observe a (length=N_new, index=stale) pair that
 *    would mis-evaluate `isLastChapter`.
 *
 * The composable is module-scoped state, so each test file's `vi.resetModules`
 * gives us a fresh singleton.
 */
import { stubSessionStorage } from "@/__tests__/setup";
import { computed, ref, watchEffect } from "vue";

const mockRouteParams = ref<Record<string, string | undefined>>({});
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: mockRouteParams.value }),
}));

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

async function getNav() {
  const mod = await import("@/composables/useChapterNav");
  return mod.useChapterNav();
}

describe("chat-input visibility — reactivity regression", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockRouteParams.value = {};
    mockWsIsConnected.value = false;
    mockWsSend.mockClear();
    mockWsOnMessage.mockClear();
    mockWsOnMessage.mockImplementation(() => vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Mirror of `MainLayout.vue#showChatInput` — a computed that reads
   * `getBackendContext().isBackendMode` (short-circuit), `isLastChapter`,
   * and `chapters.length`. Built the same way as the production computed so
   * any subscription bug there shows up here.
   */
  function makeShowChatInputComputed(nav: Awaited<ReturnType<typeof getNav>>) {
    return computed(() => {
      const ctx = nav.getBackendContext();
      return (
        ctx.isBackendMode &&
        (nav.isLastChapter.value || nav.chapters.value.length === 0)
      );
    });
  }

  it("repro A — single-chapter story loaded after computed mount makes chat input visible", async () => {
    // Cold start: backend mode is false → computed evaluates to false and
    // short-circuits BEFORE reading isLastChapter/chapters. If currentSeries/
    // currentStory are non-reactive, the subscription never establishes and
    // the computed stays false forever.
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonRes(chapters(1)))));

    const nav = await getNav();
    const showChatInput = makeShowChatInputComputed(nav);

    expect(showChatInput.value).toBe(false); // pre-load: not in backend mode

    await nav.loadFromBackend("s1", "story1");

    // Single-chapter story: index 0 IS the last chapter; chat input MUST show.
    expect(showChatInput.value).toBe(true);
  });

  it("repro B1 — goToLast after cold-mounted MainLayout makes chat input visible", async () => {
    // Multi-chapter story loaded after the computed mounts; user lands on
    // chapter 1, then presses goToLast.
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonRes(chapters(3)))));

    const nav = await getNav();
    const showChatInput = makeShowChatInputComputed(nav);

    expect(showChatInput.value).toBe(false);

    await nav.loadFromBackend("s1", "story1");

    // On chapter 1 of 3 → not last → hidden.
    expect(showChatInput.value).toBe(false);
    expect(nav.currentIndex.value).toBe(0);

    // Press goToLast → currentIndex jumps to 2 → computed must re-fire.
    nav.goToLast();

    expect(nav.currentIndex.value).toBe(2);
    expect(nav.isLastChapter.value).toBe(true);
    expect(showChatInput.value).toBe(true);
  });

  it("repro B2 — goToLast after deeplink start at chapter 1 makes chat input visible", async () => {
    // Backend mode true from first paint: load directly into a known story
    // before mounting the computed (the deeplink path).
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonRes(chapters(3)))));

    const nav = await getNav();
    await nav.loadFromBackend("s1", "story1", 1);

    // Mount the computed AFTER backend mode is true.
    const showChatInput = makeShowChatInputComputed(nav);

    expect(showChatInput.value).toBe(false);

    nav.goToLast();

    expect(showChatInput.value).toBe(true);
  });

  it("navigating away from the last chapter hides the chat input", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonRes(chapters(5)))));

    const nav = await getNav();
    await nav.loadFromBackend("s1", "story1");
    const showChatInput = makeShowChatInputComputed(nav);

    nav.goToLast();
    expect(showChatInput.value).toBe(true);

    // navigateTo is exposed indirectly via previous(); two prevs from index 4.
    nav.previous();
    expect(nav.currentIndex.value).toBe(3);
    expect(showChatInput.value).toBe(false);
  });

  it("atomic update — no observed (chapters.length=N_new, isLastChapter incorrect) tuple during loadFromBackend transition", async () => {
    // Pre-load a 3-chapter story and land on chapter 1 (not last).
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        call += 1;
        return Promise.resolve(jsonRes(chapters(call === 1 ? 3 : 1)));
      }),
    );

    const nav = await getNav();
    await nav.loadFromBackend("seriesA", "storyA");
    expect(nav.chapters.value.length).toBe(3);
    expect(nav.currentIndex.value).toBe(0);

    // Now install a default-flush watcher BEFORE the transition and record
    // every observed tuple. A correct atomic update produces only the
    // pre-transition tuple and the post-transition tuple — never a tuple
    // where chapters.length=1 but isLastChapter=false (which is the bug
    // shape: stale currentIndex=0 vs new chapters.length=1 is FINE because
    // 0 IS the last index; the bad shape is chapters.length=1 with
    // currentIndex>=1 from a prior story, OR an isLastChapter=false read
    // taken between the two writes).
    const observations: Array<{
      len: number;
      idx: number;
      isLast: boolean;
    }> = [];
    watchEffect(() => {
      observations.push({
        len: nav.chapters.value.length,
        idx: nav.currentIndex.value,
        isLast: nav.isLastChapter.value,
      });
    });

    // Transition to a single-chapter story.
    await nav.loadFromBackend("seriesB", "storyB");

    // No observation may have chapters.length=1 with isLast=false.
    for (const obs of observations) {
      if (obs.len === 1) {
        expect(obs.isLast).toBe(true);
      }
    }
    // And the final state is correct.
    expect(nav.chapters.value.length).toBe(1);
    expect(nav.isLastChapter.value).toBe(true);
  });

  it("getBackendContext is reactive — computed re-fires when series/story change", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonRes(chapters(1)))));

    const nav = await getNav();

    const seenIsBackendMode: boolean[] = [];
    const ctxComputed = computed(() => nav.getBackendContext().isBackendMode);
    watchEffect(() => {
      seenIsBackendMode.push(ctxComputed.value);
    });

    expect(seenIsBackendMode).toEqual([false]);

    await nav.loadFromBackend("s1", "story1");

    expect(seenIsBackendMode).toContain(true);
  });

  it("atomic update — stale-high index transition (3@idx=2 → 1-chapter) never exposes (len=1, isLast=false)", async () => {
    // Strongest atomicity probe: the OLD bug shape was `chapters.value = loaded;
    // currentIndex.value = idx;` so a transition from (len=3, idx=2) to
    // (len=1, idx=0) would briefly expose (len=1, idx=2) → isLastChapter=false
    // against a single-chapter story. The new write order (index first, then
    // chapters) makes the intermediate (len=3, idx=0) → already isLast=false
    // pre-transition, then (len=1, idx=0) → isLast=true post-transition.
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        call += 1;
        return Promise.resolve(jsonRes(chapters(call === 1 ? 3 : 1)));
      }),
    );

    const nav = await getNav();
    await nav.loadFromBackend("seriesA", "storyA");
    nav.goToLast();
    expect(nav.currentIndex.value).toBe(2);
    expect(nav.chapters.value.length).toBe(3);

    const observations: Array<{ len: number; idx: number; isLast: boolean }> = [];
    watchEffect(() => {
      observations.push({
        len: nav.chapters.value.length,
        idx: nav.currentIndex.value,
        isLast: nav.isLastChapter.value,
      });
    });

    await nav.loadFromBackend("seriesB", "storyB");

    // Critical: any observation where len === 1 MUST have isLast === true.
    // The pre-fix bug would have produced (len=1, idx=2, isLast=false).
    for (const obs of observations) {
      if (obs.len === 1) {
        expect(obs.isLast).toBe(true);
        expect(obs.idx).toBe(0);
      }
    }
    expect(nav.chapters.value.length).toBe(1);
    expect(nav.isLastChapter.value).toBe(true);
  });

  it("syncRoute:false direct load — already-mounted predicate updates without router navigation", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonRes(chapters(1)))));

    const nav = await getNav();
    const showChatInput = makeShowChatInputComputed(nav);

    expect(showChatInput.value).toBe(false);

    await nav.loadFromBackend("s1", "story1", undefined, { syncRoute: false });

    expect(showChatInput.value).toBe(true);
  });
});

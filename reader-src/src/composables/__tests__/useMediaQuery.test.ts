import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { useMediaQuery } from "@/composables/useMediaQuery";

type ChangeListener = (event: { matches: boolean }) => void;

interface MockMql {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _listeners: Set<ChangeListener>;
  _fire: (matches: boolean) => void;
}

function createMockMql(initial: boolean): MockMql {
  const listeners = new Set<ChangeListener>();
  const mql: MockMql = {
    matches: initial,
    _listeners: listeners,
    addEventListener: vi.fn((_event: string, cb: ChangeListener) => {
      listeners.add(cb);
    }),
    removeEventListener: vi.fn((_event: string, cb: ChangeListener) => {
      listeners.delete(cb);
    }),
    _fire(matches: boolean) {
      this.matches = matches;
      for (const cb of listeners) cb({ matches });
    },
  };
  return mql;
}

describe("useMediaQuery", () => {
  let mql: MockMql;
  let matchMediaSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mql = createMockMql(false);
    matchMediaSpy = vi.fn(() => mql);
    vi.stubGlobal("matchMedia", matchMediaSpy);
    (window as unknown as { matchMedia: typeof matchMediaSpy }).matchMedia = matchMediaSpy;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mountWithComposable(query: string) {
    let exposed: { matches: ReturnType<typeof useMediaQuery> } | null = null;
    const Test = defineComponent({
      setup() {
        const matches = useMediaQuery(query);
        exposed = { matches };
        return () => h("div", String(matches.value));
      },
    });
    const wrapper = mount(Test);
    return { wrapper, get exposed() { return exposed!; } };
  }

  it("returns the initial matchMedia value", () => {
    mql.matches = true;
    const { exposed } = mountWithComposable("(max-width: 767px)");
    expect(exposed.matches.value).toBe(true);
    expect(matchMediaSpy).toHaveBeenCalledWith("(max-width: 767px)");
  });

  it("updates reactively when the media query state changes", async () => {
    const { exposed } = mountWithComposable("(max-width: 767px)");
    expect(exposed.matches.value).toBe(false);
    mql._fire(true);
    await nextTick();
    expect(exposed.matches.value).toBe(true);
    mql._fire(false);
    await nextTick();
    expect(exposed.matches.value).toBe(false);
  });

  it("registers a change listener on mount and removes it on unmount", () => {
    const { wrapper } = mountWithComposable("(max-width: 767px)");
    expect(mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(mql.removeEventListener).not.toHaveBeenCalled();
    wrapper.unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(mql._listeners.size).toBe(0);
  });
});

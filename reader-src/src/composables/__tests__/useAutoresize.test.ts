// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useAutoresize } from "@/composables/useAutoresize";

interface HarnessOptions {
  body?: string;
  minLines?: number;
  scrollHeight?: number;
  borderTop?: string;
  borderBottom?: string;
  paddingTop?: string;
  paddingBottom?: string;
  lineHeight?: string;
  fontSize?: string;
  boxSizing?: "border-box" | "content-box";
  watch?: boolean;
}

/**
 * Mounts a small Vue component containing a textarea bound to `useAutoresize`.
 * The textarea's `scrollHeight` is forced via Object.defineProperty because
 * happy-dom does not lay out text. Inline styles drive `getComputedStyle()`
 * so that line-height / padding / borders / box-sizing produce stable numbers.
 */
function mountHarness(opts: HarnessOptions = {}) {
  const body = ref(opts.body ?? "x");
  const scrollHeightVal = ref(opts.scrollHeight ?? 0);
  const Comp = defineComponent({
    setup(_, { expose }) {
      const taRef = ref<HTMLTextAreaElement | null>(null);
      const { recompute } = useAutoresize(taRef, {
        minLines: opts.minLines ?? 3,
        ...(opts.watch ? { watch: () => body.value } : {}),
      });
      expose({ taRef, recompute, body, scrollHeightVal });
      return () =>
        h("textarea", {
          ref: taRef,
          value: body.value,
          style: {
            boxSizing: opts.boxSizing ?? "border-box",
            lineHeight: opts.lineHeight ?? "20px",
            fontSize: opts.fontSize ?? "16px",
            paddingTop: opts.paddingTop ?? "8px",
            paddingBottom: opts.paddingBottom ?? "8px",
            borderTopStyle: "solid",
            borderBottomStyle: "solid",
            borderTopWidth: opts.borderTop ?? "1px",
            borderBottomWidth: opts.borderBottom ?? "1px",
          },
        });
    },
  });
  const wrapper = mount(Comp, { attachTo: document.body });
  const ta = wrapper.find("textarea").element as HTMLTextAreaElement;
  // Force scrollHeight (happy-dom returns 0 for un-laid-out text).
  Object.defineProperty(ta, "scrollHeight", {
    configurable: true,
    get: () => scrollHeightVal.value,
  });
  const exposed = wrapper.vm as unknown as {
    taRef: HTMLTextAreaElement | null;
    recompute: () => void;
    body: string;
    scrollHeightVal: number;
    setBody: (v: string) => void;
    setScrollHeight: (v: number) => void;
  };
  return { wrapper, ta, exposed, refs: { body, scrollHeightVal } };
}

async function flushFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe("useAutoresize", () => {
  it("respects the three-line floor on a tiny body", async () => {
    const { ta, exposed } = mountHarness({
      body: "hi",
      scrollHeight: 30,
      lineHeight: "20px",
      paddingTop: "8px",
      paddingBottom: "8px",
      borderTop: "1px",
      borderBottom: "1px",
    });
    exposed.recompute();
    await flushFrame();
    // Floor (border-box) = 3*20 + 8+8 + 1+1 = 78px; measured = 30 + 1+1 = 32px
    expect(parseFloat(ta.style.height)).toBe(78);
  });

  it("grows past the floor on a long body", async () => {
    const { ta, exposed } = mountHarness({
      body: "many lines",
      scrollHeight: 500,
      lineHeight: "20px",
      paddingTop: "8px",
      paddingBottom: "8px",
      borderTop: "1px",
      borderBottom: "1px",
    });
    exposed.recompute();
    await flushFrame();
    // Measured (border-box) = 500 + 1 + 1 = 502; floor = 78 → 502 wins
    expect(parseFloat(ta.style.height)).toBe(502);
  });

  it("re-fits when the watched value changes", async () => {
    const { ta, exposed, refs } = mountHarness({
      body: "small",
      scrollHeight: 30,
      watch: true,
    });
    await flushFrame();
    expect(parseFloat(ta.style.height)).toBe(78);
    refs.scrollHeightVal.value = 400;
    refs.body.value = "big paste";
    await nextTick();
    await flushFrame();
    expect(parseFloat(ta.style.height)).toBe(402);
    void exposed;
  });

  it("treats a null ref as a no-op", async () => {
    // Build a harness where the textarea is conditionally rendered absent.
    const Comp = defineComponent({
      setup(_, { expose }) {
        const taRef = ref<HTMLTextAreaElement | null>(null);
        const { recompute } = useAutoresize(taRef, { minLines: 3 });
        expose({ recompute });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    const exposed = wrapper.vm as unknown as { recompute: () => void };
    expect(() => exposed.recompute()).not.toThrow();
    await flushFrame();
    wrapper.unmount();
  });

  it("disconnects the ResizeObserver on unmount", async () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    class FakeRO {
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", FakeRO);
    const { wrapper } = mountHarness({ body: "x" });
    expect(observe).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("falls back to 1.2 × font-size when line-height is normal", async () => {
    const { ta, exposed } = mountHarness({
      body: "x",
      scrollHeight: 10,
      lineHeight: "normal",
      fontSize: "20px",
      paddingTop: "0px",
      paddingBottom: "0px",
      borderTop: "0px",
      borderBottom: "0px",
    });
    exposed.recompute();
    await flushFrame();
    // Floor = 1.2 * 20 * 3 = 72; measured = 10 → floor wins
    expect(parseFloat(ta.style.height)).toBe(72);
  });

  it("border-box accounting includes both borders so content fits", async () => {
    const { ta, exposed } = mountHarness({
      body: "x",
      scrollHeight: 100,
      lineHeight: "20px",
      paddingTop: "0px",
      paddingBottom: "0px",
      borderTop: "2px",
      borderBottom: "2px",
      boxSizing: "border-box",
    });
    exposed.recompute();
    await flushFrame();
    // measured = 100 + 2 + 2 = 104; floor = 60 + 0 + 4 = 64 → 104 wins
    expect(parseFloat(ta.style.height)).toBe(104);
  });

  it("content-box accounting subtracts padding so style.height is the inner box", async () => {
    const { ta, exposed } = mountHarness({
      body: "x",
      scrollHeight: 100,
      lineHeight: "20px",
      paddingTop: "10px",
      paddingBottom: "10px",
      borderTop: "0px",
      borderBottom: "0px",
      boxSizing: "content-box",
    });
    exposed.recompute();
    await flushFrame();
    // measured (content-box) = 100 - 10 - 10 = 80; floor (content-box) = 60 → 80 wins
    expect(parseFloat(ta.style.height)).toBe(80);
  });

  it("content-box floor uses just lineHeight*minLines (no padding double-count)", async () => {
    const { ta, exposed } = mountHarness({
      body: "x",
      scrollHeight: 30,
      lineHeight: "20px",
      paddingTop: "10px",
      paddingBottom: "10px",
      borderTop: "0px",
      borderBottom: "0px",
      boxSizing: "content-box",
    });
    exposed.recompute();
    await flushFrame();
    // measured = 30 - 10 - 10 = 10; floor (content-box) = 60 → floor wins
    // (NOT 80 — that would double-count padding into the content-box height.)
    expect(parseFloat(ta.style.height)).toBe(60);
  });

  it("cancels a pending RAF when the component unmounts", async () => {
    const { wrapper, ta, exposed } = mountHarness({
      body: "x",
      scrollHeight: 10,
    });
    // Wait for the on-mount recompute to flush so we can spy cleanly.
    await flushFrame();
    let writeCount = 0;
    const heightDescriptor: PropertyDescriptor = {
      configurable: true,
      set(_v: string) {
        writeCount += 1;
      },
      get() {
        return "";
      },
    };
    Object.defineProperty(ta.style, "height", heightDescriptor);
    exposed.recompute();
    wrapper.unmount();
    await flushFrame();
    expect(writeCount).toBe(0);
  });

  it("re-attaches the ResizeObserver when the bound element changes", async () => {
    const observeFn = vi.fn();
    const disconnectFn = vi.fn();
    class FakeRO {
      observe = observeFn;
      disconnect = disconnectFn;
      unobserve = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", FakeRO);
    const show = ref(true);
    const Comp = defineComponent({
      setup() {
        const taRef = ref<HTMLTextAreaElement | null>(null);
        useAutoresize(taRef, { minLines: 3 });
        return () => (show.value ? h("textarea", { ref: taRef }) : h("div"));
      },
    });
    const wrapper = mount(Comp, { attachTo: document.body });
    await wrapper.vm.$nextTick();
    expect(observeFn).toHaveBeenCalledTimes(1);
    show.value = false;
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(disconnectFn).toHaveBeenCalledTimes(1);
    show.value = true;
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(observeFn).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it("ignores height-only ResizeObserver entries (preserves manual resize)", async () => {
    let roCallback: ((entries: ResizeObserverEntry[]) => void) | null = null;
    class FakeRO {
      constructor(cb: (entries: ResizeObserverEntry[]) => void) {
        roCallback = cb;
      }
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", FakeRO);
    const { ta, exposed } = mountHarness({
      body: "x",
      scrollHeight: 30,
      lineHeight: "20px",
      paddingTop: "0px",
      paddingBottom: "0px",
      borderTop: "0px",
      borderBottom: "0px",
    });
    void exposed;
    await flushFrame();
    // First width-bearing entry initialises lastObservedWidth.
    roCallback!([{ contentBoxSize: [{ inlineSize: 200, blockSize: 60 }] } as unknown as ResizeObserverEntry]);
    await flushFrame();
    // Now spy on style.height writes.
    let writes = 0;
    const real = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta.style), "height");
    Object.defineProperty(ta.style, "height", {
      configurable: true,
      set(v: string) {
        writes += 1;
        real?.set?.call(ta.style, v);
      },
      get() {
        return real?.get?.call(ta.style) ?? "";
      },
    });
    // Height-only change with the same width MUST be ignored.
    roCallback!([{ contentBoxSize: [{ inlineSize: 200, blockSize: 999 }] } as unknown as ResizeObserverEntry]);
    await flushFrame();
    expect(writes).toBe(0);
    // Width change DOES recompute.
    roCallback!([{ contentBoxSize: [{ inlineSize: 220, blockSize: 60 }] } as unknown as ResizeObserverEntry]);
    await flushFrame();
    expect(writes).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });
});

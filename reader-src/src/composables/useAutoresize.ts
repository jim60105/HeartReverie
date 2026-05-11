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

import { onBeforeUnmount, onMounted, watch as vueWatch } from "vue";
import type { Ref } from "vue";

export interface UseAutoresizeOptions {
  /** Minimum visible text rows. Defaults to 3. */
  minLines?: number;
  /**
   * Optional reactive getter. When provided, `recompute()` is invoked on mount
   * and on every change (post-flush). Omit to use only manual triggers.
   */
  watch?: () => unknown;
}

export interface UseAutoresizeReturn {
  /** Schedule a single height recomputation in the next animation frame. */
  recompute: () => void;
}

const DEFAULT_LINE_HEIGHT_MULTIPLIER = 1.2;

function parsePxOr(value: string, fallback: number): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveLineHeightPx(cs: CSSStyleDeclaration): number {
  const lh = cs.lineHeight;
  if (lh && lh !== "normal") {
    const n = parseFloat(lh);
    if (Number.isFinite(n)) return n;
  }
  const fontSize = parsePxOr(cs.fontSize, 16);
  return fontSize * DEFAULT_LINE_HEIGHT_MULTIPLIER;
}

/**
 * Computes the floor height (in px) for `minLines` rows, accounting for
 * vertical padding and (when box-sizing is border-box) vertical borders.
 *
 * The result is sized to the same coordinate system the consumer will write
 * into `style.height`, which is interpreted via `box-sizing`:
 *   - border-box: outer height (content + padding + borders)
 *   - content-box: inner height only (just content)
 */
function computeFloorPx(el: HTMLTextAreaElement, minLines: number): number {
  const cs = getComputedStyle(el);
  const lineHeight = resolveLineHeightPx(cs);
  const content = lineHeight * minLines;
  if (cs.boxSizing === "border-box") {
    const paddingTop = parsePxOr(cs.paddingTop, 0);
    const paddingBottom = parsePxOr(cs.paddingBottom, 0);
    const borderTop = parsePxOr(cs.borderTopWidth, 0);
    const borderBottom = parsePxOr(cs.borderBottomWidth, 0);
    return content + paddingTop + paddingBottom + borderTop + borderBottom;
  }
  return content;
}

/**
 * Returns the height value to assign to `style.height` so that the element
 * exactly fits its content without an internal scrollbar.
 *
 * `scrollHeight` always returns content + padding (never borders). `style.height`
 * is interpreted via `box-sizing`. So for `border-box` we must add the borders
 * back in; for `content-box` we must subtract padding back out.
 */
function computeContentPx(el: HTMLTextAreaElement): number {
  const cs = getComputedStyle(el);
  const sh = el.scrollHeight;
  if (cs.boxSizing === "border-box") {
    const borderTop = parsePxOr(cs.borderTopWidth, 0);
    const borderBottom = parsePxOr(cs.borderBottomWidth, 0);
    return sh + borderTop + borderBottom;
  }
  const paddingTop = parsePxOr(cs.paddingTop, 0);
  const paddingBottom = parsePxOr(cs.paddingBottom, 0);
  return sh - paddingTop - paddingBottom;
}

export function useAutoresize(
  elRef: Ref<HTMLTextAreaElement | null | undefined>,
  options: UseAutoresizeOptions = {},
): UseAutoresizeReturn {
  const minLines = options.minLines ?? 3;
  let isUnmounted = false;
  let pendingRaf: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let observedTarget: Element | null = null;
  // Track the last observed width so height-only parent changes (e.g. the user
  // dragging the textarea via `resize: vertical`) do NOT trigger a recompute
  // that would overwrite their manual height.
  let lastObservedWidth = -1;

  const raf: (cb: FrameRequestCallback) => number = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
  const caf: (id: number) => void = typeof cancelAnimationFrame === "function"
    ? cancelAnimationFrame
    : ((id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>));

  function performRecompute(): void {
    pendingRaf = null;
    if (isUnmounted) return;
    const el = elRef.value;
    if (!el) return;
    // Reset height so scrollHeight reflects the actual required content height.
    el.style.height = "auto";
    const measured = computeContentPx(el);
    const floor = computeFloorPx(el, minLines);
    const next = Math.max(measured, floor);
    el.style.height = `${next}px`;
  }

  function recompute(): void {
    if (isUnmounted) return;
    if (pendingRaf !== null) return;
    pendingRaf = raf(performRecompute);
  }

  function attachObserver(el: HTMLTextAreaElement): void {
    if (typeof ResizeObserver === "undefined") return;
    detachObserver();
    resizeObserver = new ResizeObserver((entries) => {
      // Only recompute when the *width* changes. A height-only change is most
      // commonly the result of our own `style.height` write or the user's
      // manual drag on a textarea with `resize: vertical`; recomputing in
      // either case would be either redundant or hostile.
      const entry = entries[0];
      let width = -1;
      if (entry) {
        const sizes = entry.contentBoxSize;
        if (sizes && sizes.length > 0) {
          width = sizes[0]!.inlineSize;
        } else {
          width = entry.contentRect.width;
        }
      }
      if (width !== lastObservedWidth) {
        lastObservedWidth = width;
        recompute();
      }
    });
    // Observe the element's containing block (parentElement) so width changes
    // from sidebar toggles, theme swaps, etc. trigger a re-fit. Fallback to the
    // element itself if there is no parent (e.g. detached test mount).
    observedTarget = el.parentElement ?? el;
    resizeObserver.observe(observedTarget);
  }

  function detachObserver(): void {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
      observedTarget = null;
      lastObservedWidth = -1;
    }
  }

  onMounted(() => {
    // Fonts may load after mount, changing line metrics — recompute once when ready.
    const fontsReady = (document as unknown as { fonts?: { ready?: Promise<unknown> } })
      .fonts?.ready;
    if (fontsReady && typeof fontsReady.then === "function") {
      fontsReady.then(() => {
        if (isUnmounted) return;
        recompute();
      }).catch(() => { /* font loading failure is non-fatal */ });
    }
  });

  // (Re-)attach the observer whenever the bound element changes. `immediate: true`
  // covers the initial mount (when the template ref resolves from null to the
  // <textarea>) so onMounted does not need a second attach call.
  vueWatch(
    elRef,
    (next, prev) => {
      if (isUnmounted) return;
      if (next === prev) return;
      if (next) {
        attachObserver(next);
        recompute();
      } else {
        detachObserver();
      }
    },
    { immediate: true, flush: "sync" },
  );

  if (options.watch) {
    vueWatch(options.watch, () => recompute(), { flush: "post" });
  }

  onBeforeUnmount(() => {
    isUnmounted = true;
    detachObserver();
    if (pendingRaf !== null) {
      caf(pendingRaf);
      pendingRaf = null;
    }
  });

  return { recompute };
}

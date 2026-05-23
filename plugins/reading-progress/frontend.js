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

// Plugin: reading-progress — Multi-device reading progress sync
// (chapter index + scroll ratio + W3C Text Fragment anchor)

'use strict';

import { createPluginLogger, getPluginSettings } from '../_shared/utils.js';

// ---------------------------------------------------------------------------
// Helpers (module-level, stateless)
// ---------------------------------------------------------------------------

function getPassphrase() {
  return sessionStorage.getItem('passphrase') || '';
}

function getClientId() {
  let id = localStorage.getItem('reading-progress-client-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('reading-progress-client-id', id);
  }
  return id;
}

/**
 * Resolve the actual scroll container.
 * ctx.container (.chapter-content) has overflow:visible — the document scrolls.
 * We use document.scrollingElement for scroll ratio, but ctx.container for
 * text-node anchor lookup (since that's where chapter content lives).
 */
function getScrollElement() {
  return document.scrollingElement || document.documentElement;
}

function computeScrollRatio() {
  const scrollEl = getScrollElement();
  return scrollEl.scrollTop / Math.max(1, scrollEl.scrollHeight - window.innerHeight);
}

function clampRatio(r) {
  return Math.min(1, Math.max(0, r));
}

function navigateToChapter(series, story, chapterNumber) {
  window.location.href = `/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapter/${chapterNumber}`;
}

function handleCrossChapter(remoteChapterIndex, series, story, confirmRemoteJump) {
  const remoteChapterNumber = remoteChapterIndex + 1;
  if (confirmRemoteJump) {
    showConflictDialog(remoteChapterNumber, series, story, null);
  } else {
    navigateToChapter(series, story, remoteChapterNumber);
  }
}

function makeProgressEntry(identity, scrollRatio, selectionAnchor) {
  return {
    chapterIndex: identity.chapterIndex,
    scrollRatio,
    lastReadAt: new Date().toISOString(),
    selectionAnchor: selectionAnchor ?? null,
    clientId: getClientId(),
    series: identity.series,
    story: identity.story,
  };
}

/**
 * Register an idempotent chapter:dom:ready handler that guards against
 * repeated dispatches for the same (container, chapterIndex) pair (e.g.,
 * during LLM streaming). Also wires up matching chapter:dom:dispose cleanup
 * and clears currentIdentity on story:switch.
 *
 * @param {object} hooks - Plugin hooks API.
 * @param {(ctx: object, container: HTMLElement, getIdentity: () => object | null) => (() => void) | void} onFreshChapter
 *        Called only once per (container, chapterIndex). Returns a cleanup function
 *        to run on chapter:dom:dispose (or when a new chapter reuses the container).
 * @returns {{
 *   getCurrentIdentity: () => object | null,
 *   setCurrentIdentity: (next: object | null) => void,
 * }}
 */
function registerIdempotentChapterReady(hooks, onFreshChapter) {
  const containerState = new WeakMap();
  let currentIdentity = null;

  hooks.register('story:switch', () => {
    currentIdentity = null;
  });

  hooks.register('chapter:dom:ready', (ctx) => {
    if (!ctx.series || !ctx.story) return;
    const container = ctx.container;
    if (!(container instanceof HTMLElement)) return;

    const newIdentity = {
      series: ctx.series,
      story: ctx.story,
      chapterIndex: ctx.chapterIndex,
    };

    // Idempotency guard: skip re-setup if the same (container, series, story,
    // chapterIndex) tuple fires again (e.g., chapter:dom:ready dispatched on
    // every streamed chunk). Always refresh currentIdentity in case ctx fields
    // rotated. Match on full identity so switching stories that reuse the same
    // container still triggers fresh setup.
    const existing = containerState.get(container);
    if (
      existing &&
      existing.series === ctx.series &&
      existing.story === ctx.story &&
      existing.chapterIndex === ctx.chapterIndex
    ) {
      currentIdentity = newIdentity;
      return;
    }

    // Different identity on same container, or stale state → run prior cleanup.
    if (existing) existing.cleanup();
    currentIdentity = newIdentity;

    const cleanup = onFreshChapter(ctx, container, () => currentIdentity) || (() => {});
    containerState.set(container, {
      series: ctx.series,
      story: ctx.story,
      chapterIndex: ctx.chapterIndex,
      cleanup,
    });
  }, 50);

  hooks.register('chapter:dom:dispose', (ctx) => {
    const container = ctx.container;
    if (!(container instanceof HTMLElement)) return;
    const state = containerState.get(container);
    if (state) {
      state.cleanup();
      containerState.delete(container);
    }
  }, 50);

  return {
    getCurrentIdentity: () => currentIdentity,
    setCurrentIdentity: (next) => { currentIdentity = next; },
  };
}

// ---------------------------------------------------------------------------
// 4.2 — Throttled sync helper
// ---------------------------------------------------------------------------

function makeThrottledSync(waitMs, putFn) {
  let lastInvoke = 0;
  let pending = null;
  let timer = null;

  function invoke(entry) {
    lastInvoke = Date.now();
    pending = null;
    putFn(entry);
  }

  return {
    push(entry) {
      pending = entry;
      const remaining = waitMs - (Date.now() - lastInvoke);
      if (remaining <= 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        invoke(entry);
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          if (pending) invoke(pending);
        }, remaining);
      }
    },
    flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (pending) invoke(pending);
    },
    cancel() {
      if (timer) { clearTimeout(timer); timer = null; }
      pending = null;
    },
  };
}

// ---------------------------------------------------------------------------
// 5.2 — Text Fragment anchor helpers
// ---------------------------------------------------------------------------

function captureTextFragmentAnchor(container) {
  const scrollEl = getScrollElement();
  const viewportTop = scrollEl.scrollTop;
  const viewportBottom = viewportTop + window.innerHeight;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const range = document.createRange();
    range.selectNode(node);
    const rect = range.getBoundingClientRect();
    // Convert viewport-relative rect to absolute document position
    const absTop = rect.top + scrollEl.scrollTop;
    const absBottom = absTop + rect.height;

    if (absBottom < viewportTop) continue;
    if (absTop > viewportBottom) break;

    const text = (node.textContent || '').trim();
    if (text.length < 4) continue;

    const anchor = { textStart: text.slice(0, 32) };

    // Capture prefix from preceding text node for disambiguation
    const prev = node.previousSibling;
    if (prev && prev.nodeType === Node.TEXT_NODE) {
      const prevText = (prev.textContent || '').trim();
      if (prevText.length > 0) {
        anchor.prefix = prevText.slice(-32);
      }
    }
    return anchor;
  }
  return null;
}

function getPreviousText(container, targetNode) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let result = '';
  let node;
  while ((node = walker.nextNode())) {
    if (node === targetNode) break;
    result += node.textContent || '';
  }
  return result;
}

function findTextFragmentAnchor(container, anchor) {
  if (!anchor || !anchor.textStart) return null;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const candidates = [];
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent || '';
    const idx = text.indexOf(anchor.textStart);
    if (idx === -1) continue;
    candidates.push({ node, offset: idx });
  }
  if (candidates.length === 0) return null;

  // Disambiguate with prefix
  if (anchor.prefix && candidates.length > 1) {
    const filtered = candidates.filter((c) => {
      const prev = getPreviousText(container, c.node);
      return prev.endsWith(anchor.prefix);
    });
    if (filtered.length > 0) return getRelativeTop(container, filtered[0].node);
  }
  return getRelativeTop(container, candidates[0].node);
}

function getRelativeTop(container, node) {
  const range = document.createRange();
  range.selectNode(node);
  const rect = range.getBoundingClientRect();
  const scrollEl = getScrollElement();
  // Return absolute document position (usable for scrollEl.scrollTop)
  return rect.top + scrollEl.scrollTop;
}

// ---------------------------------------------------------------------------
// 6.2 — Conflict dialog
// ---------------------------------------------------------------------------

function showConflictDialog(remoteChapterNumber, series, story, onDismiss) {
  const slot = document.getElementById('plugin-panel-slot');
  if (!slot) return;

  // Remove any existing dialog
  const existing = slot.querySelector('.reading-progress-conflict-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.className = 'reading-progress-conflict-dialog';
  dialog.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'right:20px',
    'background:#1e1e2e',
    'color:#cdd6f4',
    'border:1px solid #585b70',
    'border-radius:8px',
    'padding:16px 20px',
    'max-width:320px',
    'box-shadow:0 4px 12px rgba(0,0,0,0.4)',
    'font-size:14px',
    'z-index:100',
    'pointer-events:auto',
  ].join(';');

  const msg = document.createElement('p');
  msg.style.cssText = 'margin:0 0 12px 0;line-height:1.5';
  msg.textContent = `您在另一裝置讀到第 ${remoteChapterNumber} 章，要跳過去嗎？`;
  dialog.appendChild(msg);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';

  const btnBase = 'border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-size:13px';

  const jumpBtn = document.createElement('button');
  jumpBtn.setAttribute('data-action', 'jump');
  jumpBtn.style.cssText = `${btnBase};background:#89b4fa;color:#1e1e2e`;
  jumpBtn.textContent = '跳過去';

  const stayBtn = document.createElement('button');
  stayBtn.setAttribute('data-action', 'stay');
  stayBtn.style.cssText = `${btnBase};background:#45475a;color:#cdd6f4`;
  stayBtn.textContent = '留在這裡';

  jumpBtn.onclick = () => {
    dialog.remove();
    navigateToChapter(series, story, remoteChapterNumber);
  };
  stayBtn.onclick = () => {
    dialog.remove();
    if (onDismiss) onDismiss();
  };

  btnRow.appendChild(jumpBtn);
  btnRow.appendChild(stayBtn);
  dialog.appendChild(btnRow);
  slot.appendChild(dialog);
}

function showScrollHint(onDismiss) {
  const slot = document.getElementById('plugin-panel-slot');
  if (!slot) return;

  const existing = slot.querySelector('.reading-progress-scroll-hint');
  if (existing) existing.remove();

  const hint = document.createElement('div');
  hint.className = 'reading-progress-scroll-hint';
  hint.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'right:20px',
    'background:#313244',
    'color:#a6adc8',
    'border:1px solid #45475a',
    'border-radius:6px',
    'padding:10px 16px',
    'font-size:13px',
    'z-index:100',
    'pointer-events:auto',
    'cursor:pointer',
  ].join(';');
  hint.textContent = '另一裝置的閱讀位置已更新';
  hint.onclick = () => {
    hint.remove();
    if (onDismiss) onDismiss();
  };

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    if (hint.parentNode) hint.remove();
  }, 4000);

  slot.appendChild(hint);
}

// ---------------------------------------------------------------------------
// 5.1, 5.3, 5.4 — Scroll restoration
// ---------------------------------------------------------------------------

function restoreScroll(container, saved, settings, chapters, currentIdentity, putProgressFn) {
  if (!saved || !container) return;

  // retainDays expiry check
  const retainDays = settings.retainDays ?? 90;
  if (saved.lastReadAt) {
    const age = (Date.now() - new Date(saved.lastReadAt).getTime()) / (1000 * 60 * 60 * 24);
    if (age > retainDays) return;
  }

  // Identity guard
  if (!currentIdentity) return;

  // 5.4 — Chapter out-of-bounds clamping
  let targetIndex = saved.chapterIndex;
  if (chapters.length > 0 && targetIndex >= chapters.length) {
    targetIndex = chapters.length - 1;
    // Fire-and-forget corrected PUT
    queueMicrotask(() => {
      putProgressFn(makeProgressEntry({ ...currentIdentity, chapterIndex: targetIndex }, 1, null));
    });
  }

  // Only restore if we are on the matching chapter
  if (targetIndex !== currentIdentity.chapterIndex) return;

  const scrollEl = getScrollElement();

  // Try text fragment anchor first, then scrollRatio fallback
  let targetTop = null;
  if (saved.selectionAnchor) {
    targetTop = findTextFragmentAnchor(container, saved.selectionAnchor);
  }

  function applyScroll() {
    if (targetTop !== null) {
      scrollEl.scrollTop = targetTop;
    } else if (typeof saved.scrollRatio === 'number') {
      const maxScroll = Math.max(1, scrollEl.scrollHeight - window.innerHeight);
      scrollEl.scrollTop = saved.scrollRatio * maxScroll;
    }
  }

  // Stabilization: wait for layout, images, fonts, with 1.5s max
  let cancelled = false;
  let stabilizeTimer = null;
  let observer = null;

  function cancel() {
    cancelled = true;
    cleanup();
  }

  function cleanup() {
    if (stabilizeTimer) { clearTimeout(stabilizeTimer); stabilizeTimer = null; }
    if (observer) { observer.disconnect(); observer = null; }
    window.removeEventListener('scroll', cancelOnUserScroll);
  }

  function cancelOnUserScroll() {
    cancel();
  }

  // Cancel if user scrolls (once) — listen on window since that's what scrolls
  window.addEventListener('scroll', cancelOnUserScroll, { once: true, passive: true });

  // Initial apply
  applyScroll();

  // ResizeObserver for layout shifts (observe the content container)
  let resizeCount = 0;
  try {
    observer = new ResizeObserver(() => {
      if (cancelled) return;
      resizeCount++;
      applyScroll();
    });
    observer.observe(container);
  } catch { /* ResizeObserver not available */ }

  // Wait for images
  const images = container.querySelectorAll('img');
  for (const img of images) {
    if (!img.complete) {
      img.addEventListener('load', () => {
        if (!cancelled) applyScroll();
      }, { once: true });
    }
  }

  // Wait for fonts
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (!cancelled) applyScroll();
    });
  }

  // 1.5s max stabilization window
  stabilizeTimer = setTimeout(cleanup, 1500);
}

// ---------------------------------------------------------------------------
// 4.1 — Local-only mode (storageBackend === 'local')
// ---------------------------------------------------------------------------

function initLocalMode(hooks, settings) {
  function storageKey(series, story) {
    return `reading-progress:${series}/${story}`;
  }

  registerIdempotentChapterReady(hooks, (ctx, _container, getIdentity) => {
    // Restore from localStorage (best-effort; ignore corrupt data)
    try {
      const raw = localStorage.getItem(storageKey(ctx.series, ctx.story));
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.chapterIndex === ctx.chapterIndex && typeof saved.scrollRatio === 'number') {
          const scrollEl = getScrollElement();
          const maxScroll = Math.max(1, scrollEl.scrollHeight - window.innerHeight);
          scrollEl.scrollTop = saved.scrollRatio * maxScroll;
        }
      }
    } catch { /* corrupt data */ }

    function onScroll() {
      const identity = getIdentity();
      if (!identity) return;
      try {
        localStorage.setItem(storageKey(identity.series, identity.story), JSON.stringify({
          chapterIndex: identity.chapterIndex,
          scrollRatio: clampRatio(computeScrollRatio()),
          lastReadAt: new Date().toISOString(),
        }));
      } catch { /* storage full */ }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });
}

// ---------------------------------------------------------------------------
// 4.1, 4.3–4.7, 5.1–5.4, 6.1–6.4 — File-backed mode
// ---------------------------------------------------------------------------

function initFileMode(hooks, context, settings) {
  const logger = createPluginLogger(context, 'reading-progress');

  // -- Core state --
  let cachedRevision = 0;
  let syncDisabled = false;
  let applyingRemote = false;
  const lastEntryByIndex = new Map();
  let chapters = [];
  let pollTimer = null;

  // Per-story-load guard for the cross-chapter prompt on `chapter:dom:ready`.
  // The cross-chapter "jump back?" dialog SHALL fire at most once per
  // story-load session — only on the first fresh `chapter:dom:ready` after a
  // `story:switch` (initial page load or opening a different story). Reset
  // happens in the `story:switch` handler below. Set synchronously in the
  // outer `onFreshChapter` body (before any `queueMicrotask` / `await`) so
  // back-to-back fresh mounts cannot both observe `false`. See spec:
  // openspec/specs/reading-progress/spec.md → "Scroll restoration on mount".
  let crossChapterCheckUsed = false;

  // Late-bound identity accessors; assigned after registerIdempotentChapterReady below.
  let getIdentity = () => null;
  let setIdentity = () => {};

  const syncIntervalMs = ((settings.syncIntervalSeconds ?? 5) * 1000);

  // -- 4.7 — Network functions --

  async function putProgress(entry, keepalive = false) {
    if (syncDisabled) return;
    try {
      const res = await fetch(
        `/api/plugins/reading-progress/progress/${encodeURIComponent(entry.series)}/${encodeURIComponent(entry.story)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Passphrase': getPassphrase(),
          },
          body: JSON.stringify({
            chapterIndex: entry.chapterIndex,
            scrollRatio: entry.scrollRatio,
            lastReadAt: entry.lastReadAt,
            selectionAnchor: entry.selectionAnchor ?? null,
            clientId: entry.clientId,
            ifMatchRevision: cachedRevision || undefined,
          }),
          keepalive,
        },
      );
      if (res.status === 401) { syncDisabled = true; return; }
      if (!res.ok) return;
      const data = await res.json();
      cachedRevision = data.revision;

      // If server reports conflict, trigger a poll to surface any remote changes
      if (data.conflict) {
        queueMicrotask(() => checkRemoteConflict());
      }
    } catch { /* network error; retry on next push */ }
  }

  async function getProgress(series, story) {
    if (syncDisabled) return null;
    try {
      const res = await fetch(
        `/api/plugins/reading-progress/progress/${encodeURIComponent(series)}/${encodeURIComponent(story)}`,
        {
          method: 'GET',
          headers: { 'X-Passphrase': getPassphrase() },
        },
      );
      if (res.status === 401) { syncDisabled = true; return null; }
      if (!res.ok) return null;
      const data = await res.json();
      return data || null;
    } catch { return null; }
  }

  // -- Throttled sync --

  function putEntry(entry) {
    queueMicrotask(() => putProgress(entry));
  }

  const throttle = makeThrottledSync(syncIntervalMs, putEntry);

  function flushAll(keepalive = false) {
    // Flush all pending entries
    for (const entry of lastEntryByIndex.values()) {
      queueMicrotask(() => putProgress(entry, keepalive));
    }
    throttle.flush();
  }

  // -- 6.1, 6.3, 6.4 — Conflict detection --

  async function checkRemoteConflict() {
    const identity = getIdentity();
    if (!identity || syncDisabled) return;
    const { series, story, chapterIndex } = identity;
    const remote = await getProgress(series, story);
    if (!remote) return;

    // Anti-echo: if revision matches, no conflict
    if (remote.revision <= cachedRevision) return;

    cachedRevision = remote.revision;

    const confirmRemoteJump = settings.confirmRemoteJump !== false;

    if (remote.chapterIndex > chapterIndex) {
      handleCrossChapter(remote.chapterIndex, series, story, confirmRemoteJump);
    } else if (remote.chapterIndex === chapterIndex) {
      // Same chapter: check scroll divergence
      const localEntry = lastEntryByIndex.get(chapterIndex);
      const localRatio = localEntry ? localEntry.scrollRatio : 0;
      if (Math.abs(remote.scrollRatio - localRatio) > 0.1) {
        showScrollHint(null);
      }
    }
    // remote.chapterIndex < chapterIndex: server behind local (e.g. just
    // generated a new chapter locally before the PUT flushed). No prompt.
  }

  // -- 4.3 — chapter:dom:ready (idempotent) --

  const idRef = registerIdempotentChapterReady(hooks, (ctx, container, getId) => {
    const trackAnchor = settings.trackSelectionAnchor !== false;

    function onScroll() {
      if (applyingRemote) {
        applyingRemote = false;
        return;
      }
      const identity = getId();
      if (!identity) return;

      const selectionAnchor = trackAnchor ? captureTextFragmentAnchor(container) : null;
      const entry = makeProgressEntry(identity, clampRatio(computeScrollRatio()), selectionAnchor);

      lastEntryByIndex.set(identity.chapterIndex, entry);
      throttle.push(entry);
    }

    window.addEventListener('scroll', onScroll, { passive: true });

    // Capture the per-story-load cross-chapter guard SYNCHRONOUSLY here, before
    // the queueMicrotask boundary. Two back-to-back fresh `chapter:dom:ready`
    // dispatches must not both observe `crossChapterCheckUsed === false`.
    // A failed/null GET still consumes the guard (desired: a transient blip on
    // page load must not defer the first-check to later in-app navigation).
    const wasFirstCheck = !crossChapterCheckUsed;
    crossChapterCheckUsed = true;

    // Fire-and-forget: GET progress and attempt restore or cross-chapter prompt
    queueMicrotask(async () => {
      const saved = await getProgress(ctx.series, ctx.story);
      if (!saved) return;
      cachedRevision = saved.revision;

      if (saved.chapterIndex !== ctx.chapterIndex) {
        if (!wasFirstCheck) {
          // Cross-chapter mismatch on a subsequent in-app fresh mount within
          // the same story-load session — suppress the prompt entirely.
          // Skip the same-chapter restore block too (chapters do not match).
          return;
        }
        // Guard against stale GET: if the user navigated / switched story
        // while this GET was in-flight, suppress the prompt for the obsolete
        // ctx. Without this check, a slow first-mount GET could fire the
        // cross-chapter dialog targeting a chapter the user already left.
        const identityX = getId();
        if (
          !identityX ||
          identityX.series !== ctx.series ||
          identityX.story !== ctx.story ||
          identityX.chapterIndex !== ctx.chapterIndex
        ) return;
        const confirmRemoteJump = settings.confirmRemoteJump !== false;
        handleCrossChapter(saved.chapterIndex, ctx.series, ctx.story, confirmRemoteJump);
        return;
      }

      // Same chapter: restore scroll position. Guard against stale navigation
      // (story switched while GET was in-flight); only restore if the latest
      // identity still matches the ctx that scheduled this fetch.
      const identity = getId();
      if (
        !identity ||
        identity.series !== ctx.series ||
        identity.story !== ctx.story ||
        identity.chapterIndex !== ctx.chapterIndex
      ) return;

      applyingRemote = true;
      restoreScroll(
        container,
        saved,
        settings,
        chapters,
        identity,
        (corrected) => putProgress(corrected),
      );
    });

    return () => window.removeEventListener('scroll', onScroll);
  });
  getIdentity = idRef.getCurrentIdentity;
  setIdentity = idRef.setCurrentIdentity;

  // -- 4.4 — chapter:change --

  hooks.register('chapter:change', (ctx) => {
    if (ctx.previousIndex !== null && ctx.previousIndex !== undefined && ctx.previousIndex !== ctx.index) {
      throttle.flush();
    }
    const identity = getIdentity();
    if (identity) {
      setIdentity({ ...identity, chapterIndex: ctx.index });
    }
  }, 50);

  // -- 4.5 — chapter:dom:dispose (throttle flush; helper handles container cleanup) --

  hooks.register('chapter:dom:dispose', (ctx) => {
    if (lastEntryByIndex.has(ctx.chapterIndex)) {
      throttle.flush();
    }
    lastEntryByIndex.delete(ctx.chapterIndex);
  }, 50);

  // -- story:switch (helper clears identity; reset mode-specific state) --

  hooks.register('story:switch', (ctx) => {
    flushAll();
    throttle.cancel();
    lastEntryByIndex.clear();
    cachedRevision = 0;
    chapters = Array.isArray(ctx.chapters) ? ctx.chapters : [];
    // Reset per-story-load cross-chapter prompt guard so the next fresh
    // `chapter:dom:ready` for the newly-opened story can prompt once.
    crossChapterCheckUsed = false;
  }, 50);

  // -- 4.6 — Visibility / lifecycle --

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      flushAll(true);
    } else if (document.visibilityState === 'visible') {
      if (settings.pollOnFocus !== false) {
        queueMicrotask(() => checkRemoteConflict());
      }
    }
  }

  function onPageHide() {
    flushAll(true);
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);

  // -- 6.4 — Periodic polling --

  const pollIntervalMs = settings.pollIntervalMs ?? 0;
  if (pollIntervalMs > 0) {
    pollTimer = setInterval(() => {
      queueMicrotask(() => checkRemoteConflict());
    }, pollIntervalMs);
  }

  // -- Cleanup on story:switch already handles most state;
  //    global listeners remain for the plugin lifetime. --
}

// ---------------------------------------------------------------------------
// 7.1–7.2 — Import helpers (exposed as utilities for future settings UI)
// ---------------------------------------------------------------------------

/**
 * Collect all reading-progress entries from localStorage.
 * @returns {Array<{ series: string, story: string, chapterIndex: number, scrollRatio: number, lastReadAt: string }>}
 */
export function collectLocalEntries() {
  const entries = [];
  const prefix = 'reading-progress:';
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    try {
      const identity = key.slice(prefix.length);
      const slashIdx = identity.indexOf('/');
      if (slashIdx === -1) continue;
      const series = identity.slice(0, slashIdx);
      const story = identity.slice(slashIdx + 1);
      const data = JSON.parse(localStorage.getItem(key));
      entries.push({
        series,
        story,
        chapterIndex: data.chapterIndex ?? 0,
        scrollRatio: data.scrollRatio ?? 0,
        lastReadAt: data.lastReadAt ?? new Date().toISOString(),
        selectionAnchor: data.selectionAnchor ?? null,
        clientId: getClientId(),
      });
    } catch { /* skip corrupt entries */ }
  }
  return entries;
}

/**
 * Import collected local entries to the server via POST /import-local.
 * @param {{ dryRun?: boolean }} options
 * @returns {Promise<{ written: number, conflicts: number, skipped: number } | null>}
 */
export async function importLocalToServer(options = {}) {
  const entries = collectLocalEntries();
  if (entries.length === 0) return { written: 0, conflicts: 0, skipped: 0 };
  try {
    const res = await fetch('/api/plugins/reading-progress/import-local', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Passphrase': getPassphrase(),
      },
      body: JSON.stringify({ entries, dryRun: options.dryRun === true }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// TODO: Custom settings UI for listing/deleting individual progress entries
// and triggering import is deferred — the engine auto-renders settings from
// settingsSchema but has no extension point for custom panels yet.

// ---------------------------------------------------------------------------
// 4.1 — Plugin entry point
// ---------------------------------------------------------------------------

export function register(hooks, context) {
  const settings = getPluginSettings(hooks);
  if (settings.enabled === false) return;

  if (settings.storageBackend === 'local') {
    initLocalMode(hooks, settings);
    return;
  }

  initFileMode(hooks, context, settings);
}

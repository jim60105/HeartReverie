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
    window.location.href = `/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapter/${remoteChapterNumber}`;
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
      putProgressFn({
        chapterIndex: targetIndex,
        scrollRatio: 1,
        lastReadAt: new Date().toISOString(),
        selectionAnchor: null,
        clientId: getClientId(),
        series: currentIdentity.series,
        story: currentIdentity.story,
      });
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
  const containerState = new WeakMap();
  let currentIdentity = null;

  function storageKey(series, story) {
    return `reading-progress:${series}/${story}`;
  }

  hooks.register('story:switch', (ctx) => {
    currentIdentity = null;
  });

  hooks.register('chapter:dom:ready', (ctx) => {
    if (!ctx.series || !ctx.story) return;

    const container = ctx.container;
    if (!(container instanceof HTMLElement)) return;

    // Idempotency guard: if we've already set up scroll-restore + listener
    // for this same container + chapterIndex, skip. Streaming dispatches
    // chapter:dom:ready on every chunk; without this guard each chunk would
    // re-restore scroll back to the saved position, fighting the reader.
    const existing = containerState.get(container);
    if (existing && existing.chapterIndex === ctx.chapterIndex) {
      // Just refresh identity in case ctx fields rotated.
      currentIdentity = {
        series: ctx.series,
        story: ctx.story,
        chapterIndex: ctx.chapterIndex,
      };
      return;
    }

    currentIdentity = {
      series: ctx.series,
      story: ctx.story,
      chapterIndex: ctx.chapterIndex,
    };

    // Cleanup prior state (different chapter on same container, or stale)
    if (existing) existing.cleanup();

    // Restore from localStorage
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

    // Scroll listener — listen on window (the actual scroll container)
    function onScroll() {
      if (!currentIdentity) return;
      const scrollEl = getScrollElement();
      const scrollRatio = scrollEl.scrollTop / Math.max(1, scrollEl.scrollHeight - window.innerHeight);
      try {
        localStorage.setItem(storageKey(currentIdentity.series, currentIdentity.story), JSON.stringify({
          chapterIndex: currentIdentity.chapterIndex,
          scrollRatio: Math.min(1, Math.max(0, scrollRatio)),
          lastReadAt: new Date().toISOString(),
        }));
      } catch { /* storage full */ }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    containerState.set(container, {
      chapterIndex: ctx.chapterIndex,
      cleanup() {
        window.removeEventListener('scroll', onScroll);
      },
    });
  }, 50);

  hooks.register('chapter:dom:dispose', (ctx) => {
    const container = ctx.container;
    if (container instanceof HTMLElement) {
      const state = containerState.get(container);
      if (state) {
        state.cleanup();
        containerState.delete(container);
      }
    }
  }, 50);
}

// ---------------------------------------------------------------------------
// 4.1, 4.3–4.7, 5.1–5.4, 6.1–6.4 — File-backed mode
// ---------------------------------------------------------------------------

function initFileMode(hooks, context, settings) {
  const logger = context && context.logger
    ? context.logger
    : { info: (...args) => console.info('[reading-progress]', ...args) };

  // -- Core state --
  let cachedRevision = 0;
  let syncDisabled = false;
  let applyingRemote = false;
  const lastEntryByIndex = new Map();
  const containerState = new WeakMap();
  let currentIdentity = null;
  let chapters = [];
  let pollTimer = null;

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
    if (!currentIdentity || syncDisabled) return;
    const { series, story, chapterIndex } = currentIdentity;
    const remote = await getProgress(series, story);
    if (!remote) return;

    // Anti-echo: if revision matches, no conflict
    if (remote.revision <= cachedRevision) return;

    cachedRevision = remote.revision;

    const confirmRemoteJump = settings.confirmRemoteJump !== false;
    const chapterDiff = remote.chapterIndex !== chapterIndex;

    if (chapterDiff) {
      // Cross-chapter conflict
      const remoteChapterNumber = remote.chapterIndex + 1;
      if (confirmRemoteJump) {
        showConflictDialog(remoteChapterNumber, series, story, null);
      } else {
        // Auto-jump
        window.location.href = `/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapter/${remoteChapterNumber}`;
      }
    } else {
      // Same chapter: check scroll divergence
      const localEntry = lastEntryByIndex.get(chapterIndex);
      const localRatio = localEntry ? localEntry.scrollRatio : 0;
      if (Math.abs(remote.scrollRatio - localRatio) > 0.1) {
        showScrollHint(null);
      }
    }
  }

  // -- 4.3 — chapter:dom:ready --

  hooks.register('chapter:dom:ready', (ctx) => {
    if (!ctx.series || !ctx.story) return;

    const container = ctx.container;
    if (!(container instanceof HTMLElement)) return;

    // Idempotency guard: if we've already set up listener + restore for
    // this same container + chapterIndex, skip. Streaming dispatches
    // chapter:dom:ready on every chunk; without this guard each chunk would
    // re-restore scroll back to the saved position (or trigger restoreScroll
    // again — whose 1.5s ResizeObserver keeps fighting the user's scroll).
    const existing = containerState.get(container);
    if (existing && existing.chapterIndex === ctx.chapterIndex) {
      currentIdentity = {
        series: ctx.series,
        story: ctx.story,
        chapterIndex: ctx.chapterIndex,
      };
      return;
    }

    currentIdentity = {
      series: ctx.series,
      story: ctx.story,
      chapterIndex: ctx.chapterIndex,
    };

    // Cleanup prior state (different chapter on same container, or stale)
    if (existing) existing.cleanup();

    const trackAnchor = settings.trackSelectionAnchor !== false;

    function onScroll() {
      if (applyingRemote) {
        applyingRemote = false;
        return;
      }
      if (!currentIdentity) return;

      const scrollEl = getScrollElement();
      const scrollRatio = scrollEl.scrollTop / Math.max(1, scrollEl.scrollHeight - window.innerHeight);
      const clampedRatio = Math.min(1, Math.max(0, scrollRatio));

      let selectionAnchor = null;
      if (trackAnchor) {
        selectionAnchor = captureTextFragmentAnchor(container);
      }

      const entry = {
        chapterIndex: currentIdentity.chapterIndex,
        scrollRatio: clampedRatio,
        lastReadAt: new Date().toISOString(),
        selectionAnchor,
        clientId: getClientId(),
        series: currentIdentity.series,
        story: currentIdentity.story,
      };

      lastEntryByIndex.set(currentIdentity.chapterIndex, entry);
      throttle.push(entry);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    containerState.set(container, {
      chapterIndex: ctx.chapterIndex,
      cleanup() {
        window.removeEventListener('scroll', onScroll);
      },
    });

    // Fire-and-forget: GET progress and attempt restore or cross-chapter prompt
    queueMicrotask(async () => {
      const saved = await getProgress(ctx.series, ctx.story);
      if (!saved) return;
      cachedRevision = saved.revision;

      // Cross-chapter: saved progress is on a different chapter → prompt/navigate
      if (saved.chapterIndex !== ctx.chapterIndex) {
        const remoteChapterNumber = saved.chapterIndex + 1;
        const confirmRemoteJump = settings.confirmRemoteJump !== false;
        if (confirmRemoteJump) {
          showConflictDialog(remoteChapterNumber, ctx.series, ctx.story, null);
        } else {
          window.location.href = `/${encodeURIComponent(ctx.series)}/${encodeURIComponent(ctx.story)}/chapter/${remoteChapterNumber}`;
        }
        return;
      }

      // Same chapter: restore scroll position
      applyingRemote = true;
      restoreScroll(
        container,
        saved,
        settings,
        chapters,
        currentIdentity,
        (corrected) => putProgress(corrected),
      );
    });
  }, 50);

  // -- 4.4 — chapter:change --

  hooks.register('chapter:change', (ctx) => {
    if (ctx.previousIndex !== null && ctx.previousIndex !== undefined && ctx.previousIndex !== ctx.index) {
      throttle.flush();
    }
    if (currentIdentity) {
      currentIdentity = {
        ...currentIdentity,
        chapterIndex: ctx.index,
      };
    }
  }, 50);

  // -- 4.5 — chapter:dom:dispose --

  hooks.register('chapter:dom:dispose', (ctx) => {
    // Flush pending for this chapter
    const entry = lastEntryByIndex.get(ctx.chapterIndex);
    if (entry) {
      throttle.flush();
    }

    const container = ctx.container;
    if (container instanceof HTMLElement) {
      const state = containerState.get(container);
      if (state) {
        state.cleanup();
        containerState.delete(container);
      }
    }
    lastEntryByIndex.delete(ctx.chapterIndex);
  }, 50);

  // -- story:switch --

  hooks.register('story:switch', (ctx) => {
    flushAll();
    throttle.cancel();
    lastEntryByIndex.clear();
    currentIdentity = null;
    cachedRevision = 0;
    chapters = Array.isArray(ctx.chapters) ? ctx.chapters : [];
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
  const settings = typeof hooks.getSettings === 'function' ? hooks.getSettings() : {};
  if (settings.enabled === false) return;

  if (settings.storageBackend === 'local') {
    initLocalMode(hooks, settings);
    return;
  }

  initFileMode(hooks, context, settings);
}

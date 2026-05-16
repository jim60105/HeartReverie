// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Regression tests for panel tab persistence after route navigation.
// Bug: When reading component unmounts (navigating to settings), the plugin-panel-slot
// is destroyed but tabEl/panelEl still reference the old detached DOM elements.
// On return, chapter:dom:ready fallback checked `!tabEl` — always false (stale ref).
// Fix: Check `!document.contains(tabEl)` to detect detached elements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@plugins-ext/../_shared/utils.js', () => ({
  escapeHtml: (s: string) => s,
}));

import { register, store, mountPanel, unmountPanel } from '@plugins-ext/chapter-bookmark/frontend.js';

type HookHandler = (ctx: Record<string, unknown>) => unknown;
interface HookEntry { name: string; handler: HookHandler; priority: number }

function createMockHooks() {
  const handlers: HookEntry[] = [];
  return {
    handlers,
    register: (name: string, handler: HookHandler, priority: number) => {
      handlers.push({ name, handler, priority });
    },
    getSettings: vi.fn().mockReturnValue({ enabled: true, showInChapterList: true }),
    fire: (name: string, ctx: Record<string, unknown>) => {
      const matching = handlers.filter((h) => h.name === name);
      matching.sort((a, b) => a.priority - b.priority);
      const results: unknown[] = [];
      for (const h of matching) results.push(h.handler(ctx));
      return results;
    },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('sessionStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ bookmarks: [] }),
    text: () => Promise.resolve(''),
  });
  vi.stubGlobal('fetch', fetchMock);
  document.body.innerHTML = '';
  store.reset('', '');
  vi.clearAllMocks();
});

afterEach(() => {
  // Ensure clean state — unmount any lingering panel
  unmountPanel();
  vi.restoreAllMocks();
});

describe('panel tab persistence after DOM detachment (settings navigation regression)', () => {
  it('remounts panel when tabEl is detached from document (simulating settings→back)', async () => {
    const hooks = createMockHooks();
    register(hooks, {});

    // Step 1: story:switch mounts the panel
    const slot = document.createElement('div');
    slot.id = 'plugin-panel-slot';
    document.body.appendChild(slot);

    hooks.fire('story:switch', {
      series: 'testSeries',
      story: 'testStory',
      chapters: [{ number: 1 }, { number: 2 }],
    });

    // Wait for fetchBookmarks to resolve and mount
    await vi.waitFor(() => {
      expect(slot.querySelector('.cb-tab')).toBeTruthy();
    });

    const originalTab = slot.querySelector('.cb-tab');
    expect(originalTab).toBeTruthy();
    expect(document.contains(originalTab)).toBe(true);

    // Step 2: Simulate navigating to settings — slot is removed from DOM
    // (reading component unmounts, taking plugin-panel-slot with it)
    document.body.removeChild(slot);

    // The tabEl is now detached — still exists but not in document
    expect(document.contains(originalTab)).toBe(false);

    // Step 3: Simulate returning to reading — new slot appears
    const newSlot = document.createElement('div');
    newSlot.id = 'plugin-panel-slot';
    document.body.appendChild(newSlot);

    // Step 4: chapter:dom:ready fires (reading component re-renders)
    const container = document.createElement('div');
    const toolbar = document.createElement('div');
    toolbar.className = 'chapter-toolbar';
    container.appendChild(toolbar);

    hooks.fire('chapter:dom:ready', {
      container,
      chapterNumber: 1,
      series: 'testSeries',
      story: 'testStory',
    });

    // The fallback should detect detached tabEl and trigger a remount
    await vi.waitFor(() => {
      expect(newSlot.querySelector('.cb-tab')).toBeTruthy();
    });

    // Verify the new tab is in the document
    const newTab = newSlot.querySelector('.cb-tab');
    expect(newTab).toBeTruthy();
    expect(document.contains(newTab)).toBe(true);
  });

  it('does NOT remount when tabEl is still in document (normal chapter navigation)', async () => {
    const hooks = createMockHooks();
    register(hooks, {});

    const slot = document.createElement('div');
    slot.id = 'plugin-panel-slot';
    document.body.appendChild(slot);

    // story:switch mounts the panel
    hooks.fire('story:switch', {
      series: 's',
      story: 'st',
      chapters: [{ number: 1 }],
    });

    await vi.waitFor(() => {
      expect(slot.querySelector('.cb-tab')).toBeTruthy();
    });

    // Reset fetch spy count
    fetchMock.mockClear();

    // chapter:dom:ready for a new chapter — panel already mounted in document
    const container = document.createElement('div');
    const toolbar = document.createElement('div');
    toolbar.className = 'chapter-toolbar';
    container.appendChild(toolbar);

    hooks.fire('chapter:dom:ready', {
      container,
      chapterNumber: 2,
      series: 's',
      story: 'st',
    });

    // Should NOT trigger a new fetch (no remount needed)
    // Give a tick for any async to fire
    await Promise.resolve();
    await Promise.resolve();

    // Only the star button injection should happen, not a fetch for panel remount
    // The fallback fetch is identifiable by the bookmarks URL
    const bookmarkFetches = fetchMock.mock.calls.filter(
      (call: unknown[]) => String(call[0]).includes('/bookmarks'),
    );
    expect(bookmarkFetches).toHaveLength(0);
  });

  it('cleans up stale references before remount', async () => {
    const hooks = createMockHooks();
    register(hooks, {});

    const slot = document.createElement('div');
    slot.id = 'plugin-panel-slot';
    document.body.appendChild(slot);

    hooks.fire('story:switch', {
      series: 'a',
      story: 'b',
      chapters: [{ number: 1 }],
    });

    await vi.waitFor(() => {
      expect(slot.querySelector('.cb-tab')).toBeTruthy();
    });

    // Detach: remove slot from document
    document.body.removeChild(slot);

    // New slot
    const newSlot = document.createElement('div');
    newSlot.id = 'plugin-panel-slot';
    document.body.appendChild(newSlot);

    const container = document.createElement('div');
    const toolbar = document.createElement('div');
    toolbar.className = 'chapter-toolbar';
    container.appendChild(toolbar);

    hooks.fire('chapter:dom:ready', {
      container,
      chapterNumber: 1,
      series: 'a',
      story: 'b',
    });

    await vi.waitFor(() => {
      expect(newSlot.querySelector('.cb-tab')).toBeTruthy();
    });

    // Old detached tab should not be in the new slot
    // Only one tab total in the new slot
    expect(newSlot.querySelectorAll('.cb-tab')).toHaveLength(1);
  });
});

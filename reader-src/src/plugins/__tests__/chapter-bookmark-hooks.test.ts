// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { register, store } from '@plugins-ext/chapter-bookmark/frontend.js';

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
  // Mock fetch to prevent real API calls
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
  vi.restoreAllMocks();
});

describe('register()', () => {
  it('registers expected hooks', () => {
    const hooks = createMockHooks();
    register(hooks, {});
    const names = hooks.handlers.map((h) => h.name);
    expect(names).toContain('story:switch');
    expect(names).toContain('chapter:dom:ready');
    expect(names).toContain('chapter:dom:dispose');
    expect(names).toContain('chapter:change');
  });
});

describe('chapter:dom:ready', () => {
  it('injects a star button into chapter toolbar', () => {
    const hooks = createMockHooks();
    register(hooks, {});

    const container = document.createElement('div');
    const toolbar = document.createElement('div');
    toolbar.className = 'chapter-toolbar';
    container.appendChild(toolbar);

    hooks.fire('chapter:dom:ready', {
      container,
      chapterNumber: 1,
      series: 's',
      story: 'st',
    });

    const btn = toolbar.querySelector('[data-bookmark-toggle]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.className).toBe('cb-star-btn');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.textContent).toBe('☆');
  });

  it('syncs aria-pressed when store changes', () => {
    const hooks = createMockHooks();
    register(hooks, {});

    const container = document.createElement('div');
    const toolbar = document.createElement('div');
    toolbar.className = 'chapter-toolbar';
    container.appendChild(toolbar);

    hooks.fire('chapter:dom:ready', {
      container,
      chapterNumber: 5,
      series: 's',
      story: 'st',
    });

    const btn = toolbar.querySelector('[data-bookmark-toggle]') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    store.add({ chapterNumber: 5, note: '', color: null, createdAt: '', updatedAt: '' });

    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.textContent).toBe('⭐');
  });

  it('does not inject when enabled=false', () => {
    const hooks = createMockHooks();
    hooks.getSettings.mockReturnValue({ enabled: false });
    register(hooks, {});

    const container = document.createElement('div');
    const toolbar = document.createElement('div');
    toolbar.className = 'chapter-toolbar';
    container.appendChild(toolbar);

    hooks.fire('chapter:dom:ready', {
      container,
      chapterNumber: 1,
      series: 's',
      story: 'st',
    });

    expect(toolbar.querySelector('[data-bookmark-toggle]')).toBeNull();
  });

  it('handler is synchronous (returns undefined, not Promise)', () => {
    const hooks = createMockHooks();
    register(hooks, {});

    const container = document.createElement('div');
    const toolbar = document.createElement('div');
    toolbar.className = 'chapter-toolbar';
    container.appendChild(toolbar);

    const results = hooks.fire('chapter:dom:ready', {
      container,
      chapterNumber: 1,
      series: 's',
      story: 'st',
    });

    for (const r of results) {
      expect(r).toBeUndefined();
    }
  });
});

describe('chapter:dom:dispose', () => {
  it('removes injected buttons and disposes listeners', () => {
    const hooks = createMockHooks();
    register(hooks, {});

    const container = document.createElement('div');
    const toolbar = document.createElement('div');
    toolbar.className = 'chapter-toolbar';
    container.appendChild(toolbar);

    hooks.fire('chapter:dom:ready', {
      container,
      chapterNumber: 1,
      series: 's',
      story: 'st',
    });

    expect(container.querySelectorAll('[data-bookmark-toggle]')).toHaveLength(1);

    hooks.fire('chapter:dom:dispose', { container });
    expect(container.querySelectorAll('[data-bookmark-toggle]')).toHaveLength(0);
  });
});

describe('story:switch', () => {
  it('is synchronous and triggers fetch via global fetch', () => {
    const hooks = createMockHooks();
    register(hooks, {});

    const results = hooks.fire('story:switch', { series: 'mySeries', story: 'myStory' });

    // Handler returns undefined (sync)
    for (const r of results) {
      expect(r).toBeUndefined();
    }

    // fetch was called (async fire-and-forget via fetchBookmarks)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/plugins/chapter-bookmark/bookmarks'),
      expect.any(Object),
    );
  });

  it('logs warning on fetch failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('net fail'));

    const hooks = createMockHooks();
    register(hooks, {});
    hooks.fire('story:switch', { series: 's', story: 'st' });

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        '[chapter-bookmark] fetch failed',
        expect.any(Error),
      );
    });
  });
});

describe('chapter:change', () => {
  it('updates store current chapter', () => {
    const hooks = createMockHooks();
    register(hooks, {});
    hooks.fire('chapter:change', { chapterNumber: 7 });
    expect(store.getCurrent()).toBe(7);
  });
});

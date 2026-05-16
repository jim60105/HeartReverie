// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the store module in isolation by dynamically importing it
// after stubbing fetch and sessionStorage.

let storeModule: Awaited<ReturnType<typeof loadStore>>;

async function loadStore() {
  // Fresh import each time (vitest module cache is reset via vi.resetModules)
  return await import('@plugins-ext/chapter-bookmark/frontend.js');
}

// Stub sessionStorage for getAuthHeaders
const sessionStorageStub: Record<string, string> = {};

beforeEach(async () => {
  vi.resetModules();
  // Stub sessionStorage.getItem
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => sessionStorageStub[key] ?? null,
    setItem: (key: string, val: string) => { sessionStorageStub[key] = val; },
    removeItem: (key: string) => { delete sessionStorageStub[key]; },
  });
  storeModule = await loadStore();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(sessionStorageStub)) delete sessionStorageStub[key];
});

describe('BookmarkStore', () => {
  it('add / has / remove', () => {
    const { store } = storeModule;
    store.reset('s', 'st');
    expect(store.has(1)).toBe(false);

    store.add({ chapterNumber: 1, note: '', color: null, createdAt: '', updatedAt: '' });
    expect(store.has(1)).toBe(true);
    expect(store.getAll()).toHaveLength(1);

    store.remove(1);
    expect(store.has(1)).toBe(false);
    expect(store.getAll()).toHaveLength(0);
  });

  it('getAll returns sorted by chapterNumber', () => {
    const { store } = storeModule;
    store.reset('s', 'st');
    store.add({ chapterNumber: 3, note: '', color: null, createdAt: '', updatedAt: '' });
    store.add({ chapterNumber: 1, note: '', color: null, createdAt: '', updatedAt: '' });
    store.add({ chapterNumber: 2, note: '', color: null, createdAt: '', updatedAt: '' });
    const all = store.getAll();
    expect(all.map((b) => b.chapterNumber)).toEqual([1, 2, 3]);
  });

  it('dispatches change event on mutations', () => {
    const { store } = storeModule;
    const fn = vi.fn();
    store.addEventListener('change', fn);
    store.reset('s', 'st');
    expect(fn).toHaveBeenCalled();
    fn.mockClear();
    store.add({ chapterNumber: 1, note: '', color: null, createdAt: '', updatedAt: '' });
    expect(fn).toHaveBeenCalled();
    fn.mockClear();
    store.remove(1);
    expect(fn).toHaveBeenCalled();
    fn.mockClear();
    store.setCurrent(5);
    expect(fn).toHaveBeenCalled();
    store.removeEventListener('change', fn);
  });

  it('setCurrent / getCurrent', () => {
    const { store } = storeModule;
    store.reset('s', 'st');
    expect(store.getCurrent()).toBeNull();
    store.setCurrent(42);
    expect(store.getCurrent()).toBe(42);
  });

  it('add replaces existing bookmark with same chapterNumber', () => {
    const { store } = storeModule;
    store.reset('s', 'st');
    store.add({ chapterNumber: 1, note: 'old', color: null, createdAt: '', updatedAt: '' });
    store.add({ chapterNumber: 1, note: 'new', color: null, createdAt: '', updatedAt: '' });
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0]!.note).toBe('new');
  });
});

describe('getAuthHeaders', () => {
  it('returns X-Passphrase when set', () => {
    sessionStorageStub['passphrase'] = 'secret123';
    const headers = storeModule.getAuthHeaders();
    expect(headers).toEqual({ 'X-Passphrase': 'secret123' });
  });

  it('returns empty object when no passphrase', () => {
    const headers = storeModule.getAuthHeaders();
    expect(headers).toEqual({});
  });
});

describe('fetchBookmarks', () => {
  it('populates store from API', async () => {
    const { store, fetchBookmarks } = storeModule;
    store.reset('mySeries', 'myStory');
    const mockBookmarks = [
      { chapterNumber: 2, note: 'hi', color: null, createdAt: '', updatedAt: '' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ bookmarks: mockBookmarks }),
      text: () => Promise.resolve(''),
    }));
    await fetchBookmarks('mySeries', 'myStory');
    expect(store.has(2)).toBe(true);
    expect(store.getAll()).toHaveLength(1);
  });

  it('stale-fetch guard discards old response', async () => {
    const { store, fetchBookmarks } = storeModule;
    store.reset('seriesA', 'storyA');

    // Simulate slow response
    let resolveFirst!: (v: unknown) => void;
    const slowPromise = new Promise((r) => { resolveFirst = r; });

    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => slowPromise));

    const p1 = fetchBookmarks('seriesA', 'storyA');

    // Switch story before first resolves
    store.reset('seriesB', 'storyB');

    // Resolve first fetch
    resolveFirst({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ bookmarks: [{ chapterNumber: 99, note: '', color: null, createdAt: '', updatedAt: '' }] }),
      text: () => Promise.resolve(''),
    });
    await p1;

    // Store should NOT have the stale bookmark
    expect(store.has(99)).toBe(false);
  });
});

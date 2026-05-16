// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Regression tests for position-based goToChapter with non-starting-from-1 chapters.
// Bug: goToChapter used chapter.number directly in the URL (e.g. /chapter/31) instead
// of the 1-indexed position within the cached chapter list (e.g. /chapter/3).
// Fix: Use cachedChapters.findIndex to map number→position.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@plugins-ext/../_shared/utils.js', () => ({
  escapeHtml: (s: string) => s,
}));

import { goToChapter, _setCachedChaptersForTest } from '@plugins-ext/chapter-bookmark/frontend.js';

let pushStateSpy: ReturnType<typeof vi.spyOn>;
let popstateHandler: EventListener;

beforeEach(() => {
  pushStateSpy = vi.spyOn(history, 'pushState').mockImplementation(() => {});
  popstateHandler = vi.fn() as unknown as EventListener;
  globalThis.addEventListener('popstate', popstateHandler);
});

afterEach(() => {
  pushStateSpy.mockRestore();
  globalThis.removeEventListener('popstate', popstateHandler);
  vi.restoreAllMocks();
});

describe('goToChapter — position-based URL with non-starting-from-1 chapters (regression)', () => {
  it('maps chapter number to position when chapters start from 29', () => {
    // Simulate the real scenario: chapters 29-64 (36 total)
    const chapters = Array.from({ length: 36 }, (_, i) => ({ number: 29 + i }));
    _setCachedChaptersForTest(chapters);

    Object.defineProperty(window, 'location', {
      value: { pathname: '/' },
      writable: true,
      configurable: true,
    });

    // Chapter 31 is at index 2, so position = 3
    goToChapter('艾爾瑞亞', '古代文獻研究發表展', 31);

    expect(pushStateSpy).toHaveBeenCalledWith(
      {},
      '',
      `/${encodeURIComponent('艾爾瑞亞')}/${encodeURIComponent('古代文獻研究發表展')}/chapter/3`,
    );
  });

  it('maps first chapter (29) to position 1', () => {
    const chapters = Array.from({ length: 36 }, (_, i) => ({ number: 29 + i }));
    _setCachedChaptersForTest(chapters);

    Object.defineProperty(window, 'location', {
      value: { pathname: '/' },
      writable: true,
      configurable: true,
    });

    goToChapter('series', 'story', 29);

    expect(pushStateSpy).toHaveBeenCalledWith(
      {},
      '',
      '/series/story/chapter/1',
    );
  });

  it('maps last chapter (64) to position 36', () => {
    const chapters = Array.from({ length: 36 }, (_, i) => ({ number: 29 + i }));
    _setCachedChaptersForTest(chapters);

    Object.defineProperty(window, 'location', {
      value: { pathname: '/' },
      writable: true,
      configurable: true,
    });

    goToChapter('series', 'story', 64);

    expect(pushStateSpy).toHaveBeenCalledWith(
      {},
      '',
      '/series/story/chapter/36',
    );
  });

  it('is a no-op when chapter number is not in cached chapters', () => {
    const chapters = [{ number: 29 }, { number: 30 }, { number: 31 }];
    _setCachedChaptersForTest(chapters);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    Object.defineProperty(window, 'location', {
      value: { pathname: '/' },
      writable: true,
      configurable: true,
    });

    // Chapter 99 doesn't exist in the cache
    goToChapter('series', 'story', 99);

    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(popstateHandler).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('chapter 99 not found'),
    );
  });

  it('is a no-op when cachedChapters is empty (story:switch not yet fired)', () => {
    _setCachedChaptersForTest([]);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    Object.defineProperty(window, 'location', {
      value: { pathname: '/' },
      writable: true,
      configurable: true,
    });

    goToChapter('series', 'story', 1);

    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('chapter 1 not found'),
    );
  });

  it('handles gap chapters (non-contiguous numbers)', () => {
    // Chapters: 5, 10, 15, 20
    _setCachedChaptersForTest([{ number: 5 }, { number: 10 }, { number: 15 }, { number: 20 }]);

    Object.defineProperty(window, 'location', {
      value: { pathname: '/' },
      writable: true,
      configurable: true,
    });

    // Chapter 15 is at index 2, so position = 3
    goToChapter('s', 'st', 15);

    expect(pushStateSpy).toHaveBeenCalledWith(
      {},
      '',
      '/s/st/chapter/3',
    );
  });
});

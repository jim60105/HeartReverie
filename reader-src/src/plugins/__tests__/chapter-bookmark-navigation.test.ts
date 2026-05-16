// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the escapeHtml import that frontend.js uses
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
  // Set up cached chapters so goToChapter can map number→position
  _setCachedChaptersForTest([{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }, { number: 5 }]);
});

afterEach(() => {
  pushStateSpy.mockRestore();
  globalThis.removeEventListener('popstate', popstateHandler);
  vi.restoreAllMocks();
});

describe('goToChapter', () => {
  it('calls pushState with encoded URL and dispatches popstate', () => {
    // Ensure we're not already on the target path
    Object.defineProperty(window, 'location', {
      value: { pathname: '/' },
      writable: true,
      configurable: true,
    });

    goToChapter('my series', 'my story', 3);

    expect(pushStateSpy).toHaveBeenCalledWith(
      {},
      '',
      '/my%20series/my%20story/chapter/3',
    );
    expect(popstateHandler).toHaveBeenCalled();
  });

  it('is a no-op when already on target chapter', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/s/st/chapter/5' },
      writable: true,
      configurable: true,
    });

    goToChapter('s', 'st', 5);

    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(popstateHandler).not.toHaveBeenCalled();
  });

  it('encodes special characters in series/story names', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/' },
      writable: true,
      configurable: true,
    });

    goToChapter('日本語', '物語/test', 1);

    expect(pushStateSpy).toHaveBeenCalledWith(
      {},
      '',
      `/${encodeURIComponent('日本語')}/${encodeURIComponent('物語/test')}/chapter/1`,
    );
  });
});

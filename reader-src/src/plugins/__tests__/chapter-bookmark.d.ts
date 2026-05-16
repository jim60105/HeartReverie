// Type declarations for chapter-bookmark plugin (plain JS, no built-in types)
// Everything is inlined in frontend.js — store.js and panel.js are not served.

declare module "@plugins-ext/chapter-bookmark/frontend.js" {
  interface Bookmark {
    chapterNumber: number;
    note: string;
    color: string | null;
    createdAt: string;
    updatedAt: string;
  }

  interface BookmarkStore extends EventTarget {
    _bookmarks: Bookmark[];
    _currentChapter: number | null;
    _lastError: string | null;
    _series: string | null;
    _story: string | null;
    reset(series: string, story: string): void;
    add(bm: Bookmark): void;
    remove(n: number): void;
    has(n: number): boolean;
    setCurrent(n: number | null): void;
    setLastError(msg: string | null): void;
    getAll(): Bookmark[];
    getCurrent(): number | null;
  }

  export function register(
    hooks: {
      on?: (
        name: string,
        handler: (ctx: Record<string, unknown>) => unknown,
        priority: number,
      ) => void;
      register?: (
        name: string,
        handler: (ctx: Record<string, unknown>) => unknown,
        priority: number,
      ) => void;
      getSettings?: () => Record<string, unknown>;
    },
    context: Record<string, unknown>,
  ): void;

  export const store: BookmarkStore;
  export function fetchBookmarks(series: string, story: string): Promise<void>;
  export function toggleBookmark(opts: {
    series: string;
    story: string;
    chapterNumber: number;
  }): Promise<void>;
  export function getAuthHeaders(): Record<string, string>;
  export function apiFetch(path: string, init?: RequestInit): Promise<unknown>;
  export function mountPanel(
    settings: Record<string, unknown>,
    series: string,
    story: string,
  ): void;
  export function unmountPanel(): void;
  export function refreshAllButtons(): void;
  export function attachChapterListObserver(): void;
  export function detachChapterListObserver(): void;
  export function goToChapter(
    series: string,
    story: string,
    chapterNumber: number,
  ): void;
  export function _setCachedChaptersForTest(
    chapters: { number: number }[],
  ): void;
}

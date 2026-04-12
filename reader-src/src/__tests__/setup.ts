/**
 * Shared test setup — mock browser APIs and provide utilities.
 */

/** Create a mock fetch that returns the given JSON body. */
export function mockFetchJson(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
        headers: new Headers(),
      }),
    ),
  );
}

/** Create a mock fetch that returns a text body. */
export function mockFetchText(text: string, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(JSON.parse(text)),
        text: () => Promise.resolve(text),
        headers: new Headers(),
      }),
    ),
  );
}

/** Create a mock fetch that rejects with a network error. */
export function mockFetchError(message = "Network error"): void {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error(message))));
}

/** Create a mock streaming fetch response with ReadableStream. */
export function mockFetchStream(
  chunks: string[],
  status = 200,
): void {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        body: stream,
        headers: new Headers(),
      }),
    ),
  );
}

/** Stub sessionStorage with an in-memory implementation. */
export function stubSessionStorage(): Storage {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    get length() {
      return store.size;
    },
    key: vi.fn((index: number) => [...store.keys()][index] ?? null),
  } as unknown as Storage;
  vi.stubGlobal("sessionStorage", storage);
  return storage;
}

/** Stub localStorage with an in-memory implementation. */
export function stubLocalStorage(): Storage {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    get length() {
      return store.size;
    },
    key: vi.fn((index: number) => [...store.keys()][index] ?? null),
  } as unknown as Storage;
  vi.stubGlobal("localStorage", storage);
  return storage;
}

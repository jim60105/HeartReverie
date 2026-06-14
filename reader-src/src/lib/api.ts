// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import { useAuth } from "@/composables/useAuth";

/**
 * Structured RFC 9457 Problem Details error thrown by `apiFetch` on non-2xx
 * responses. The single source of truth for problem-details parsing on the
 * frontend.
 *
 * `message` is the detail-first human string (byte-identical to the prior
 * `apiFetch` contract) so existing `err.message`-matching consumers keep
 * working unchanged; `status`/`type`/`title`/`body` expose the richer
 * structured fields for callers that want them.
 */
export class ApiError extends Error {
  override readonly name: string = "ApiError";
  constructor(
    message: string,
    public readonly status: number,
    public readonly type?: string,
    public readonly title?: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

export interface ApiFetchOptions extends RequestInit {
  /**
   * If true (default), `apiFetch` throws an Error on non-2xx responses.
   * The error message is taken from the JSON body's `detail` field, or
   * `errorMessage` / `res.statusText` as fallbacks.
   * If false, the Response is returned regardless of status so callers
   * can inspect it themselves.
   */
  throwOnError?: boolean;
  /** Fallback error message when the response body has no `detail` field. */
  errorMessage?: string;
}

/**
 * Thin wrapper around `fetch` that injects the X-Passphrase auth header
 * from `useAuth()` and, by default, throws on non-2xx responses with the
 * server-provided `detail` message.
 *
 * Caller-supplied headers win over the injected auth headers if they
 * collide (they normally do not — auth uses X-Passphrase only).
 */
export async function apiFetch(
  input: string | URL,
  init: ApiFetchOptions = {},
): Promise<Response> {
  const { getAuthHeaders } = useAuth();
  const { throwOnError = true, errorMessage, ...rest } = init;

  const url = typeof input === "string" ? input : input.toString();

  // Use Headers to normalize all three RequestInit.headers shapes
  // (object literal, Headers instance, [key, value][]); caller wins on collision.
  const headers = new Headers(getAuthHeaders() as Record<string, string>);
  if (rest.headers) {
    new Headers(rest.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  const res = await fetch(url, { ...rest, headers });

  if (!res.ok && throwOnError) {
    const body = await res.json().catch(() => ({}));
    const problem = body as { detail?: string; type?: string; title?: string };
    const detail = problem.detail;
    throw new ApiError(
      detail ?? errorMessage ?? (res.statusText || `Request failed: ${url}`),
      res.status,
      problem.type,
      problem.title,
      body,
    );
  }

  return res;
}

/** Like `apiFetch` but parses and returns the JSON body. */
export async function apiFetchJson<T>(
  input: string | URL,
  init: ApiFetchOptions = {},
): Promise<T> {
  const res = await apiFetch(input, init);
  return res.json() as Promise<T>;
}

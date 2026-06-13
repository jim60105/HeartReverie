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

import { errorMessage, problemJson } from "./errors.ts";
import { ChatAbortError, ChatError } from "./chat-types.ts";
import type { ProblemDetail } from "../types.ts";

/**
 * HTTP/RFC-9457 title mapping for {@link ChatError} codes. This is the single
 * source of truth for chat-error titles; adding a new `ChatErrorCode` requires
 * exactly two edits: the union in `chat-types.ts` and one row here.
 */
const ERROR_TITLES: Record<string, string> = {
  "api-key": "Internal Server Error",
  "bad-path": "Bad Request",
  "vento": "Unprocessable Entity",
  "no-prompt": "Internal Server Error",
  "llm-api": "AI Service Error",
  "llm-stream": "Bad Gateway",
  "no-body": "Bad Gateway",
  "no-content": "Bad Gateway",
  "story-config": "Unprocessable Entity",
  "no-chapter": "Bad Request",
  "concurrent": "Conflict",
  "conflict": "Conflict",
};

/**
 * Transport-agnostic classification of a thrown chat-pipeline error. Each
 * transport (HTTP or WebSocket) decides *how* to send the outcome, not *what*
 * the outcome is. Logging fields ride alongside the response payload so the
 * caller can log every non-aborted error before responding.
 */
export type TranslatedChatError =
  | { readonly kind: "aborted" }
  | {
    readonly kind: "vento";
    readonly status: 422;
    /** The 422 body: `{ type: "vento-error", ...ventoError }`. */
    readonly body: Record<string, unknown>;
    /** Human-readable detail (the original error message) for transports that
     * surface a plain `detail` string alongside the structured `body`. */
    readonly detail: string;
    readonly logFields: Record<string, unknown>;
  }
  | {
    readonly kind: "chat";
    readonly status: number;
    readonly problem: ProblemDetail;
    readonly logFields: Record<string, unknown>;
  }
  | {
    readonly kind: "unexpected";
    readonly status: 500;
    readonly problem: ProblemDetail;
    readonly logFields: Record<string, unknown>;
  };

/**
 * Classify a thrown chat-pipeline error into a transport-agnostic outcome.
 *
 * - {@link ChatAbortError} → `aborted` (caller must NOT log it as an error).
 * - {@link ChatError} with `code === "vento"` and a `ventoError` payload →
 *   `vento`, carrying the 422 `{ type: "vento-error", ...ventoError }` body.
 * - Any other {@link ChatError} → `chat`, with the {@link ERROR_TITLES} title
 *   (falling back to "Internal Server Error") and the error's HTTP status
 *   passed through.
 * - Anything else → `unexpected`, a 500 whose detail is `fallbackDetail`.
 *
 * @param err The thrown value caught in a chat catch block.
 * @param fallbackDetail Detail used for the `unexpected` 500 outcome.
 */
export function translateChatError(
  err: unknown,
  fallbackDetail: string,
): TranslatedChatError {
  if (err instanceof ChatAbortError) {
    return { kind: "aborted" };
  }
  if (err instanceof ChatError) {
    const logFields: Record<string, unknown> = {
      code: err.code,
      httpStatus: err.httpStatus,
      detail: err.message,
      ventoError: err.ventoError,
    };
    if (err.code === "vento" && err.ventoError) {
      return {
        kind: "vento",
        status: 422,
        body: { type: "vento-error", ...err.ventoError },
        detail: err.message,
        logFields,
      };
    }
    const title = ERROR_TITLES[err.code] ?? "Internal Server Error";
    return {
      kind: "chat",
      status: err.httpStatus,
      problem: problemJson(title, err.httpStatus, err.message),
      logFields,
    };
  }
  return {
    kind: "unexpected",
    status: 500,
    problem: problemJson("Internal Server Error", 500, fallbackDetail),
    logFields: { error: errorMessage(err) },
  };
}

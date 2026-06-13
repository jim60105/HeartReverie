## Context

Chat-error translation is duplicated four times and has drifted:

- `writer/routes/chat.ts:27-40` — `ERROR_TITLES: Record<string, string>` maps `ChatErrorCode` → RFC 9457 title (`"api-key"` → "Internal Server Error", `"vento"` → "Unprocessable Entity", `"llm-api"` → "AI Service Error", `"concurrent"`/`"conflict"` → "Conflict", …). This is the single place titles live today.
- `writer/routes/chat.ts:95-123` (send) and `:155-182` (continue) — near-identical catch blocks: `ChatAbortError` → 499; `ChatError` with `code === "vento"` and `ventoError` → `c.json({ type: "vento-error", ...ventoError }, 422)`; other `ChatError` → `problemJson(ERROR_TITLES[code] ?? "Internal Server Error", httpStatus, message)`; non-ChatError → 500 with a generic fallback detail.
- `writer/routes/ws-chat.ts:76-106` (send) and `:150-180` (continue) — log the same fields but send `conn.wsSend(ws, { type: "chat:error", id, detail })` where `detail` is `err.message` for `ChatError`, else `"Failed to process chat request"`. **No vento special-case** — structured `ventoError` is dropped on the WebSocket path.

Relevant types:
- `writer/lib/chat-types.ts:84-110` — `ChatErrorCode` union, `ChatError` (`code`, `httpStatus`, `ventoError?`), `ChatAbortError`.
- `writer/lib/errors.ts:19` — `problemJson(title, status, detail, extra?)`; the `ProblemDetail` type (verify exact export name).
- `writer/types/ws.ts` — `WsServerMessage` discriminated union; the `chat:error` variant currently carries `{ type, id, detail }`.

Constraints: TS strict, double quotes, semicolons, JSDoc, AGPL header on new files. Pre-release, 0 users — no migration concerns.

## Goals / Non-Goals

**Goals:**
- One `translateChatError(err, fallbackDetail)` that owns the `ERROR_TITLES` table and the vento special case.
- Byte-identical HTTP responses before/after (titles, statuses, the 422 `{ type: "vento-error", ... }` body).
- Structured `ventoError` carried over the WebSocket `chat:error` envelope (additive field), ending the HTTP/WS drift.
- Adding a new `ChatErrorCode` requires exactly two edits: the union in `chat-types.ts` and one `ERROR_TITLES` row in the translator.

**Non-Goals:**
- Changing throw sites in `writer/lib/chat-shared.ts`.
- Touching `writer/routes/ws-plugin-action.ts` (different RFC 9457 `problem`-object contract; its swallowed-log issue is the `log-swallowed-backend-errors` change).
- Frontend changes — consuming the new WebSocket `ventoError` field is deferred follow-up.

## Decisions

- **Translator output shape**: a discriminated union `TranslatedChatError` with kinds `aborted` / `vento` / `chat` / `unexpected`. The `vento` kind carries `{ status: 422, body, logFields }`; `chat` and `unexpected` carry `{ status, problem, logFields }`. This keeps logging fields and the response payload together so each transport only chooses *how* to send, not *what*. Alternative considered: returning a ready-made Hono `Response` — rejected because the WebSocket transport does not produce Hono responses.
- **Translator home**: a new `writer/lib/chat-error-translate.ts` rather than `chat-types.ts`, to keep `chat-types.ts` declaration-only. The translator imports `problemJson`, `errorMessage`, and the `ProblemDetail` type from `./errors.ts`, and `ChatError`/`ChatAbortError` from `./chat-types.ts`.
- **WebSocket vento carry**: extend the `chat:error` variant of `WsServerMessage` with `ventoError?: Record<string, unknown>`. This is additive — existing clients ignore unknown fields, so no breaking change. The WebSocket `detail` for a vento error becomes a short human string (e.g. "Template rendering error") while the structured payload rides in `ventoError`.
- **Logging preserved**: each transport still logs every non-aborted error before responding. The HTTP side keeps its existing log message strings ("Chat request failed" / "Continue request failed" / "Unexpected chat error" / "Unexpected continue error") because tests may pin them. The WebSocket side logs with `event: "chat:error"` plus the translator's `logFields`.

## Risks / Trade-offs

- [HTTP wire shape regression] → Existing chat route tests pin titles/statuses/the vento body; additionally diff a captured response before/after for a vento failure and an llm-api failure. Any divergence is a STOP condition.
- [Frontend type-check breaks on the `WsServerMessage` change] → The new field is optional and additive; if `deno task build:reader` still breaks in a way requiring edits beyond regenerating types, that is out of scope — STOP and report.
- [Tests pinning exact pre-change WebSocket `detail` for vento errors] → Update those to the new equivalent and note it in the commit message; if more than ~5 tests pin pre-change behavior in ways suggesting the duplication was intentional, STOP and report.

## Migration Plan

Not applicable — pre-release, 0 users. The new WebSocket `ventoError` field is additive and transmitted-but-unused until a frontend follow-up consumes it.

## Dependencies / Coordination

- **Depends on `consolidate-delete-last-chapter`**: both changes edit `ws-chat.ts`. Land the consolidation change first; reconcile this change's catch-block edits against the post-consolidation `ws-chat.ts` before starting. If the catch blocks no longer match the documented excerpts because the consolidation landed with conflicting edits, treat it as drift and rebase context first.

## Open Questions

- Confirm the exact exported name of the Problem Details type in `writer/lib/errors.ts` (`ProblemDetail` vs another name) and import accordingly. Resolved at implementation time via inspection.

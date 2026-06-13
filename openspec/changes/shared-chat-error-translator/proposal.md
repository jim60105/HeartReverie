## Why

The mapping from a thrown chat-pipeline error to a client-facing response is copy-pasted across four catch blocks (HTTP send + continue in `chat.ts`, WebSocket send + continue in `ws-chat.ts`), and the copies have already drifted. The HTTP side special-cases `err.code === "vento"` to return the structured `ventoError` payload as a 422 `{ type: "vento-error", ... }` body, while the WebSocket side sends only a plain `detail` string — so the frontend's Vento error card never receives its structured payload over WebSocket. Every new `ChatErrorCode` currently requires editing four catch blocks plus the `ERROR_TITLES` table.

## What Changes

- Extract a single transport-agnostic `translateChatError(err, fallbackDetail)` function (in a new `writer/lib/chat-error-translate.ts`) that classifies a thrown chat error into one of `aborted` / `vento` / `chat` / `unexpected`, owning the `ERROR_TITLES` code→title table and the structured-vento special case.
- Route both HTTP catch blocks (`chat.ts` send + continue) through the translator, producing byte-identical wire responses (same titles, statuses, and 422 vento body) while removing the duplicated logic and the local `ERROR_TITLES` table.
- Route both WebSocket catch blocks (`ws-chat.ts` send + continue) through the translator via a small local `sendChatError` helper, and **carry the structured `ventoError` over WebSocket** by extending the `chat:error` envelope with an optional `ventoError` field (additive; existing clients ignore unknown fields).

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `vento-error-handling`: Add a requirement that the structured Vento error payload is carried over the WebSocket `chat:error` envelope (not only the HTTP 422 path), via an additive optional `ventoError` field, so a future WebSocket consumer can render the same `VentoErrorCard`.
- `error-handling-conventions`: Add a requirement that chat-pipeline error translation is centralized in a single shared translator and that both transports' catch blocks delegate to it, preserving server-side logging of every translated error.

## Impact

- Backend: new `writer/lib/chat-error-translate.ts`; `writer/routes/chat.ts` (two catch blocks, drop local `ERROR_TITLES`); `writer/routes/ws-chat.ts` (two catch blocks + local `sendChatError` helper); `writer/types/ws.ts` (additive `ventoError?` on the `chat:error` variant).
- Tests: new `tests/writer/lib/chat_error_translate_test.ts` (unit); WebSocket route test asserting `ventoError` propagation; existing chat/ws route tests pin wire shapes as the regression net.
- Depends on the `consolidate-delete-last-chapter` change (both edit `ws-chat.ts`); land that first to avoid merge conflicts.
- Frontend is an optional later consumer of the new WebSocket `ventoError` field; not changed here. No migration concerns (pre-release).

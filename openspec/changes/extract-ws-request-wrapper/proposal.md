## Why

`reader-src/src/composables/useChatApi.ts` (~660 lines) contains four near-identical ~90-line Promise wrappers for WebSocket request lifecycles — `sendMessage`, `resendMessage`, `continueLastChapter`, and `runPluginPrompt`'s WS path. Each re-implements the same pattern: per-type `onMessage` subscriptions (delta/done/error/aborted), a `watch(isConnected)` disconnect guard, a 300-second timeout, and an identical multi-line `cleanup()`. That is ~340 lines of one pattern copied four times on the single highest-traffic frontend module. The copies have already micro-diverged (the plugin path tracks `currentPluginActionId` vs `currentRequestId`, correlates on `correlationId` vs `id`, and **rejects** instead of resolving `false`). Every future protocol change costs four edits.

## What Changes

- Introduce a private `wsRequest<TDone, TResult>(spec)` helper inside `useChatApi.ts` that encapsulates the shared WebSocket request lifecycle: subscribe delta/done/error/aborted (each guarded by a configurable correlation-id field `"id" | "correlationId"`), a `watch(isConnected)` disconnect guard, a single configurable timeout (default `300_000` ms), and a unified `cleanup()` that clears the timer, stops the watcher, unsubscribes all four handlers, and clears the module-level current-id variable.
- Migrate the four WS Promise wrappers (`sendMessage`, `resendMessage`, `continueLastChapter`, `runPluginPrompt`'s WS path) to call `wsRequest`, one at a time, preserving every observable behavior exactly: the wire envelopes sent, the public function signatures, the zh-TW error strings per function, `streamingContent` reset and `isLoading = false` on every terminal path, `useUsage().pushRecord(...)` and `dispatchNotification(...)` where currently present, and **`runPluginPrompt`'s reject-on-error** contract (error carries a `code` property = the problem `type` slug).
- Add two regression tests pinning the divergences the wrapper must NOT flatten: a `chat:done` for a non-matching id MUST NOT resolve the promise (correlation guard), and `runPluginPrompt` MUST reject when a `plugin-action:error` arrives.
- This is a **refactor with no wire-protocol change and no public-API change**. The HTTP fallback paths and `useWebSocket.ts` are out of scope.
- This change SHALL be **abandoned (not forced through)** if preserving `runPluginPrompt`'s reject-on-error behavior requires a worse abstraction than the existing duplication — e.g. the wrapper API would need more than two type parameters or callback soup worse than the four copies (mirrors plan 007's STOP condition; "not worth doing" is an acceptable outcome).

## Capabilities

### New Capabilities
_None._ No new user-facing capability; this consolidates the existing WS request lifecycle implementation.

### Modified Capabilities
- `vue-component-architecture`: Add a requirement that the four WebSocket request wrappers in `useChatApi.ts` are consolidated behind one private `wsRequest` lifecycle helper, with the module's public `use*` surface (`sendMessage`, `resendMessage`, `continueLastChapter`, `runPluginPrompt`) unchanged.
- `websocket-chat-streaming`: Add a requirement that the frontend's `chat:send` / `chat:resend` / `chat:continue` WS request lifecycles (correlation, terminal-state resets, disconnect/timeout handling) are governed by the shared wrapper while preserving every existing client-observable behavior and envelope.
- `continue-last-chapter`: Add a requirement that `continueLastChapter`'s WS path is one of the wrapper's call sites and preserves its existing terminal-path behavior and `chat:*` correlation.

## Impact

- **Frontend code**: `reader-src/src/composables/useChatApi.ts` (add `wsRequest`, migrate four call sites; expected to shrink from ~660 to roughly 400–450 lines).
- **Tests**: chat-API suite under `reader-src/src/composables/__tests__/` gains two new tests; existing suites are the compatibility net.
- **Out of scope**: `useWebSocket.ts` (its `onMessage`/`send`/`isConnected` API is the fixed contract), the HTTP fallback paths, and any wire-protocol or public-signature change.
- **Risk**: MED — this is the core chat path. A missed terminal-path state reset surfaces only under failure conditions (permanently-spinning UI), which automated tests under-cover, so a **mandatory manual container smoke test** (WS send + mid-generation disconnect + plugin action button) gates completion per the workspace integration-verification protocol.
- **Dependency ordering**: `unify-frontend-apierror` (Plan 009) also rewrites parts of `useChatApi.ts`; this change MUST land first to avoid conflicts. `move-readtemplate-to-lib` and `pending-plugin-inits-weakmap` are independent.
- No migration concerns (pre-release, 0 users).

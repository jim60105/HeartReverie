## Context

All paths are relative to the `HeartReverie/` repo root.

`reader-src/src/composables/useChatApi.ts` (~660 lines) contains four near-identical WebSocket request lifecycle wrappers:

- `sendMessage` WS path (~lines 71–137)
- `resendMessage` WS path (~lines 215–274)
- `continueLastChapter` WS path (~lines 358–417)
- `runPluginPrompt` WS path (~lines 504–590)

Representative excerpt (`sendMessage`):

```ts
const id = crypto.randomUUID();
currentRequestId = id;
return new Promise<boolean>((resolve) => {
  const unsubDelta = onMessage("chat:delta", (msg) => {
    if (msg.id !== id) return;
    streamingContent.value += msg.content;
  });
  const unsubDone = onMessage("chat:done", (msg) => {
    if (msg.id !== id) return;
    cleanup();
    streamingContent.value = "";
    isLoading.value = false;
    useUsage().pushRecord(msg.usage);
    dispatchNotification("chat:done", { id });
    resolve(true);
  });
  const unsubError = onMessage("chat:error", (msg) => { /* …cleanup, zh-TW error, resolve(false)… */ });
  const unsubAborted = onMessage("chat:aborted", (msg) => { /* …cleanup, resolve(false)… */ });
  const stopWatchClose = watch(isConnected, (connected) => {
    if (!connected) { /* cleanup, "連線中斷", resolve(false) */ }
  });
  const timeout = setTimeout(() => { /* cleanup, "請求逾時", resolve(false) */ }, 300_000);
  function cleanup(): void {
    clearTimeout(timeout); stopWatchClose();
    unsubDelta(); unsubDone(); unsubError(); unsubAborted();
    currentRequestId = null;
  }
  send({ type: "chat:send", id, series, story, message: outgoingMessage });
});
```

The three siblings differ only in: envelope type strings (`chat:resend` / `chat:continue` / `plugin-action:run`), the matching done/error/aborted message types (the `plugin-action:*` family correlates on `correlationId` instead of `id`), which module-level id variable they set (`currentRequestId` vs `currentPluginActionId`), the zh-TW error strings, and the done-handler payload processing (`runPluginPrompt` resolves a `RunPluginPromptResult` and **rejects** on error rather than resolving `false`).

`useWebSocket.ts` exposes `onMessage(type, handler): () => void` (returns an unsubscribe fn), `send(msg)`, `isConnected`, `isAuthenticated`. Its API is the fixed contract and is **not** changed.

Constraints: Vue 3 Composition API, TS strict, double quotes, semicolons, zh-TW user-facing strings, silent error handling on the frontend. `.vue`/`.ts` frontend type+behaviour coverage is `vue-tsc` (via `deno task build:reader`) + Vitest (`deno task test:frontend`).

This is a **MED-risk** change: `useChatApi.ts` is the single highest-traffic frontend module and the core chat path.

## Goals / Non-Goals

**Goals:**

- Collapse the four duplicated WS lifecycle wrappers behind one private `wsRequest<TDone, TResult>(spec)` helper, eliminating the copy-pasted lifecycle (per-type subscriptions, disconnect watcher, timeout, `cleanup()`). The shared helper itself plus the four declarative specs offset much of the raw line count — the file ends near 680 lines (was ~660) — but the duplication is gone: exactly one `setTimeout`, one disconnect watcher, and one `cleanup()` remain. The terminal-state reset (`streamingContent`/`isLoading`) is centralized inside the helper's `cleanup()` so no terminal path can miss it.
- Preserve every client-observable behavior exactly: envelopes sent, public signatures, zh-TW error strings, terminal-state resets, correlation guards, and `runPluginPrompt`'s reject-on-error.
- Make future protocol changes a one-place edit.

**Non-Goals:**

- No change to `useWebSocket.ts` (its `onMessage`/`send`/`isConnected` API is fixed).
- No change to the HTTP fallback paths inside the four functions — only the WS Promise wrappers are extracted.
- No wire-protocol change and no public-signature change (`sendMessage`, `resendMessage`, `continueLastChapter`, `runPluginPrompt` keep their exact signatures, including `runPluginPrompt`'s reject-on-error).

## Decisions

### Decision: One private generic helper `wsRequest<TDone, TResult>(spec)`

Add (not exported — keep the module surface unchanged) a helper shaped roughly as:

```ts
interface WsRequestSpec<TDone, TResult> {
  idField: "id" | "correlationId"; // correlation field name in server messages
  id: string;
  deltaType: string;
  doneType: string;
  errorType: string;
  abortedType: string;
  onDelta: (msg: Record<string, unknown>) => void;
  onDone: (msg: TDone) => TResult;          // map done message → resolved value
  onError: (msg: Record<string, unknown>) => TResult; // return resolves; throw rejects
  onAborted: () => TResult;
  onDisconnect: () => TResult;
  onTimeout: () => TResult;
  setCurrentId: (v: string | null) => void; // set/clear module-level current-id var
  envelope: Record<string, unknown>;        // sent after wiring subscriptions
  timeoutMs?: number;                        // default 300_000
}

function wsRequest<TDone, TResult>(spec: WsRequestSpec<TDone, TResult>): Promise<TResult> { /* … */ }
```

Implementation requirements (all observed in the existing four copies):

- Subscribe delta/done/error/aborted via `onMessage`, each guarded by `msg[spec.idField] !== spec.id → return`.
- `watch(isConnected, …)` → on disconnect: `cleanup()` then resolve `spec.onDisconnect()`.
- `setTimeout(spec.timeoutMs ?? 300_000)` → `cleanup()` then resolve `spec.onTimeout()`.
- `cleanup()` clears the timer, stops the watcher, unsubscribes all four, calls `spec.setCurrentId(null)`, and resets `streamingContent.value = ""` and `isLoading.value = false`. Centralizing the terminal-state reset in `cleanup()` — which every terminal path runs — guarantees no terminal path (done/error/aborted/disconnect/timeout) can leave the UI spinning, so per-call callbacks no longer repeat the reset (they only set flow-specific state such as `errorMessage`, usage push, and notifications).
- done/error/aborted handlers call `cleanup()` **before** invoking the spec callback (matching current ordering); `errorMessage` is set by the callback after `cleanup()`, preserving the prior observable end state.
- For rejection support (`runPluginPrompt`): allow `onError` (and `onAborted`/`onDisconnect`/`onTimeout`) to `throw` — the wrapper catches the throw and rejects the promise; returning a value resolves it.
- `spec.setCurrentId(spec.id)` before subscribing; `send(spec.envelope)` last.

**Type pragmatics:** mirror whatever typing pattern the current `onMessage` callbacks use (inspect the existing handler signatures from `useWebSocket`'s `WsServerMessage` handlers before inventing generics). Reduce `TDone` to the concrete message type per call if simpler. The plan caps complexity: if reject support forces the API into >2 type parameters or callback soup worse than the duplication, **STOP and report** — "not worth doing" is an acceptable outcome.

**Alternative considered:** a class-based subscriber or an external utility module. Rejected — a single in-file private function keeps the module surface unchanged and the diff reviewable; `useWebSocket.ts` stays untouched.

### Decision: Migrate one call site at a time, simplest first

Order: `continueLastChapter` (simplest semantics) → `sendMessage` → `resendMessage` → `runPluginPrompt` (reject-on-error; `correlationId`; resolves a result object). Run `deno task test:frontend` after **each** migration and confirm green before the next. Each migrated function shrinks to roughly: hook dispatch / state setup (unchanged), then `return wsRequest({ … ~15-line spec … })`, then the HTTP fallback (unchanged).

**Behavioral invariants to preserve exactly** (tests may pin them): the per-function zh-TW error strings copied verbatim ("發送失敗", "連線中斷", "請求逾時", and the resend/continue/plugin variants — do not normalize wording); `streamingContent.value` reset-to-empty on every terminal path; `isLoading.value = false` on every terminal path; `useUsage().pushRecord(...)` on done where present; `dispatchNotification(...)` where present; `runPluginPrompt` rejects with an `Error` whose `code` property carries the problem `type` slug where the current code does so.

### Decision: Add two regression tests pinning the divergences

In the existing chat test file (following its `useWebSocket` mocking style): (1) a `chat:done` for a NON-matching id does not resolve the promise (correlation guard); (2) `runPluginPrompt` rejects when a `plugin-action:error` arrives (pinning the reject-vs-resolve divergence so the wrapper can't flatten it).

## Risks / Trade-offs

- **[The four wrappers don't match the described shape (drift)]** → Run the drift check (`git diff` on `useChatApi.ts` since the plan's base commit) first; on mismatch, STOP and report.
- **[A migrated site breaks an existing test for a non-obvious reason]** → If the cause isn't an obvious test-side string/mock update, revert that single site and report (STOP condition). Migrating one at a time keeps the blast radius to one function.
- **[Reject-on-error forces a convoluted wrapper API]** → STOP and report; abandoning the change is acceptable.
- **[Missed terminal-path state reset]** → Surfaces only under failure conditions as a permanently-spinning UI, which automated tests under-cover. Mitigation: reviewer focus on `streamingContent`/`isLoading` resets on every terminal path **and** the mandatory manual smoke test below.

## Migration Plan

1. Add `wsRequest` (type-level check via `deno task build:reader`).
2. Migrate the four call sites one at a time, running `deno task test:frontend` after each.
3. Full gates: `deno task build:reader && deno task test:frontend && deno task fmt && deno task lint`.
4. **Mandatory manual integration verification** (per the workspace protocol, because this touches runtime behavior on the core chat path): build the container (`scripts/podman-build-run.sh`), confirm clean startup, then exercise — (a) send a chat message over the WS path; (b) kill the WS (devtools offline) mid-generation and confirm the disconnect message appears; (c) run one plugin action button. If the operator is unavailable, the change is marked "in progress — awaiting manual smoke," not done.

Rollback is a revert of `useChatApi.ts` and the new tests.

## Dependency Ordering

- **`unify-frontend-apierror` (Plan 009) depends on this change.** Both rewrite parts of `useChatApi.ts`; **this change (007) MUST land first** so 009 rebases onto the consolidated wrapper rather than the four copies.
- `move-readtemplate-to-lib` (006) and `pending-plugin-inits-weakmap` (010) are **independent** — backend-only, no shared files.

## Open Questions

- Final type-parameter count for `wsRequest`: target ≤2 (`TDone`, `TResult`). If preserving `runPluginPrompt`'s reject behavior pushes past that or yields callback soup worse than the duplication, the change is abandoned per the STOP condition rather than forced.

## 1. Pre-flight

- [x] 1.1 Run the drift check: `git -C HeartReverie diff --stat <base>..HEAD -- reader-src/src/composables/useChatApi.ts`; compare the four WS wrapper sites against the documented excerpts. On any mismatch, STOP and report.
- [x] 1.2 Confirm the four WS wrapper sites match the described shape (per-type `onMessage` subscriptions, `watch(isConnected)` disconnect guard, 300-second timeout, identical `cleanup()`). If they don't, STOP and report.
- [x] 1.3 Identify the existing chat-API test file(s): `ls reader-src/src/composables/__tests__/ | grep -i chat`. Run `deno task test:frontend` to capture the green baseline.
- [x] 1.4 Inspect the current `onMessage` callback signatures (from `useWebSocket`'s `WsServerMessage` handlers) so the wrapper's payload typing mirrors them rather than inventing generics.

## 2. Write the generic wrapper

- [x] 2.1 Add a private (non-exported) `WsRequestSpec<TDone, TResult>` interface and `wsRequest<TDone, TResult>(spec): Promise<TResult>` helper inside `useChatApi.ts`, with fields: `idField: "id" | "correlationId"`, `id`, `deltaType`, `doneType`, `errorType`, `abortedType`, `onDelta`, `onDone`, `onError`, `onAborted`, `onDisconnect`, `onTimeout`, `setCurrentId`, `envelope`, `timeoutMs?` (default `300_000`).
- [x] 2.2 Implement: subscribe delta/done/error/aborted via `onMessage`, each guarded by `msg[spec.idField] !== spec.id → return`; `watch(isConnected)` → on disconnect `cleanup()` + resolve/reject `spec.onDisconnect()`; `setTimeout(spec.timeoutMs ?? 300_000)` → `cleanup()` + resolve/reject `spec.onTimeout()`; `cleanup()` clears the timer, stops the watcher, unsubscribes all four, calls `spec.setCurrentId(null)`, and centralizes the terminal-state reset (`streamingContent.value = ""`, `isLoading.value = false`) so every terminal path resets it; done/error/aborted handlers call `cleanup()` BEFORE the spec callback; `spec.onError`/`onAborted`/`onDisconnect`/`onTimeout` may `throw` to reject the promise (returning a value resolves it); call `spec.setCurrentId(spec.id)` before subscribing and `send(spec.envelope)` last.
- [x] 2.3 If preserving `runPluginPrompt`'s reject behavior forces the wrapper API into >2 type parameters or callback soup worse than the duplication, STOP and report ("not worth doing" is an acceptable outcome).
- [x] 2.4 Verify type-level correctness: `deno task build:reader` → exit 0.

## 3. Migrate the four call sites (one at a time, test after each)

- [x] 3.1 Migrate `continueLastChapter`'s WS path to `wsRequest({ … })` (simplest semantics first). Preserve the `chat:continue` envelope, zh-TW strings, `streamingContent`/`isLoading` resets, usage push. Run `deno task test:frontend` → green before proceeding.
- [x] 3.2 Migrate `sendMessage`'s WS path to `wsRequest({ … })`. Preserve the `chat:send` envelope, "發送失敗"/"連線中斷"/"請求逾時" strings, `streamingContent`/`isLoading` resets, `useUsage().pushRecord(...)`, `dispatchNotification(...)`. Run `deno task test:frontend` → green.
- [x] 3.3 Migrate `resendMessage`'s WS path to `wsRequest({ … })`. Preserve the `chat:resend` envelope and its zh-TW variants. Run `deno task test:frontend` → green.
- [x] 3.4 Migrate `runPluginPrompt`'s WS path to `wsRequest({ … })` (`idField: "correlationId"`, sets `currentPluginActionId`, resolves a `RunPluginPromptResult`, **rejects** on error via `onError` throwing an `Error` whose `code` carries the problem `type` slug). Run `deno task test:frontend` → green.
- [x] 3.5 If any existing test fails after a single-site migration and the cause is not an obvious test-side string/mock update, revert that site and report (STOP condition).
- [x] 3.6 Verify duplication removal (not a raw line-count target): the four inline WS lifecycle wrappers are gone, replaced by one shared `wsRequest` helper plus four declarative specs. `wc -l reader-src/src/composables/useChatApi.ts` lands near ~680 lines (was ~660) — the in-file helper and the unchanged HTTP fallbacks set the floor, so the win is structural DRY (one `setTimeout`, one disconnect watcher, one `cleanup()`), verified by the §5.4 grep gates, not a halved file.

## 4. Add regression tests

- [x] 4.1 In the existing chat test file (following its `useWebSocket` mocking style): add a test that a `chat:done` for a NON-matching id does NOT resolve the promise (correlation guard).
- [x] 4.2 Add a test that `runPluginPrompt` REJECTS when a `plugin-action:error` arrives (pinning the reject-vs-resolve divergence).

## 5. Verification gates

- [x] 5.1 `deno task build:reader` → exit 0 (vue-tsc + vite).
- [x] 5.2 `deno task test:frontend` → all pass, including the 2 new tests.
- [x] 5.3 `deno task fmt` and `deno task lint` → exit 0.
- [x] 5.4 `grep -c "setTimeout(" reader-src/src/composables/useChatApi.ts` ≤ 2 and `grep -c "stopWatchClose" reader-src/src/composables/useChatApi.ts` ≤ 1.
- [x] 5.5 `git diff` shows no public-signature changes for `sendMessage`, `resendMessage`, `continueLastChapter`, `runPluginPrompt`; no files outside the in-scope list modified (`git status`).

## 6. Mandatory manual integration verification (BLOCKING)

> Per the workspace's mandatory integration-verification protocol — this change touches runtime behavior on the MED-risk core chat path. Do NOT mark the change done until this passes (or mark "in progress — awaiting manual smoke" if the operator is unavailable).

- [x] 6.1 Build and run the container: `cd HeartReverie/ && scripts/podman-build-run.sh`.
- [x] 6.2 Confirm clean startup: `podman logs heartreverie 2>&1 | grep -i "error\|warn"` is clean.
- [x] 6.3 Send a chat message over the WebSocket path and confirm streaming + completion.
- [x] 6.4 Kill the WebSocket (devtools offline) mid-generation and confirm the disconnect message ("連線中斷") appears and the UI is not left spinning.
- [x] 6.5 Run one plugin action button and confirm it completes (and that an induced `plugin-action:error` rejects as expected).

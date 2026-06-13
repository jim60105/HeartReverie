## 1. Pre-flight

- [ ] 1.1 Run the drift check: `git -C HeartReverie diff --stat <base>..HEAD -- reader-src/src/composables/useChatApi.ts`; compare the four WS wrapper sites against the documented excerpts. On any mismatch, STOP and report.
- [ ] 1.2 Confirm the four WS wrapper sites match the described shape (per-type `onMessage` subscriptions, `watch(isConnected)` disconnect guard, 300-second timeout, identical `cleanup()`). If they don't, STOP and report.
- [ ] 1.3 Identify the existing chat-API test file(s): `ls reader-src/src/composables/__tests__/ | grep -i chat`. Run `deno task test:frontend` to capture the green baseline.
- [ ] 1.4 Inspect the current `onMessage` callback signatures (from `useWebSocket`'s `WsServerMessage` handlers) so the wrapper's payload typing mirrors them rather than inventing generics.

## 2. Write the generic wrapper

- [ ] 2.1 Add a private (non-exported) `WsRequestSpec<TDone, TResult>` interface and `wsRequest<TDone, TResult>(spec): Promise<TResult>` helper inside `useChatApi.ts`, with fields: `idField: "id" | "correlationId"`, `id`, `deltaType`, `doneType`, `errorType`, `abortedType`, `onDelta`, `onDone`, `onError`, `onAborted`, `onDisconnect`, `onTimeout`, `setCurrentId`, `envelope`, `timeoutMs?` (default `300_000`).
- [ ] 2.2 Implement: subscribe delta/done/error/aborted via `onMessage`, each guarded by `msg[spec.idField] !== spec.id → return`; `watch(isConnected)` → on disconnect `cleanup()` + resolve `spec.onDisconnect()`; `setTimeout(spec.timeoutMs ?? 300_000)` → `cleanup()` + resolve `spec.onTimeout()`; `cleanup()` clears the timer, stops the watcher, unsubscribes all four, calls `spec.setCurrentId(null)`; done/error/aborted handlers call `cleanup()` BEFORE the spec callback; `spec.onError` may `throw` to reject the promise; call `spec.setCurrentId(spec.id)` before subscribing and `send(spec.envelope)` last.
- [ ] 2.3 If preserving `runPluginPrompt`'s reject behavior forces the wrapper API into >2 type parameters or callback soup worse than the duplication, STOP and report ("not worth doing" is an acceptable outcome).
- [ ] 2.4 Verify type-level correctness: `deno task build:reader` → exit 0.

## 3. Migrate the four call sites (one at a time, test after each)

- [ ] 3.1 Migrate `continueLastChapter`'s WS path to `wsRequest({ … })` (simplest semantics first). Preserve the `chat:continue` envelope, zh-TW strings, `streamingContent`/`isLoading` resets, usage push. Run `deno task test:frontend` → green before proceeding.
- [ ] 3.2 Migrate `sendMessage`'s WS path to `wsRequest({ … })`. Preserve the `chat:send` envelope, "發送失敗"/"連線中斷"/"請求逾時" strings, `streamingContent`/`isLoading` resets, `useUsage().pushRecord(...)`, `dispatchNotification(...)`. Run `deno task test:frontend` → green.
- [ ] 3.3 Migrate `resendMessage`'s WS path to `wsRequest({ … })`. Preserve the `chat:resend` envelope and its zh-TW variants. Run `deno task test:frontend` → green.
- [ ] 3.4 Migrate `runPluginPrompt`'s WS path to `wsRequest({ … })` (`idField: "correlationId"`, sets `currentPluginActionId`, resolves a `RunPluginPromptResult`, **rejects** on error via `onError` throwing an `Error` whose `code` carries the problem `type` slug). Run `deno task test:frontend` → green.
- [ ] 3.5 If any existing test fails after a single-site migration and the cause is not an obvious test-side string/mock update, revert that site and report (STOP condition).
- [ ] 3.6 Verify size reduction: `wc -l reader-src/src/composables/useChatApi.ts` ≈ 400–450 lines (from ~660).

## 4. Add regression tests

- [ ] 4.1 In the existing chat test file (following its `useWebSocket` mocking style): add a test that a `chat:done` for a NON-matching id does NOT resolve the promise (correlation guard).
- [ ] 4.2 Add a test that `runPluginPrompt` REJECTS when a `plugin-action:error` arrives (pinning the reject-vs-resolve divergence).

## 5. Verification gates

- [ ] 5.1 `deno task build:reader` → exit 0 (vue-tsc + vite).
- [ ] 5.2 `deno task test:frontend` → all pass, including the 2 new tests.
- [ ] 5.3 `deno task fmt` and `deno task lint` → exit 0.
- [ ] 5.4 `grep -c "setTimeout(" reader-src/src/composables/useChatApi.ts` ≤ 2 and `grep -c "stopWatchClose" reader-src/src/composables/useChatApi.ts` ≤ 1.
- [ ] 5.5 `git diff` shows no public-signature changes for `sendMessage`, `resendMessage`, `continueLastChapter`, `runPluginPrompt`; no files outside the in-scope list modified (`git status`).

## 6. Mandatory manual integration verification (BLOCKING)

> Per the workspace's mandatory integration-verification protocol — this change touches runtime behavior on the MED-risk core chat path. Do NOT mark the change done until this passes (or mark "in progress — awaiting manual smoke" if the operator is unavailable).

- [ ] 6.1 Build and run the container: `cd HeartReverie/ && scripts/podman-build-run.sh`.
- [ ] 6.2 Confirm clean startup: `podman logs heartreverie 2>&1 | grep -i "error\|warn"` is clean.
- [ ] 6.3 Send a chat message over the WebSocket path and confirm streaming + completion.
- [ ] 6.4 Kill the WebSocket (devtools offline) mid-generation and confirm the disconnect message ("連線中斷") appears and the UI is not left spinning.
- [ ] 6.5 Run one plugin action button and confirm it completes (and that an induced `plugin-action:error` rejects as expected).

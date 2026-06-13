## ADDED Requirements

### Requirement: WebSocket request lifecycles consolidated behind a shared wrapper in useChatApi

`reader-src/src/composables/useChatApi.ts` SHALL implement the WebSocket request lifecycle for `sendMessage`, `resendMessage`, `continueLastChapter`, and `runPluginPrompt`'s WS path through a single private helper (`wsRequest`), rather than four near-identical inline Promise wrappers. The helper SHALL NOT be exported — the module's public surface SHALL remain `sendMessage`, `resendMessage`, `continueLastChapter`, and `runPluginPrompt` with unchanged signatures.

The shared helper SHALL encapsulate: per-message-type subscriptions for delta / done / error / aborted via `onMessage`, each guarded by a configurable correlation-id field (`"id"` or `"correlationId"`); a `watch(isConnected)` disconnect guard; a single configurable timeout (default 300000 ms); and a unified `cleanup()` that clears the timer, stops the watcher, unsubscribes all four handlers, and clears the module-level current-id variable. The done / error / aborted handlers SHALL call `cleanup()` before invoking their per-call callback. The helper SHALL set the module-level current-id before subscribing and send the envelope last. The helper SHALL support both resolve-on-error (chat paths) and reject-on-error (`runPluginPrompt`) by allowing the error callback to throw, in which case the returned promise rejects.

The four duplicated WS wrappers SHALL be removed: the file SHALL contain at most one `setTimeout(` call (the wrapper's) plus at most one elsewhere, and at most one disconnect-watcher (`stopWatchClose`) reference.

#### Scenario: Public exports of useChatApi are unchanged

- **WHEN** the public exports of `useChatApi` are compared before and after the change
- **THEN** `sendMessage`, `resendMessage`, `continueLastChapter`, and `runPluginPrompt` SHALL retain their exact signatures and no new public symbol SHALL be exported

#### Scenario: Duplicated timeouts and disconnect watchers are gone

- **WHEN** `useChatApi.ts` is searched after the change
- **THEN** `grep -c "setTimeout(" reader-src/src/composables/useChatApi.ts` SHALL be at most 2 and `grep -c "stopWatchClose" reader-src/src/composables/useChatApi.ts` SHALL be at most 1

#### Scenario: runPluginPrompt reject-on-error preserved

- **WHEN** a `plugin-action:error` message arrives for an in-flight `runPluginPrompt` WS request
- **THEN** the returned promise SHALL reject with an `Error` whose `code` property carries the problem `type` slug, exactly as before the refactor (not resolve `false`)

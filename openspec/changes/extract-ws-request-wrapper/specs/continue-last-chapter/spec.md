## ADDED Requirements

### Requirement: continueLastChapter WS path uses the shared request wrapper

The `continueLastChapter` function's WebSocket path in `reader-src/src/composables/useChatApi.ts` SHALL be implemented as a call site of the shared `wsRequest` helper rather than a bespoke inline Promise wrapper. Its observable behavior SHALL be preserved exactly: it SHALL send the `chat:continue` envelope, correlate `chat:delta` / `chat:done` / `chat:error` / `chat:aborted` messages by request id, reset `streamingContent` and `isLoading` on every terminal path, push usage on `chat:done` where previously present, and surface its preserved zh-TW error strings. The public `continueLastChapter` signature SHALL be unchanged, and the HTTP fallback path SHALL be untouched.

#### Scenario: Continue streams over the shared wrapper

- **WHEN** `continueLastChapter` runs over the WebSocket path and the server streams `chat:delta` messages followed by `chat:done`
- **THEN** the request SHALL resolve through the shared wrapper with `streamingContent` reset to empty and `isLoading` set to `false`, identical to the pre-refactor behavior

#### Scenario: Continue HTTP fallback unchanged

- **WHEN** the WebSocket is unavailable and `continueLastChapter` takes its HTTP fallback path
- **THEN** that fallback SHALL be unchanged by this refactor (only the WS Promise wrapper is extracted)

#### Scenario: Continue public signature preserved

- **WHEN** the `continueLastChapter` export is inspected after the change
- **THEN** its signature SHALL be identical to before the refactor

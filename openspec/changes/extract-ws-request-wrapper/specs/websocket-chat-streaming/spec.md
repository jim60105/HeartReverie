## ADDED Requirements

### Requirement: Frontend WS chat request lifecycle preserves client-observable behavior under the shared wrapper

When the `useChatApi` WebSocket request wrappers for `chat:send`, `chat:resend`, and `chat:continue` are consolidated behind the shared `wsRequest` helper, every client-observable behavior of those flows SHALL be preserved exactly. No wire-protocol change SHALL occur: the envelopes sent (`{ type: "chat:send" | "chat:resend" | "chat:continue", id, … }`) and their correlation fields SHALL be byte-identical to the prior implementation. Each flow SHALL correlate server messages by matching `msg.id` (chat family) or `msg.correlationId` (plugin-action family) against the request id, ignoring non-matching messages.

On every terminal path (done, error, aborted, disconnect, timeout) the wrapper SHALL reset `streamingContent.value` to empty and set `isLoading.value = false`. On a `chat:done` it SHALL push the usage record via `useUsage().pushRecord(...)` and dispatch the corresponding notification where the prior code did so. The per-function zh-TW user-facing error strings (e.g. "發送失敗", "連線中斷", "請求逾時", and the resend/continue/plugin variants) SHALL be preserved verbatim, not normalized.

#### Scenario: Correlation guard ignores non-matching ids

- **WHEN** a `chat:done` message arrives whose correlation id does NOT match the in-flight request id
- **THEN** the wrapper SHALL ignore it and SHALL NOT resolve or reject the request promise

#### Scenario: Terminal paths reset streaming state

- **WHEN** any WS chat request reaches a terminal state (done, error, aborted, disconnect, or timeout)
- **THEN** `streamingContent.value` SHALL be reset to empty and `isLoading.value` SHALL be set to `false`

#### Scenario: Disconnect mid-generation surfaces the disconnect message

- **WHEN** the WebSocket disconnects (`isConnected` becomes false) while a WS chat request is in flight
- **THEN** the wrapper SHALL clean up subscriptions and the timer and resolve the request along its disconnect path, surfacing the preserved zh-TW disconnect string ("連線中斷")

#### Scenario: Timeout path preserved

- **WHEN** a WS chat request exceeds its timeout (default 300000 ms) without a terminal message
- **THEN** the wrapper SHALL clean up and resolve along its timeout path with the preserved zh-TW timeout string ("請求逾時")

#### Scenario: Usage and notification dispatched on done where previously present

- **WHEN** a `chat:done` arrives for an in-flight `chat:send` request that previously pushed usage and dispatched a notification
- **THEN** the wrapper SHALL call `useUsage().pushRecord(...)` and dispatch the same notification as before the refactor

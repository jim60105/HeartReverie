## ADDED Requirements

### Requirement: Continue button on the chat input

The `ChatInput.vue` component SHALL render a "Continue" (繼續) button alongside the existing Send / Resend / Stop buttons. The button SHALL be visible whenever a story is selected (the same gate that enables the textarea today).

The button SHALL be disabled when ANY of the following conditions hold:

1. The component prop `disabled` is `true` (no story selected, or parent-imposed disable).
2. The shared `isLoading` ref from `useChatApi()` is `true` — another generation is in flight on this client.
3. The chapter list is empty — the story has zero `NNN.md` files on disk. The component SHALL read this from a reactive `chapterCount` ref exposed by `useChapterNav()` (or the equivalent composable that owns the chapter list).
4. The latest chapter's content is whitespace-only — there is nothing to continue. The component SHALL read this from a reactive `latestChapterIsEmpty` ref exposed by the same composable.

When the user clicks the button (and it is enabled), the component SHALL invoke `useChatApi().continueLastChapter(series, story)` exactly once. The component SHALL NOT clear the textarea (the user's previous message text remains untouched). The component SHALL surface streaming progress through the existing `streamingContent` reactive ref and SHALL surface errors through the existing `errorMessage` reactive ref, identically to the Send flow.

The Stop button SHALL replace the Continue button (and the Send button) while `isLoading` is `true`, and clicking Stop SHALL invoke `abortCurrentRequest()` from `useChatApi()` — i.e. the same Stop button serves all three modes (send, resend, continue).

#### Scenario: Continue button hidden conditions

- **GIVEN** a reader page where no story is selected
- **WHEN** the user views the page
- **THEN** the chat input is hidden (existing behaviour); the Continue button is therefore not rendered

#### Scenario: Continue button disabled when no chapters

- **GIVEN** a story is selected but the story directory has zero chapter files
- **WHEN** the chat input renders
- **THEN** the Continue button SHALL be visible and SHALL have its native `disabled` attribute set to `true`

#### Scenario: Continue button disabled when latest chapter is empty

- **GIVEN** a story whose latest `NNN.md` file exists but contains only whitespace
- **WHEN** the chat input renders
- **THEN** the Continue button SHALL be visible and disabled, with the same opacity / cursor styling as other disabled chat buttons

#### Scenario: Continue button disabled while another generation is active

- **GIVEN** a chat send / resend / continue is currently in flight (`isLoading.value === true`)
- **WHEN** the chat input renders
- **THEN** the Continue button SHALL be disabled, the Send button SHALL be hidden and replaced by the Stop button, and the Resend button SHALL also be disabled (existing behaviour)

#### Scenario: Click invokes continueLastChapter

- **GIVEN** a story is selected, the chapter list is non-empty, the latest chapter has content, and no generation is active
- **WHEN** the user clicks the Continue button
- **THEN** the component SHALL call `useChatApi().continueLastChapter(series, story)` exactly once with the currently-loaded series and story names; SHALL NOT clear or modify the textarea; SHALL transition to `isLoading === true`; AND SHALL begin updating `streamingContent` from the streaming response

#### Scenario: Streaming preview shows continuation deltas

- **GIVEN** a continue request that streams three content deltas
- **WHEN** the deltas arrive
- **THEN** the existing `streamingContent` ref SHALL accumulate exactly the three deltas (in order), and the streaming preview block SHALL render them under the input card identically to the send flow

#### Scenario: Stop button aborts continue

- **GIVEN** a continue request is in flight (`isLoading.value === true`)
- **WHEN** the user clicks the Stop button
- **THEN** `abortCurrentRequest()` SHALL be invoked, dispatching `chat:abort` over WebSocket (or aborting the HTTP `AbortController` on fallback), AND the UI SHALL return to the idle state on receipt of `chat:aborted` (or HTTP 499)

### Requirement: useChatApi exposes continueLastChapter

The `useChatApi()` composable in `reader-src/src/composables/useChatApi.ts` SHALL export a new method `continueLastChapter(series: string, story: string): Promise<boolean>`. The method SHALL:

1. Refuse to start (resolve `false` and set `errorMessage` to a generic message) if `isLoading.value === true` already — defence in depth against double-click.
2. Dispatch `frontendHooks.dispatch("chat:send:before", …)` is NOT required (continue has no user-visible message to mutate); plugins relying on `chat:send:before` are not invoked for continue.
3. When `useWebSocket().isConnected.value && useWebSocket().isAuthenticated.value`, send `{ type: "chat:continue", id, series, story }` and subscribe to `chat:delta` / `chat:done` / `chat:error` / `chat:aborted` envelopes correlated by `id` — the same correlation logic the existing `sendMessage()` uses.
4. Otherwise (HTTP fallback), `POST /api/stories/:series/:name/chat/continue` with the existing auth headers from `useAuth().getAuthHeaders()`. Use a fresh `AbortController` and assign it to the module-scoped `httpAbortController` so the existing `abortCurrentRequest()` can cancel it.
5. On success (`chat:done` or HTTP 200), call `useUsage().pushRecord(usage)` with the returned record (or call `useUsage().load(series, story)` to reconcile when the response omits `usage`), and resolve `true`.
6. On error (`chat:error` or HTTP non-2xx), set `errorMessage.value` to a generic Traditional-Chinese message (e.g. `"繼續失敗"`); SHALL NOT expose the raw server `detail` text to the user. Dispatch `frontendHooks.dispatch("notification", { event: "chat:error", … })` with the same shape as the send path.
7. On abort (`chat:aborted` or HTTP 499 / `AbortError`), resolve `false` without setting `errorMessage`.

The `isLoading`, `streamingContent`, and `errorMessage` reactive refs SHALL be the same module-scoped refs already shared by `sendMessage()` and `resendMessage()` — no new refs are introduced.

#### Scenario: WS path sends chat:continue envelope

- **GIVEN** WebSocket is connected and authenticated
- **WHEN** `continueLastChapter("s1", "n1")` is invoked
- **THEN** the composable SHALL emit exactly one `{ type: "chat:continue", id: <uuid>, series: "s1", story: "n1" }` over the WebSocket, and SHALL NOT issue any HTTP request

#### Scenario: HTTP fallback POSTs to /chat/continue

- **GIVEN** WebSocket is disconnected
- **WHEN** `continueLastChapter("s1", "n1")` is invoked
- **THEN** the composable SHALL `POST` to `/api/stories/s1/n1/chat/continue` with the auth headers from `useAuth().getAuthHeaders()` and SHALL set `signal` on the fetch to a fresh `AbortController.signal`

#### Scenario: Streaming deltas update streamingContent

- **GIVEN** an in-flight continue request over WebSocket
- **WHEN** the server emits `{ type: "chat:delta", id, content: "看見店員微笑。" }`
- **THEN** the shared `streamingContent` ref SHALL be appended with exactly `"看見店員微笑。"`

#### Scenario: Error surfaces generic message

- **GIVEN** a continue request that fails with `chat:error` (or HTTP 502)
- **WHEN** the failure arrives
- **THEN** `errorMessage.value` SHALL be set to a generic Traditional-Chinese error string and SHALL NOT contain the raw server `detail` text; the function SHALL resolve `false`; AND `isLoading.value` SHALL be `false`

### Requirement: Chapter list composable exposes continue gating refs

The chapter list composable (`useChapterNav()` in `reader-src/src/composables/useChapterNav.ts`, or its equivalent) SHALL expose two reactive refs that the Continue button can read directly without re-fetching:

- `chapterCount: Ref<number>` — the number of chapter files currently known to the frontend (kept up-to-date by the existing polling / refresh flow).
- `latestChapterIsEmpty: Ref<boolean>` — `true` when the highest-numbered chapter has neither a `<user_message>` block content nor any non-whitespace prose remainder, mirroring the backend's `executeContinue()` refusal condition (refuse only when **both** parts are empty). Concretely: the ref SHALL be computed by running a client-side equivalent of `parseChapterForContinue()` on the chapter's loaded text and checking that **both** `userMessageText.trim() === ""` and `assistantPrefill.trim() === ""`. SHALL be `false` when `chapterCount === 0` (the gate-on-zero-chapters condition is owned by `chapterCount`, not by this ref). Aligning with backend semantics avoids the silent UX bug where the button enables but the backend refuses with `no-content`.

The refs SHALL update reactively whenever the chapter list refreshes (poll, manual reload, or post-`chat:done` reconciliation). No new fetch is required — the chapter content is already in scope for the existing chapter renderer.

#### Scenario: Refs reflect zero chapters

- **GIVEN** a freshly created story directory with no `NNN.md` files
- **WHEN** the composable initialises and finishes its first chapter list load
- **THEN** `chapterCount.value === 0` AND `latestChapterIsEmpty.value === false`

#### Scenario: Refs reflect a non-empty latest chapter

- **GIVEN** a story whose latest chapter contains the prose `"他走進店裡。"`
- **WHEN** the composable's chapter list reflects the on-disk state
- **THEN** `chapterCount.value > 0` AND `latestChapterIsEmpty.value === false`

#### Scenario: Refs reflect a chapter with only `<user_message>` (no prose)

- **GIVEN** a story whose latest chapter contains `<user_message>探索藥妝店</user_message>\n\n` followed by no prose
- **WHEN** the composable's chapter list reflects the on-disk state
- **THEN** `chapterCount.value > 0` AND `latestChapterIsEmpty.value === false` (continue is allowed because `userMessageText` is non-empty)

#### Scenario: Refs reflect an empty latest chapter

- **GIVEN** a story whose latest chapter file is whitespace-only OR contains only stripped-away plugin tags (no `<user_message>` body and no prose)
- **WHEN** the composable's chapter list reflects the on-disk state
- **THEN** `chapterCount.value > 0` AND `latestChapterIsEmpty.value === true`

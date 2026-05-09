## ADDED Requirements

### Requirement: Sidebar transient hide during LLM streaming

The `Sidebar.vue` host component (`<aside class="sidebar">`) SHALL be visually suppressed for the entire duration of an active LLM streaming request, identified by `useChatApi().isLoading === true`. The suppression SHALL be implemented as a CSS class toggle on the existing `<aside>` element — the element SHALL remain mounted in the DOM and its children (plugin-relocated `.plugin-sidebar` panels, slot content) SHALL NOT be unmounted, recreated, or reordered as a side effect of the toggle.

This requirement defines a **visual-only** mitigation. The relocation `watchPostEffect` in `ContentArea.vue` MAY still re-run during streaming and MAY still mutate `<aside>`'s subtree; that work is hidden from the reader but not avoided. Deferring or batching such relocation work is explicitly out of scope.

This requirement assumes a **single-flight LLM request** model — i.e., that the project does not start a second LLM request while the first is still streaming. If concurrent requests are introduced later, `isLoading`'s boolean semantics SHALL be revisited (e.g., refcounting) so the sidebar does not reappear before all streams have settled; that revision is out of scope for this change.

When `isLoading === true`, the `<aside>` SHALL receive a class (e.g., `.sidebar--hidden-during-stream`) whose CSS rules:

- On desktop (≥ 768 px): apply `visibility: hidden`, `opacity: 0`, and `pointer-events: none`. The `<aside>`'s layout box SHALL remain so the chapter column does not shift horizontally during streaming.
- On mobile (< 768 px): apply `display: none` so the empty vertical slot collapses (avoiding a blank gap below the chapter content).

When `isLoading` returns to `false` — whether by stream completion, server error, network failure, user abort, or cancel — the class SHALL be removed within the same render frame and the sidebar SHALL be visible again immediately. No animation or debounce delay SHALL be introduced.

The hidden state SHALL be derived purely from the in-memory `useChatApi().isLoading` ref. The implementation SHALL NOT persist any "sidebar hidden" flag to `localStorage`, `sessionStorage`, IndexedDB, cookies, the URL query string, or any other persistent store. After a full page reload (the user agent reloads the document and the JS bundle is freshly evaluated), the sidebar SHALL start visible regardless of any prior streaming session — `isLoading` re-initialises to `false`.

The hide rule SHALL only suppress the `<aside class="sidebar">` element. The streaming preview area, the chapter content, the header, the chat input, and any other UI SHALL be unaffected. The sidebar's children (relocated `.plugin-sidebar` panels) inherit the suppression transitively because they are descendants of `<aside>`; plugin polling timers, fetches, and event listeners SHALL continue running unaffected.

#### Scenario: Sidebar hides while streaming on desktop

- **WHEN** the user submits a chat message on a viewport ≥ 768 px and `useChatApi().isLoading` becomes `true`
- **THEN** the `<aside class="sidebar">` element SHALL receive the hidden-during-stream class
- **AND** its computed `visibility` SHALL be `hidden` and `opacity` SHALL be `0`
- **AND** the chapter column's horizontal width SHALL NOT change

#### Scenario: Sidebar hides while streaming on mobile

- **WHEN** the user submits a chat message on a viewport < 768 px and `useChatApi().isLoading` becomes `true`
- **THEN** the `<aside class="sidebar">` element SHALL receive the hidden-during-stream class
- **AND** its computed `display` SHALL be `none` so the vertical slot collapses
- **AND** the chapter content immediately above SHALL NOT be visually pushed down by an empty gap

#### Scenario: Sidebar reappears on stream completion

- **WHEN** an LLM stream completes successfully and `isLoading` flips to `false`
- **THEN** the hidden-during-stream class SHALL be removed from `<aside>` within the same render frame
- **AND** the sidebar SHALL be visible (`visibility: visible` on desktop, normal `display` on mobile)

#### Scenario: Sidebar reappears on stream abort

- **WHEN** the user clicks the abort/cancel control during streaming and `isLoading` flips to `false` (this typically happens when the server acknowledges the abort, not necessarily on the client click itself)
- **THEN** the hidden-during-stream class SHALL be removed
- **AND** the sidebar SHALL be visible immediately upon the `isLoading → false` transition

#### Scenario: Sidebar reappears on stream error

- **WHEN** the streaming request errors out (network failure, server 5xx, decode error) and `isLoading` flips to `false`
- **THEN** the hidden-during-stream class SHALL be removed
- **AND** the sidebar SHALL be visible immediately

#### Scenario: DOM stays mounted across hide/show cycles

- **WHEN** `isLoading` toggles from `false` → `true` → `false` while plugin `.plugin-sidebar` panels are present in `<aside>`
- **THEN** those `.plugin-sidebar` elements SHALL retain their identity (same DOM nodes, same event listeners, same internal state)
- **AND** `ContentArea.vue`'s relocation `watchPostEffect` SHALL NOT need to re-run as a result of the toggle

#### Scenario: Sidebar starts visible on fresh page load

- **WHEN** the user reloads the page (or otherwise causes the JS bundle to be freshly evaluated) and no chat activity has occurred yet
- **THEN** `<aside class="sidebar">` SHALL NOT carry the hidden-during-stream class
- **AND** the sidebar SHALL be fully visible

#### Scenario: Hidden state is not persisted

- **WHEN** the sidebar is in the hidden-during-stream state and the user reloads the page
- **THEN** after reload, `<aside class="sidebar">` SHALL be visible (no hidden class)
- **AND** no key matching the hidden-state name SHALL be present in `localStorage`, `sessionStorage`, IndexedDB, cookies, or the URL query string

#### Scenario: Other UI surfaces unaffected

- **WHEN** `isLoading === true` and the sidebar is hidden
- **THEN** the streaming preview area inside `ChatInput.vue` SHALL still render visibly
- **AND** the header, chapter content, and chat input controls SHALL be unaffected by the hide rule
- **AND** on desktop (≥ 768 px) the page body's scroll position SHALL NOT change as a result of the toggle (the layout box is preserved). On mobile (< 768 px) the page MAY shorten because the sidebar's vertical slot collapses; in that case the browser's native scroll-anchoring behaviour SHALL be relied upon.

#### Scenario: Plugin polling continues while sidebar is hidden

- **WHEN** `isLoading === true` and the sidebar is hidden, and a plugin (e.g., `sd-webui-image-gen`) has an active polling timer for image metadata
- **THEN** the polling timer SHALL continue firing on schedule
- **AND** any fetch the timer triggers SHALL proceed normally
- **AND** when the sidebar reappears at stream end, it SHALL display the most recently polled state

#### Scenario: Hidden sidebar does not capture clicks

- **WHEN** `isLoading === true` and the user clicks at a screen position that would normally hit the sidebar (e.g., on a pre-stream visible thumbnail)
- **THEN** the click event SHALL NOT be received by the sidebar or its children (`pointer-events: none` on desktop; the element does not exist in the layout on mobile)
- **AND** the click SHALL fall through to whichever element is now at that position (or be a no-op over the backdrop)

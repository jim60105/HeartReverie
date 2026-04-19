## ADDED Requirements

### Requirement: Persist input text via sessionStorage

The `ChatInput.vue` component SHALL persist its textarea content to `sessionStorage` under a story-scoped key: `"heartreverie:chat-input:<series>:<story>"`. The component SHALL save the current textarea text to sessionStorage immediately before emitting a `send` or `resend` event. On component initialization (`<script setup>`), the component SHALL read from sessionStorage and populate the textarea's reactive ref with the stored value, or default to an empty string if no stored value exists. All sessionStorage access SHALL be wrapped in try/catch to gracefully handle restricted environments (falling back to empty string on read, silently failing on write).

#### Scenario: Text saved on send
- **WHEN** the user clicks the send button with a non-empty message
- **THEN** the component SHALL write the textarea content to `sessionStorage.setItem("heartreverie:chat-input:<series>:<story>", text)` before emitting the `send` event

#### Scenario: Text saved on resend
- **WHEN** the user clicks the resend button with a non-empty message
- **THEN** the component SHALL write the textarea content to `sessionStorage.setItem("heartreverie:chat-input:<series>:<story>", text)` before emitting the `resend` event

#### Scenario: Text restored on component mount
- **WHEN** the `ChatInput.vue` component is initialized (mounted or re-mounted)
- **THEN** the component SHALL read `sessionStorage.getItem("heartreverie:chat-input:<series>:<story>")` and set the textarea's reactive ref to the stored value

#### Scenario: No stored value on first mount
- **WHEN** the component is initialized and `sessionStorage.getItem(...)` returns `null`
- **THEN** the textarea's reactive ref SHALL default to an empty string

#### Scenario: Text survives component remount
- **WHEN** the user types a message, sends it, and the component is destroyed then recreated (e.g., due to chapter navigation toggling `v-if`)
- **THEN** the recreated component SHALL display the previously sent message text in the textarea

#### Scenario: Storage isolated per story
- **WHEN** the user sends "hello" in story A, then navigates to story B
- **THEN** story B's chat input SHALL NOT display "hello"; it SHALL display story B's own persisted value or an empty string

#### Scenario: Storage unavailable
- **WHEN** sessionStorage is unavailable or throws an error (e.g., private browsing restrictions)
- **THEN** the component SHALL render normally with an empty textarea and SHALL NOT throw or display an error

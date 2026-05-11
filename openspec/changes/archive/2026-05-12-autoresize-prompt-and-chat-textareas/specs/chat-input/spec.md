# chat-input — Delta spec for autoresize-prompt-and-chat-textareas

## ADDED Requirements

### Requirement: Chat textarea auto-resizes on paste and on stored-draft restore

The `ChatInput.vue` chat textarea (`textarea.chat-textarea`) SHALL keep itself sized to its content **only** in response to discrete content-replacement events: when a multi-line draft is restored from `sessionStorage` on mount, when the user pastes content into the textarea, and when the parent invokes the exposed `appendText()` method. The textarea SHALL NOT resize on every keystroke during ordinary typing — by design, so that the chapter content above the input does not shift while the user is composing line-by-line.

The textarea SHALL never shrink below a floor of three text lines computed from its resolved `line-height`, vertical padding, and vertical border-width (with a `1.2 × font-size` fallback when `line-height` resolves to `normal`). The textarea's CSS `resize` property SHALL remain `vertical` so the user retains a manual height override (the JS-driven height runs only on the discrete events listed above; the user's manual drag persists between those events).

Paste detection SHALL listen to BOTH the native `paste` event and any `input` event whose `InputEvent.inputType === "insertFromPaste"`. The two paths converge into a single `requestAnimationFrame`-batched recompute, so a browser that fires both within the same frame triggers exactly one measurement.

#### Scenario: Long persisted draft is fully visible on mount

- **WHEN** `ChatInput.vue` mounts in a `(series, story)` whose `sessionStorage` key holds a 20-line draft
- **THEN** after the persisted text is restored, the textarea's measured `clientHeight` SHALL be tall enough to render every line of the draft without internal scrolling, and SHALL be at least the three-line floor

#### Scenario: Multi-line paste expands the textarea

- **WHEN** the user pastes a clipboard payload containing 15 newline-separated lines into the chat textarea
- **THEN** after the next animation frame the textarea's `clientHeight` SHALL be at least the three-line floor AND large enough to render all 15 lines without internal scrolling

#### Scenario: Programmatic appendText triggers growth

- **WHEN** the parent calls the exposed `appendText("…20-line block…")` method
- **THEN** after the next animation frame the textarea's `clientHeight` SHALL grow to accommodate the new content

#### Scenario: Single-character keystroke does not change height

- **WHEN** the user types a single non-newline character into a textarea that is already sized to the three-line floor
- **THEN** the textarea's `clientHeight` SHALL remain at the three-line floor (no auto-grow on per-keystroke input)

#### Scenario: Three-line floor is preserved for an empty draft

- **WHEN** the textarea mounts with an empty persisted draft
- **THEN** the textarea's `clientHeight` SHALL equal the three-line floor (computed from the resolved `line-height`, vertical padding, and vertical border-width)

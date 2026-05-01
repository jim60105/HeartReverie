## ADDED Requirements

### Requirement: `{{ message }}` custom Vento tag

The server SHALL register a Vento plugin (installed on the shared `Environment` via `ventoEnv.use(...)`) that introduces a block-style custom tag pair `{{ message <role-expression> }} … {{ /message }}`. The opening tag MAY take either a double-quoted string literal whose value is one of `"system"`, `"user"`, `"assistant"`, or a bare identifier whose runtime value SHALL be one of those three role strings. The tag's inner content SHALL be compiled by Vento exactly like any other block body — variable interpolation, `{{ if }}`, `{{ for }}`, pipe filters, plugin-injected fragments, and lore variables SHALL all work inside the body.

The tag SHALL NOT append its rendered content to the parent output stream as text. Instead, the tag SHALL push a `{ role: <validated-role>, content: <rendered-inner-content> }` object onto a side-channel array that lives on the data object passed to `runString` (the array SHALL be reachable as `__messages` on the data context). The tag SHALL also append a per-render unique sentinel string of the form `\u0000MSG_<nonce>_<index>\u0000` to the parent output, where `<nonce>` is a UUID generated once per render and propagated via the data context (`__msgNonce`), and `<index>` is the zero-based position of the message in the side-channel array at insertion time.

#### Scenario: Tag with string-literal role
- **WHEN** a template contains `{{ message "user" }}{{ user_input }}{{ /message }}` and `user_input` is `"hello"`
- **THEN** after rendering the side-channel buffer SHALL contain `[{ role: "user", content: "hello" }]`
- **AND** the rendered output stream SHALL contain a sentinel `\u0000MSG_<nonce>_0\u0000` at the position the tag occupied

#### Scenario: Tag with identifier role
- **WHEN** a template contains `{{ message dynamic_role }}body{{ /message }}` and the data context has `dynamic_role: "assistant"`
- **THEN** the side-channel buffer SHALL contain `[{ role: "assistant", content: "body" }]`

#### Scenario: Variable interpolation inside body
- **WHEN** a template contains `{{ message "system" }}Persona: {{ persona_name }}{{ /message }}` and `persona_name` is `"Aria"`
- **THEN** the captured message content SHALL be `"Persona: Aria"`

#### Scenario: Control flow inside body
- **WHEN** a template contains `{{ message "user" }}{{ if isFirstRound }}first{{ else }}again{{ /if }}{{ /message }}` and `isFirstRound` is `true`
- **THEN** the captured message content SHALL be `"first"`

#### Scenario: For-loop emitting multiple messages
- **WHEN** a template contains `{{ for ex of examples }}{{ message "user" }}{{ ex.q }}{{ /message }}{{ message "assistant" }}{{ ex.a }}{{ /message }}{{ /for }}` and `examples` has two entries
- **THEN** the side-channel buffer SHALL contain four messages in iteration order, alternating `user` / `assistant`

### Requirement: Role validation

The tag SHALL validate roles against the allow-list `{"system", "user", "assistant"}`. The validation strategy depends on the role expression's syntactic shape:
- **String-literal roles**: validated at COMPILE time inside the tag handler. An invalid literal SHALL cause `env.compileTokens` / the tag's compile function to throw a Vento `SourceError` carrying `multi-message:invalid-role` and the offending tag's source position. No JS is emitted for an invalid literal.
- **Identifier (variable) roles**: validated at RUNTIME inside the emitted JS. An identifier resolving to a value outside the allow-list SHALL throw a `multi-message:invalid-role` error from the compiled function, which propagates out of `runString` and is caught by `renderSystemPrompt()`'s existing try/catch.

Both paths SHALL surface to the caller through the same `multi-message:invalid-role` Vento-error variant.

#### Scenario: Invalid string-literal role
- **WHEN** a template contains `{{ message "sytsem" }}body{{ /message }}` (typo)
- **THEN** template compilation SHALL fail with a `multi-message:invalid-role` `SourceError` referencing the offending tag's source position; no rendering attempt SHALL occur

#### Scenario: Invalid identifier-resolved role
- **WHEN** the role identifier resolves at runtime to a value not in the allow-list (e.g. `null`, `""`, `"tool"`)
- **THEN** rendering SHALL fail with the same `multi-message:invalid-role` error and the offending value SHALL appear in the error detail

### Requirement: Nested `{{ message }}` rejection

The tag handler SHALL reject nested `message` blocks at COMPILE time by scanning the body token slice (between the opener and the matching `/message`) before invoking `compileTokens`. If another `message` opener appears in the body before the matching closer, the tag handler SHALL throw a Vento `SourceError` carrying `multi-message:nested` and the inner opener's source position. Compile-time detection ensures nested tags are rejected even when they appear inside `{{ if }}` branches that would never execute.

#### Scenario: Nested tags rejected
- **WHEN** a template contains `{{ message "system" }}outer{{ message "user" }}inner{{ /message }}{{ /message }}`
- **THEN** template compilation SHALL fail with a `multi-message:nested` `SourceError` referencing the inner tag's source position

#### Scenario: Nested tags inside an inactive branch still rejected
- **WHEN** a template contains `{{ message "system" }}outer{{ if false }}{{ message "user" }}inner{{ /message }}{{ /if }}{{ /message }}`
- **THEN** template compilation SHALL still fail with `multi-message:nested` (compile-time scanning does not respect runtime branch evaluation)

### Requirement: Post-render assembly into `ChatMessage[]`

After `runString()` resolves, the server SHALL run a `splitRenderedMessages()` post-processor that:
- Reads the per-render `nonce`, the side-channel `messages` buffer, and the rendered string returned by Vento.
- Splits the rendered string by the regex `/\u0000MSG_<nonce>_(\d+)\u0000/g`, walking matches and intervening text segments in source order.
- For each match, validates the captured index is an integer within the buffer's bounds and that the buffer slot has not already been consumed; replaces the match with the `{role, content}` taken from the buffer at the captured index.
- Treats each non-empty intervening text segment as a `{role: "system", content: <segment-trimmed>}` message.
- Coalesces any run of adjacent `system` messages (after assembly) into a single `system` message whose `content` is the concatenation of the run's contents joined with a single `"\n"`.
- Discards segments that contain only whitespace.
- Returns the final `ChatMessage[]`.

If the rendered string contains a sentinel whose index is out-of-bounds or duplicate, `splitRenderedMessages()` SHALL throw a `multi-message:assembly-corrupt` error rather than silently mis-rendering.

#### Scenario: Top-level text becomes leading system message
- **WHEN** a template renders to `"persona block\n<sentinel>"` where the sentinel resolves to a `user`-role message `"hi"`
- **THEN** `splitRenderedMessages()` SHALL return `[{role: "system", content: "persona block"}, {role: "user", content: "hi"}]`

#### Scenario: Multiple top-level segments coalesced
- **WHEN** a template emits text-A, then a `user` message, then text-B, then text-C, then an `assistant` message, then text-D
- **THEN** the assembled array SHALL be `[{system: "text-A"}, {user: ...}, {system: "text-B\ntext-C"}, {assistant: ...}, {system: "text-D"}]`

#### Scenario: Adjacent system messages coalesced
- **WHEN** a template emits a top-level text segment immediately followed by `{{ message "system" }}explicit{{ /message }}` with no other markup between them
- **THEN** the resulting array SHALL contain a single `system` message whose content is the joined concatenation, NOT two separate system messages

#### Scenario: Adjacent same-role non-system messages preserved
- **WHEN** a template emits `{{ message "user" }}A{{ /message }}{{ message "user" }}B{{ /message }}`
- **THEN** the resulting array SHALL contain two distinct `user` messages, in order

#### Scenario: Whitespace-only segments dropped
- **WHEN** the only top-level text between two `{{ message }}` blocks is whitespace (newlines / spaces)
- **THEN** that segment SHALL NOT produce a system message

#### Scenario: Sentinel-at-start, sentinel-at-end, adjacent sentinels, no sentinels
- **WHEN** the rendered string is exactly a sentinel with no surrounding text, OR begins/ends with a sentinel, OR contains two adjacent sentinels with no text between, OR contains no sentinels at all
- **THEN** `splitRenderedMessages()` SHALL produce the corresponding correct sequence (no spurious empty system messages, no missing buffer entries, and a single system message when the rendered string is non-whitespace text with no sentinels)

#### Scenario: Corrupted sentinel index rejected
- **WHEN** the rendered string contains a sentinel whose captured numeric index does not correspond to an entry in the side-channel buffer (e.g. forged or out-of-range)
- **THEN** `splitRenderedMessages()` SHALL throw `multi-message:assembly-corrupt` rather than producing a partial or mis-indexed `ChatMessage[]`

### Requirement: At least one user-role message required

After assembly, the resulting `ChatMessage[]` MUST contain at least one element with `role: "user"`. If it does not, the server SHALL surface a `multi-message:no-user-message` Vento error and SHALL NOT call the upstream LLM API. (Note: this requirement does NOT mandate that the user message be the LAST element — templates that intentionally end with an `assistant` priming turn followed by streaming continuation are out of scope for v1; authors should normally place the live user turn last in `system.md`.)

Additionally, after assembly, every message in the resulting `ChatMessage[]` MUST have non-whitespace `content`. If any message has `content.trim().length === 0`, the server SHALL surface a `multi-message:empty-message` Vento error and SHALL NOT call the upstream LLM API. (Whitespace-only `system` blocks are already silently dropped by `splitRenderedMessages()` and therefore never reach this check; the check primarily catches empty author-emitted `user` and `assistant` blocks that would otherwise waste tokens or be rejected by the upstream chat API.)

#### Scenario: No user message in result
- **WHEN** the assembled `ChatMessage[]` contains only `system` and/or `assistant` messages
- **THEN** the server SHALL return a 422 RFC 9457 Problem Details error with `type` derived from `multi-message:no-user-message` and SHALL NOT issue an upstream `fetch` to the LLM API

#### Scenario: Empty result
- **WHEN** the assembled `ChatMessage[]` is empty (e.g. template renders only whitespace and emits no `{{ message }}` blocks)
- **THEN** the server SHALL surface the same `multi-message:no-user-message` error

#### Scenario: Empty or whitespace-only message content
- **WHEN** the assembled `ChatMessage[]` contains a `user` or `assistant` message whose `content.trim().length === 0` (e.g. `{{ message "user" }}{{ /message }}` or `{{ message "assistant" }}   {{ /message }}`)
- **THEN** the server SHALL return a 422 RFC 9457 Problem Details error with `type` derived from `multi-message:empty-message` and SHALL NOT issue an upstream `fetch` to the LLM API

### Requirement: Per-render nonce isolation

The render pipeline SHALL generate a fresh nonce (using `crypto.randomUUID()`) for each call to `renderSystemPrompt()` and store it together with the side-channel message buffer on the per-render data context as a single nested object `__messageState: { nonce: string; messages: ChatMessage[] }`. Sentinels from one render SHALL NOT be interpreted by another render's `splitRenderedMessages()` call. The `__messageState` object SHALL be a fresh object per render, never a shared module-level singleton. The internal name `__messageState` SHALL NOT be reachable through the SSTI whitelist — `validateTemplate()` SHALL reject any expression containing an identifier token whose name begins with `__` (the double-underscore prefix is reserved for internal side-channel state), preventing user-supplied templates from reading the nonce or forging sentinels in any expression shape (bare identifier, pipe chain, `if`/`for`/`message` operand, or index access).

#### Scenario: Concurrent renders are isolated
- **WHEN** two `renderSystemPrompt()` calls execute concurrently with overlapping content
- **THEN** each call SHALL receive its own nonce and its own `__messages` buffer, and the assembled `ChatMessage[]` for each SHALL contain only its own messages

#### Scenario: User content containing the sentinel pattern
- **WHEN** a user input or chapter contains a literal NUL byte followed by `MSG_` followed by digits and another NUL byte (i.e. an arbitrary collision attempt)
- **THEN** because the literal text uses a different (or no) UUID than the per-render nonce, the assembler SHALL NOT match it as a sentinel and SHALL preserve it inside the corresponding system message content

### Requirement: SSTI whitelist for user-supplied templates

The `validateTemplate()` SSTI whitelist (used for user-provided template overrides via the Prompt Editor) SHALL accept the following additional expressions:
- `^message\s+"(system|user|assistant)"$` — opening tag with a string-literal role
- `^message\s+[a-zA-Z_]\w*$` — opening tag with a bare identifier role
- `^/message$` — closing tag

The whitelist SHALL NOT permit any other expressions in the role slot (no pipes, no function calls, no property access). Templates that use any other shape for `message` SHALL be rejected with the existing `Unsafe template expression` error.

#### Scenario: Literal-role opening tag accepted
- **WHEN** a user-uploaded template contains `{{ message "user" }}…{{ /message }}`
- **THEN** `validateTemplate()` SHALL return an empty error array

#### Scenario: Identifier-role opening tag accepted
- **WHEN** a user-uploaded template contains `{{ message dynamic_role }}…{{ /message }}`
- **THEN** `validateTemplate()` SHALL return an empty error array

#### Scenario: Disallowed role expression rejected
- **WHEN** a user-uploaded template contains `{{ message foo() }}…{{ /message }}` or `{{ message obj.role }}…{{ /message }}`
- **THEN** `validateTemplate()` SHALL return a non-empty error array including an `Unsafe template expression` entry for the opening tag

### Requirement: Plugin compatibility

The `{{ message }}` tag SHALL compose with the existing plugin contract without changes to plugin manifest schemas or hook signatures:
- The existing `prompt-assembly` plugin hook SHALL continue to populate the `plugin_fragments` array (string array of fragment bodies). Template authors who want a plugin's fragment to belong to a specific role wrap the rendering loop (e.g. `{{ for fragment of plugin_fragments }}{{ message "system" }}{{ fragment }}{{ /message }}{{ /for }}`) inside `system.md`.
- Vento renders `{{ fragment }}` interpolation as plain text (`output += fragment`); the fragment string SHALL NOT be re-parsed as Vento source. A plugin author CANNOT emit a discrete `{{ message }}` block by including the tag characters inside its fragment body — those characters render literally. Plugins requiring richer injection SHALL use the existing dynamic-variables mechanism instead.
- No new plugin lifecycle hook is introduced by this capability.

#### Scenario: Plugin fragment wrapped by template
- **WHEN** the template wraps the `plugin_fragments` for-loop in `{{ message "system" }}…{{ /message }}` and a plugin contributes a plain-text fragment
- **THEN** the assembled output SHALL include the fragment inside a `system` message produced by the wrapping tag

#### Scenario: Fragment-embedded message tag is rendered literally
- **WHEN** a plugin's `prompt-assembly` handler returns a fragment whose content is `"{{ message \"user\" }}few-shot question{{ /message }}"` and the template renders it as `{{ fragment }}`
- **THEN** the rendered output SHALL contain the literal characters `{{ message "user" }}…{{ /message }}` (NOT a `user` chat message); the `messages` assembly SHALL NOT include a `user` entry derived from the fragment

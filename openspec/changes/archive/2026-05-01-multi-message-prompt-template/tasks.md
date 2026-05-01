## 1. Types and shared module

- [x] 1.1 Add `ChatMessage` type (`{role: "system"|"user"|"assistant"; content: string}`) to `writer/types.ts` and export it
- [x] 1.2 Update `RenderResult` in `writer/types.ts`: replace `content: string | null` with `messages: ChatMessage[]` (still discriminated against `error: VentoError | null`)
- [x] 1.3 Update `BuildPromptResult` in `writer/types.ts`: replace `prompt: string` with `messages: ChatMessage[]`; keep the existing `ventoError`, `chapterFiles`, `chapters` fields
- [x] 1.4 Update `TemplateEngine.renderSystemPrompt` signature in `writer/types.ts` and any related interface declarations to match the new return type
- [x] 1.5 Update `StoryEngine.buildPromptFromStory` signature and `RenderOptions` if any field becomes unused

## 2. Vento `{{ message }}` plugin

- [x] 2.1 Create `writer/lib/vento-message-tag.ts` with the AGPL-3.0-or-later license header
- [x] 2.2 Implement the Vento plugin function (`messageTagPlugin`) that pushes a `messageTag` opening compiler and a closer to `env.tags`, modelled after `node_modules/ventojs/plugins/layout.js` (see `slotTag` for the inner-content compile pattern)
- [x] 2.3 In `messageTag`: parse the role expression at compile time. If the expression is a string literal, validate against `"system"|"user"|"assistant"` and throw a Vento `SourceError("multi-message:invalid-role")` (with source position) for any other literal — do NOT defer literal-typo detection to runtime. If the expression is a bare identifier, accept it at compile time and emit runtime validation. Reject any other shape (function calls, member access, etc.) with a `SourceError`.
- [x] 2.3a Detect nested `{{ message }}` blocks at COMPILE time: before invoking `compileTokens`, scan the body token slice up to the matching `/message` and reject if another `message` opener appears first; throw `SourceError("multi-message:nested")` with the inner opener's source position. Do NOT rely on a runtime depth counter (it would silently accept nesting under inactive `{{ if }}` branches and report wrong positions).
- [x] 2.4 Compile inner tokens via `env.compileTokens(tokens, env.getTempVariable(...) ?? "__msg_content_<n>", "/message")` (use a Vento-supplied unique temp name when available to avoid collisions); emit JS that pushes `{role, content}` onto `${dataVarname}.__messageState.messages` and appends `\u0000MSG_${${dataVarname}.__messageState.nonce}_${idx}\u0000` to the parent output. Hide all internal state behind a single `__messageState: { nonce, messages }` object so the SSTI whitelist (which only allows simple identifiers, not property access) cannot let a user template read or forge the nonce.
- [x] 2.5 At runtime in the emitted JS for identifier-role bodies, validate the role against the allow-list and `throw new Error("multi-message:invalid-role: " + role)` if it fails. (String-literal roles are already rejected at compile time per 2.3 — no runtime check needed.)
- [x] 2.6 Implement and export `splitRenderedMessages(rendered: string, nonce: string, buffer: ChatMessage[]): ChatMessage[]` per the design (regex split, segment classification, system-coalescing, whitespace-only drop). Validate that every captured sentinel index is an integer within `buffer` bounds; on mismatch throw `multi-message:assembly-corrupt`.
- [x] 2.7 Export a small helper `assertHasUserMessage(messages: ChatMessage[])` that throws a tagged error (`multi-message:no-user-message`) when no `user`-role element exists; called from the template engine after assembly
- [x] 2.8 Add JSDoc to all exports

## 3. Template engine wiring

- [x] 3.1 In `writer/lib/template.ts::createTemplateEngine`, call `ventoEnv.use(messageTagPlugin())` once at construction time
- [x] 3.2 In `renderSystemPrompt()`: generate `const __messageState = { nonce: crypto.randomUUID(), messages: [] as ChatMessage[] }` and pass it as a single hidden field on the data context for `runString` (NOT as separate top-level `__msgNonce` / `__messages` simple variables — those would be readable through the SSTI whitelist).
- [x] 3.3 After `runString` resolves, call `splitRenderedMessages(result.content, __messageState.nonce, __messageState.messages)` to produce the assembled array
- [x] 3.4 Call `assertHasUserMessage(messages)` and convert any throw into a Vento error via `buildVentoError()`
- [x] 3.5 Return `{ messages, error: null }` on success; `{ messages: [], error }` on any failure path
- [x] 3.6 Update the existing debug log to log the assembled `messages.length` and per-role counts instead of the rendered string length

## 4. Error handling

- [x] 4.1 Extend `writer/lib/errors.ts::buildVentoError` (or a sibling helper) to recognise the four new error tags: `multi-message:invalid-role`, `multi-message:nested`, `multi-message:no-user-message`, `multi-message:assembly-corrupt`
- [x] 4.2 Each variant SHALL produce a structured `VentoError` with `title`, `message`, `templateFile`, optional `line`, and a role-specific `suggestion` (e.g. for `no-user-message`: "Add a `{{ message \"user\" }}{{ user_input }}{{ /message }}` block")
- [x] 4.3 Verify the existing `VentoErrorCard.vue` consumer renders the new `suggestion` text without changes (props are already strings)

## 5. SSTI whitelist

- [x] 5.1 Extend `validateTemplate()` in `writer/lib/template.ts` to accept the three new patterns: `^message\s+"(system|user|assistant)"$`, `^message\s+[a-zA-Z_]\w*$`, `^/message$`
- [x] 5.2 Add unit tests in `tests/writer/lib/template_test.ts` covering accepted shapes (literal role, identifier role, closer) and rejected shapes (`message foo()`, `message obj.role`, `message`, `message ""`)

## 6. Story / chat wiring

- [x] 6.1 Update `writer/lib/story.ts::buildPromptFromStory` to consume `RenderResult.messages` and propagate as `BuildPromptResult.messages`
- [x] 6.2 Update `writer/lib/chat-shared.ts::executeChat` to:
  - Read `messages` (not `prompt`) from `buildPromptFromStory`
  - Use those messages verbatim as the upstream LLM request body's `messages`
  - Drop the hard-coded `[{role: "system", content: prompt}, {role: "user", content: message}]` array
  - Drop `systemPromptLength`/`userMessageLength` debug fields; replace with `messageCount` and a per-role count map
- [x] 6.3 Update LLM-interaction-log entries (`llmLog.info`) to log the assembled `messages` array (already serialisable JSON) in place of `systemPrompt` / `userMessage`
- [x] 6.4 Audit `writer/routes/prompt.ts` (preview endpoint) to return `{ messages: ChatMessage[], variables }` and remove any legacy `prompt: string` field
- [x] 6.5 Audit `writer/routes/ws.ts` (chat:send / chat:resend) for any path that referenced a single `prompt` string

## 7. Default `system.md`

- [x] 7.1 Rewrite the **code-shipped fallback** at `/system.md` (repo root, loaded by `readTemplate()` when `PROMPT_FILE` is absent or unreadable) to use `{{ message }}` blocks. This is REQUIRED so container deployments where `playground/` is volume-mounted (and may shadow or omit the example file) still boot with a template that emits a `user` message.
- [x] 7.1a Also rewrite the example `playground/_prompts/system.md` to match. (Per AGENTS.md, `playground/` is user data — but this specific example file is repo-tracked: confirm with `git ls-files playground/_prompts/system.md` before editing; if untracked, ship a code-shipped default helper `writer/lib/default-system-template.ts` instead and add it to readTemplate's fallback chain.) — Verified untracked (only `playground/_prompts/.gitignore` is committed); requirement satisfied by the code-shipped fallback at `/system.md` (root) which `readTemplate()` loads when `PROMPT_FILE` is absent.
- [x] 7.2 Both rewrites SHALL: wrap persona/lore/world-building inside `{{ message "system" }}…{{ /message }}`; wrap the `previous_context` for-loop in either system or alternating user/assistant blocks (designer's choice); end with the live turn as `{{ message "user" }}<inputs>{{ user_input }}</inputs>{{ /message }}`.
- [x] 7.3 Verify the rewritten templates still satisfy all `vento-prompt-template` requirements (chapter wrapping, `<start_hints>` conditional, status block, plugin fragments) AND pass the new server-side `assertHasUserMessage` check.

## 8. Frontend prompt preview

- [x] 8.1 Update `reader-src/src/types/index.ts` to add a `ChatMessage` type and update the prompt-preview API response type
- [x] 8.2 Update `reader-src/src/components/PromptPreview.vue` to render the `messages` array as a list of cards (one per message), with a clear role badge, monospace content, and a stable role-coloured border
- [x] 8.3 Update `reader-src/src/composables/usePromptEditor.ts` (or whichever composable owns the preview fetch) to consume the new shape
- [x] 8.4 Verify `VentoErrorCard.vue` still renders the new `multi-message:*` errors as expected (no code change anticipated)

## 9. Backend tests

- [x] 9.1 Create `tests/writer/lib/vento_message_tag_test.ts` covering: literal role, identifier role, variable interpolation inside body, `{{ for }}` emitting multiple messages, invalid string-literal role rejected at COMPILE time (with source position), invalid identifier role rejected at runtime, nested `{{ message }}` inside `{{ if }}`/`{{ for }}`/inactive branches all rejected at compile time, `splitRenderedMessages` output for top-level interleaving / system coalescing / whitespace-only drop / sentinel-at-start / sentinel-at-end / adjacent sentinels / no-sentinels / corrupted-sentinel-index, and per-render nonce isolation (two concurrent `renderSystemPrompt` calls)
- [x] 9.1a Add a test asserting that a user template containing `{{ __messageState }}` or `{{ __messageState.nonce }}` is REJECTED by `validateTemplate()` (the SSTI whitelist must not expose the message-state object)
- [x] 9.2 Update `tests/writer/lib/template_test.ts` (or the equivalent existing file) to assert the new `RenderResult.messages` shape
- [x] 9.3 Update ALL chat-handler tests in `tests/writer/routes/` that asserted the legacy two-message hard-coded `messages` array. Confirmed affected files: `tests/writer/routes/chat_test.ts`, `tests/writer/routes/ws_test.ts`, `tests/writer/routes/prompt_test.ts`, and `tests/writer/lib/chat_shared_*_test.ts`. Replace `{ prompt }` stubs with `{ messages }` and update upstream-request capture assertions accordingly.
- [x] 9.4 Add a regression test: a template that emits no `user` message produces a 422 RFC 9457 Problem-Details response with `type` derived from `multi-message:no-user-message`
- [x] 9.5 Run `deno task test:backend` and resolve all failures

## 10. Frontend tests

- [x] 10.1 Update `reader-src/src/components/__tests__/PromptPreview.test.ts` and `reader-src/src/composables/__tests__/usePromptEditor-preview.test.ts` (and any related tests) to assert the new `messages: ChatMessage[]` shape in `PromptPreviewResult` and per-message-card rendering. Update `reader-src/src/types/index.ts` (`PromptPreviewResult`) accordingly.
- [x] 10.2 Run `deno task test:frontend` and resolve all failures

## 11. Documentation

- [x] 11.1 Update `docs/prompt-template.md`: add the `{{ message }}` tag section with syntax, allowed roles, nesting rule, ordering / coalescing semantics, error variants, and a worked multi-turn example
- [x] 11.2 Update the variable list in `docs/prompt-template.md` to remove obsolete entries (the existing spec already lists them; just keep it in sync)
- [x] 11.3 Update the "Prompt Rendering Pipeline" section in `AGENTS.md` to mention the message-tag plugin and the new "template owns the messages array" rule
- [x] 11.4 Update `docs/plugin-system.md` (or its successor) with the plugin-author guidance: fragments are interpolated as plain text and CANNOT contain `{{ message }}` tags; if a plugin needs role-specific injection, the template author wraps the `plugin_fragments` for-loop in a `{{ message }}` block, OR the plugin uses the existing dynamic-variables mechanism.

## 12. End-to-end smoke

- [ ] 12.1 Rebuild the dev container via `bash scripts/podman-build-run.sh` and start it
- [ ] 12.2 In the Prompt Editor: load the new default `system.md`, click Preview, verify the preview shows multiple per-message cards with correct roles
- [ ] 12.3 Send a chat message in an existing test story, verify a chapter is generated normally and that the LLM-interaction log now records the multi-message request shape
- [ ] 12.4 Submit an intentionally broken template (e.g. with `{{ message "tool" }}…{{ /message }}`) via the Prompt Editor and verify `VentoErrorCard` shows the `multi-message:invalid-role` suggestion
- [ ] 12.5 Submit a template with no `{{ message "user" }}` block and verify the chat returns the `multi-message:no-user-message` error end-to-end (toast or error card, depending on path)

## 13. Lint, validate, and final pass

- [x] 13.1 Run `deno task lint` (or equivalent) and resolve issues introduced by the change
- [x] 13.2 Run `openspec validate multi-message-prompt-template --strict` and confirm the change still validates
- [x] 13.3 Update `tasks.md` checkboxes as work progresses (this file)

## 14. Final critique

- [ ] 14.1 Run a single sync rubber-duck critique with `gpt-5.5` covering the implementation against the spec; address blocking findings

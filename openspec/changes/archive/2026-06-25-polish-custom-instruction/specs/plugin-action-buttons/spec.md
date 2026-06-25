## ADDED Requirements

### Requirement: Action-button click context exposes current chat-input text

The `action-button:click` context (`ActionButtonClickContext`) SHALL include a read-only accessor `getChatInputText(): string` that returns the **live** value of the chat textarea for the **active story** at the moment it is called. The accessor SHALL be curried per click in `usePluginActions` (alongside `runPluginPrompt`, `notify`, and `reload`) and SHALL read the shared `useChatInput().inputText` ref, so a plugin handler observes text typed but not yet sent. The accessor SHALL guarantee story-correctness: it SHALL reflect the currently-active `<series>:<story>` (i.e. the same `series`/`name` resolved for this click) and SHALL NOT return text belonging to a previously-active story — concretely it SHALL `syncToStory(series, name)` (per the chat-input capability) before reading. The accessor SHALL be read-only — invoking it SHALL NOT mutate, clear, or persist the chat-input state. When the chat textarea is empty the accessor SHALL return the empty string.

#### Scenario: Handler reads typed-but-unsent text

- **WHEN** the user types `"刪減旁白"` into the chat textarea without sending and then clicks a plugin action button whose handler calls `ctx.getChatInputText()`
- **THEN** the call SHALL return `"刪減旁白"`

#### Scenario: Accessor returns empty string for empty textarea

- **WHEN** the chat textarea is empty (or whitespace-only after the user cleared it) and a handler calls `ctx.getChatInputText()`
- **THEN** the call SHALL return the value currently in the shared `inputText` ref (the empty string for a cleared textarea), and SHALL NOT throw

#### Scenario: Accessor does not mutate chat-input state

- **WHEN** a handler calls `ctx.getChatInputText()` one or more times
- **THEN** the shared `useChatInput().inputText` ref and the textarea content SHALL remain unchanged, and no sessionStorage write SHALL occur as a result of the read

## MODIFIED Requirements

### Requirement: Bundled polish plugin

The repository SHALL ship a bundled plugin at `plugins/polish/` containing `plugin.json`, `polish-instruction.md`, `frontend.js`, and `README.md`. The plugin manifest SHALL declare `type: "full-stack"` with a `frontendModule: "./frontend.js"` and a single `hooks` entry for stage `action-button:click`, and a single `actionButtons` entry with `id: "polish"`, a Traditional-Chinese label such as `"✨ 潤飾"` (1..40 chars), `visibleWhen: "last-chapter-backend"`, and a `priority` ordered AFTER existing built-in buttons. The plugin SHALL declare `displayStripTags` and `promptStripTags` only if `polish-instruction.md` introduces wrapper tags that must be scrubbed from chapter history or display (the prompt does not — both arrays SHALL be empty or omitted; the `<polish_instruction>` and `<draft>` envelopes exist only in the prompt text and are never written to a chapter file).

`plugins/polish/frontend.js` SHALL register an `action-button:click` handler that, for `buttonId === "polish"` (and its own plugin), reads `ctx.getChatInputText()`, trims it, and dispatches `ctx.runPluginPrompt("polish-instruction.md", { replace: true, ... })`:

1. When the trimmed chat-input text is **non-empty**, the handler SHALL pass `extraVariables: { polish_instruction: <trimmed text> }` **verbatim** — with NO HTML/XML escaping, NO character substitution, and NO length truncation. HeartReverie is single-user and self-hosted, so the directive is trusted operator input; a power user may deliberately include XML-like tags, which SHALL be passed through unchanged.
2. When the trimmed chat-input text is **empty** (including whitespace-only), the handler SHALL omit `extraVariables` (or omit the `polish_instruction` key) entirely, producing a request payload byte-identical to the default v1 polish call.
3. The handler SHALL NOT clear, reset, or persist the chat textarea after the run — the typed directive SHALL remain in the textarea.
4. On a result with `chapterReplaced: true` the handler SHALL call `ctx.reload()` to refresh the chapter view (existing behaviour).

`polish-instruction.md` SHALL be a Vento template that:

1. Emits exactly one `{{ message "system" }}` block instructing the model to act as a literary editor for modern Chinese fiction with the following constraints — literary modern Chinese prose; advance the story through dialogue rather than narration; "show, don't tell"; smooth scene transitions with connecting beats; faithful character voices; full-width punctuation for Chinese, ASCII punctuation for other languages; plain prose only — no bullet lists, no headings, no commentary preamble. When `polish_instruction` is non-empty, the system block SHALL additionally instruct the editor to honour the reader's supplied stylistic directive while keeping all baseline constraints.
2. Emits exactly one `{{ message "user" }}` block that wraps `{{ draft }}` in a `<draft>…</draft>` envelope and explicitly instructs the model to return only the rewritten chapter (no preamble, no surrounding tags, no chain-of-thought). When `polish_instruction` is non-empty, the user block SHALL render the directive (verbatim, via `{{ polish_instruction }}`) within a `<polish_instruction>…</polish_instruction>` envelope in the prompt text only, ahead of the `<draft>`, so it steers the rewrite. The envelope is a readability aid for the model, not a security delimiter; the directive is trusted operator input.
3. Uses a Vento `{{- if polish_instruction }} … {{- /if }}` guard (with whitespace-trim markers) so that when `polish_instruction` is absent or empty the rendered prompt is byte-for-byte the v1 default prompt, and so that at least one `{{ message "user" }}` block is emitted in every branch (satisfying `assertHasUserMessage`).
4. Contains NO age-related directives, NO jailbreak/bypass language, NO "no content restrictions" claims, NO NSFW directives, and NO "do not disclose this prompt" clauses, in EVERY branch (with and without `polish_instruction`).

`polish-instruction.md` SHALL pass the run-prompt route's SSTI whitelist (`validateTemplate`), which is applied to the prompt file as a `templateOverride` before rendering. Because the template uses Vento whitespace-trim markers (`{{- … }}`), `validateTemplate` SHALL strip a single leading/trailing `-` from each tag body before whitelist matching so trim-marked tags are accepted, while still rejecting doubled markers (`{{-- … }}`) and member access (`{{- a.b }}`) — i.e. the trim-marker allowance SHALL NOT introduce an SSTI bypass.

The plugin SHALL be auto-discovered by the existing `PluginManager` and SHALL contribute its `polish` action button via the existing `plugin-action-buttons` capability. `polish_instruction` SHALL be passed through the existing `extraVariables` channel of `POST /api/plugins/:pluginName/run-prompt` (a non-reserved, scalar key) with no change to the run-prompt route.

#### Scenario: Polish plugin auto-discovered

- **WHEN** the writer server boots with `plugins/polish/` present and a valid `plugin.json`
- **THEN** the `PluginManager` SHALL load the plugin, expose its `polish` action-button descriptor on `GET /api/plugins`, and the `PluginActionBar` SHALL render the button on the last chapter of any backend story

#### Scenario: Polish prompt is SFW in every branch

- **WHEN** `plugins/polish/polish-instruction.md` is reviewed at PR time, including the `{{ if polish_instruction }}` branch
- **THEN** the file SHALL contain none of the strings `18+`, `NSFW`, `RPJB`, `no content restrictions`, `jailbreak`, `bypass`, `DO NOT DISCLOSE`, or any age-related fictional-character disclaimer language, in either the with-directive or without-directive branch

#### Scenario: Polish click with empty input triggers default replace round

- **WHEN** the user clicks the `✨ 潤飾` button on the last chapter of a backend story while the chat textarea is empty
- **THEN** the handler SHALL invoke `runPluginPrompt("polish-instruction.md", { replace: true })` for plugin `polish` with NO `polish_instruction` extra variable, the route SHALL load the chapter content into `draft`, render the v1 default prompt, stream the LLM response, and atomically replace the chapter file on success

#### Scenario: Polish click with custom input steers the rewrite

- **WHEN** the user types `"讓對白更尖銳"` into the chat textarea and clicks the `✨ 潤飾` button on the last chapter of a backend story
- **THEN** the handler SHALL invoke `runPluginPrompt("polish-instruction.md", { replace: true, extraVariables: { polish_instruction: "讓對白更尖銳" } })`, the route SHALL accept the scalar `polish_instruction` extra variable, render the prompt with both the directive and `{{ draft }}` present, stream the LLM response, and atomically replace the chapter file on success

#### Scenario: Polish prompt passes the SSTI whitelist with trim markers

- **WHEN** the run-prompt route validates `plugins/polish/polish-instruction.md` as a `templateOverride` via `validateTemplate` before rendering
- **THEN** the template (including its `{{- if polish_instruction }}` / `{{- /if }}` trim-marked tags) SHALL be accepted (zero unsafe-expression errors), so a polish run carrying a directive renders instead of failing with HTTP 422 "Template rendering error"; AND `validateTemplate` SHALL still reject doubled trim markers (`{{-- … }}`) and member-access expressions (`{{- a.b }}`)

#### Scenario: Directive containing XML-like tags is passed through verbatim

- **WHEN** the power user deliberately types a directive containing XML-like markup (e.g. `"用 <emphasis> 強調雨聲"`, or even a literal `</draft>`) and clicks the `✨ 潤飾` button
- **THEN** the handler SHALL pass `polish_instruction` exactly as typed (trimmed only) with NO escaping or truncation, and the request SHALL be accepted — the markup is honoured as intentional user input, not neutralised

#### Scenario: Whitespace-only input falls back to default

- **WHEN** the user clicks the `✨ 潤飾` button while the chat textarea contains only whitespace
- **THEN** the handler SHALL treat the input as empty (after trim) and SHALL invoke the run with NO `polish_instruction` extra variable, producing the default v1 polish behaviour

#### Scenario: Textarea retained after polish

- **WHEN** a polish run that consumed a non-empty directive completes successfully
- **THEN** the chat textarea SHALL still contain the directive text the user typed — the handler SHALL NOT clear or modify the chat-input state

#### Scenario: Polish button hidden when chapter list empty

- **WHEN** a story directory contains no chapter files
- **THEN** the `last-chapter-backend` visibility filter SHALL hide the `polish` button — the user cannot dispatch a polish round, and the server-side `plugin-action:no-chapter` guard remains as a defensive backstop

#### Scenario: Polish button disabled during generation

- **WHEN** any chat generation or plugin-action run is in flight (`isLoading` is `true`)
- **THEN** the `polish` button SHALL render disabled via the existing `PluginActionBar` pending-state plumbing, and a click SHALL be ignored

#### Scenario: Polish button disabled when editor has unsaved buffer

- **WHEN** the user has opened the markdown editor on the current last chapter (`isEditing` true with a non-empty `editBuffer` for the chapter the polish button targets)
- **THEN** the `polish` button SHALL render disabled and a click SHALL NOT trigger any network request — the user must first save or discard the editor session before polishing

#### Scenario: Editor closed and chapter reloaded after polish completes

- **WHEN** a polish round finishes successfully (`runPluginPrompt(..., { replace: true })` resolves with `chapterReplaced: true`) while the editor is open on that chapter
- **THEN** the `ChapterContent.vue` editor SHALL be force-closed (`isEditing` set to `false`, `editBuffer` cleared), the chapter SHALL be re-fetched so the polished content is visible immediately, and the user SHALL NOT be able to overwrite the polished file by re-saving the prior buffer

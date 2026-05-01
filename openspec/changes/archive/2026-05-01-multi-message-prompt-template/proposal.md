## Why

Today the Vento-rendered `system.md` produces a single string that is sent to the LLM as one `system` message. The user's input is delivered to the model **through the Vento variable `{{ user_input }}` interpolated into that system string** (e.g. `<inputs>{{ user_input }}</inputs>` in the default template), and the chat layer ALSO redundantly appends a separate `{role: "user", content: message}` turn after the system message — so the same user input flows through two channels at once and the template author has zero control over how (or whether) the user's words appear as a discrete `user`-role turn.

Prompt engineers need finer control: they want to split prompt fragments across multiple `system`, `user`, and `assistant` turns so they can shape the conversation history (few-shot exemplars, anchored persona turns, scaffolded "as if the model already replied" priming, etc.). Without this, every technique that depends on multi-turn priming has to be hacked through model-side parsing of fenced markers in a single system blob.

This change makes the rendered template the **authoritative source of the entire `messages` array** sent upstream — empowering prompt design without leaking implementation into the chat layer, and eliminating the current duplication of user input across the system prompt and an auto-appended user turn.

## What Changes

- **BREAKING**: `renderSystemPrompt()` returns `{ messages: ChatMessage[]; error: VentoError | null }` instead of `{ content: string | null; error: VentoError | null }`. `RenderResult` becomes message-oriented.
- **BREAKING**: `chat-shared.ts` no longer auto-appends a separate trailing `{role: "user", content: message}` turn. The template is fully responsible for emitting at least one `user`-role message via the new `{{ message }}` tag; `user_input` remains a Vento variable that the author places inside whichever `{{ message }}` block they want (typically a final `{{ message "user" }}…{{ user_input }}…{{ /message }}`). The pre-existing duplication of user input (once via `{{ user_input }}` interpolation into the system prompt, and again as the auto-appended user turn) is therefore removed: there is now a single, template-authored channel for the user's words.
- **BREAKING**: `buildPromptFromStory()` returns `messages: ChatMessage[]` instead of `prompt: string`.
- **NEW**: A custom Vento tag `{{ message "<role>" }} … {{ /message }}` (also accepting an identifier expression: `{{ message role_var }}`) declares a discrete chat message of role `system`, `user`, or `assistant`. Tag content participates in normal Vento rendering (variables, `{{ if }}`, `{{ for }}`, plugin fragments, lore variables) but is captured into a side-channel ordered list of messages and **does not** appear in the main rendered output.
- **NEW**: Top-level rendered content (anything outside any `{{ message }}` block) is interleaved as anonymous `system`-role messages, preserving the lexical order between top-level text and `{{ message }}` blocks via per-render unique sentinels.
- **NEW**: A Vento plugin module `writer/lib/vento-message-tag.ts` registers the `message`/`/message` tag pair (modelled after `ventojs`'s built-in `layout`/`slot` tags) and exposes a `splitRenderedMessages()` post-processor that converts the rendered string + side-channel buffer into the final `ChatMessage[]`.
- **NEW**: Validation rules — role must be `system` | `user` | `assistant`; nested `{{ message }}` blocks are rejected; the final assembled `messages[]` MUST contain at least one user-role message (otherwise upstream LLM call is refused with a `vento` error).
- **NEW**: SSTI whitelist (`validateTemplate()`) is extended to accept `message "..."` / `message <ident>` opening tags and the `/message` closing tag so user-supplied template overrides through the Prompt Editor can use the new feature safely. Adjacent system-role messages (top-level segments + author-emitted system messages that touch each other) are coalesced after assembly to keep the upstream payload compact.
- The default `playground/_prompts/system.md` is rewritten to demonstrate the new tag (e.g. wrapping persona/world-building in `{{ message "system" }}`, recent chapter exemplars in alternating `{{ message "user" }}`/`{{ message "assistant" }}` blocks, and the live user turn in a final `{{ message "user" }}{{ user_input }}{{ /message }}`).
- Documentation (`docs/prompt-template.md`) gains a new section covering the `message` tag, its role validation, ordering semantics, plugin compatibility, and migration from the legacy single-message template (note: no migration path is provided in code — early-stage project, zero users in the wild).

## Capabilities

### New Capabilities

- `vento-message-tag`: The custom `{{ message }}` / `{{ /message }}` Vento tag that declares discrete chat messages, its registration as a Vento plugin, role validation, ordering semantics with top-level content, plugin compatibility, and the server-side post-render assembly of `ChatMessage[]`.

### Modified Capabilities

- `vento-prompt-template`: `renderSystemPrompt()` now returns `messages: ChatMessage[]`; `user_input` is no longer auto-appended outside the template; the template is the authoritative source of the upstream `messages` array; SSTI whitelist accepts the `message` tag.
- `writer-backend`: Chat handler (`chat-shared.ts` over both HTTP and WebSocket transports) sends the template-emitted `messages` array directly to the upstream LLM endpoint with no automatic trailing user turn; a missing user-role message becomes a 422 Vento error.
- `vento-template-docs`: Documentation gains the `message` tag reference (syntax, role validation, ordering, plugin guidance) and updates the rendered-prompt examples to show the multi-message output.
- `vento-error-handling`: New error variants — `multi-message:invalid-role`, `multi-message:nested`, `multi-message:no-user-message`, `multi-message:assembly-corrupt` — are surfaced through `buildVentoError()` with the same RFC 9457 Problem Details shape as existing template errors.

## Impact

- **Code (backend)**:
  - `writer/lib/template.ts` — install message-tag plugin on the Vento environment; update return type; integrate post-render assembly.
  - `writer/lib/vento-message-tag.ts` (new) — Vento plugin (custom tag) + sentinel-based assembler + role validator.
  - `writer/lib/story.ts::buildPromptFromStory` — propagate `messages` instead of `prompt`.
  - `writer/lib/chat-shared.ts` — consume `messages` array directly, drop the hard-coded user message append, keep token-usage / abort / streaming behaviour.
  - `writer/lib/errors.ts` — extend `buildVentoError()` for new error variants.
  - `writer/types.ts` — `ChatMessage` shared type, updated `RenderResult` / `RenderOptions` / `BuildPromptResult` signatures, updated `TemplateEngine` interface.
  - `writer/routes/prompt.ts` (preview endpoint) — return rendered messages (or a debug rendering of them) so the Prompt Editor preview reflects the new structure.

- **Code (frontend)**:
  - `reader-src/src/components/PromptPreview.vue` and `useMarkdownRenderer` (where prompt preview is rendered) — display the rendered `messages` array (e.g. one card per message with role badge) instead of a single rendered blob.
  - `reader-src/src/types/index.ts` — extend the prompt preview API type.

- **Default prompt template**: BOTH the code-shipped fallback `system.md` (loaded by `readTemplate()` when `PROMPT_FILE` is absent) AND the example `playground/_prompts/system.md` are rewritten to use `{{ message }}` blocks, so a fresh install — including container deployments where `playground/` is volume-mounted and may shadow or omit the example file — boots with a template that emits at least one `user`-role message and passes the new server-side validation.

- **Tests**:
  - New `tests/writer/lib/vento_message_tag_test.ts` covering tag parsing, role validation, ordering, nested-tag rejection, plugin compatibility (variables / `{{ for }}` / `{{ if }}` inside blocks), and assembly correctness.
  - Update `tests/writer/lib/template_test.ts` and any chat-handler tests that asserted the old `prompt: string` shape.
  - Frontend tests for the new preview rendering.

- **Docs**: `docs/prompt-template.md`, `AGENTS.md` Prompt Rendering Pipeline section, `.env.example` (no env changes — only doc cross-references if any).

- **Plugin contract**: Existing `prompt-assembly` plugin hook fragments continue to be injected as the `plugin_fragments` string array and rendered into the template via the existing `{{ for fragment of plugin_fragments }}` loop. Plugin authors who want their fragment to live in a non-system role wrap the loop inside `{{ message "user" }} … {{ /message }}` (or any other role) **inside `system.md`** — no plugin-API change required. **Fragment strings are interpolated as plain text by Vento (`output += fragment`); they are NOT re-parsed as Vento source.** Therefore a plugin CANNOT emit a complete `{{ message }}` block by writing the tag inside its fragment body — those characters render literally. Authoring a custom message inside a plugin requires registering a separate Vento template variable via the existing dynamic-variables mechanism if a plugin needs more advanced injection in v1.

- **Risk**: Sentinel-based interleaving relies on a per-render random nonce; we generate one with `crypto.randomUUID()` to avoid collision with any user-rendered content. Documented as a defensive measure.

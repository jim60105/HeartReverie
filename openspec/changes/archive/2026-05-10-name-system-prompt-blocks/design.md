## Context

`HeartReverie/system.md` is the default prompt template for the engine. It is hand-edited prose injected into the `system`-role message at session start. The template currently has four "core" prose sections that are intentionally NOT extracted into plugins (`vento-prompt-template` spec, requirement "Core prompt sections MUST NOT be extracted into plugins"). These four sections are anonymous: they appear as `# Formatting:`, `# Language:`, a one-line bracket-prefixed `[GAME INSTRUCTIONS: ...]`, and `# Writing guidelines:`.

The companion HRP change `restyle-output-format-prompts` is adopting 青空莉's prompt-naming convention from the reference article 「组合和命名提示词」 (https://stagedog.github.io/青空莉/工具经验/提示词个人写法/组合和命名提示词/), which requires every addressable prompt fragment to live inside a same-named open/close XML tag pair. To use that convention in plugin fragments while leaving the core sections un-named would create an inconsistency: plugins could reference each other by tag name but could not reference the core's formatting/language/game/writing rules.

## Goals / Non-Goals

**Goals**:
- Give each of the four core prose sections a stable, greppable XML name so plugin prompts and future reviewers can refer to them by name.
- Preserve every byte of existing prose inside the wrappers — this is purely additive markup.
- Keep the change small enough that one diff and one test-update is sufficient.

**Non-Goals**:
- Rewriting the prose itself (out of scope; covered by future per-section proposals if needed).
- Wrapping `# STORY SERIES` / `# SCENARIO` / `# CHARACTER DESCRIPTION` (these are dynamic-content slots; renaming risks tangling with lore-prompt-injection rules).
- Touching the assistant/user/second-system message blocks.
- Extracting the four core sections into plugins (the existing `vento-prompt-template` requirement explicitly forbids this; this change does not contradict it — wrapped sections are STILL hardcoded in `system.md`).

## Decisions

### D1: Tag names use snake_case singular nouns

`<formatting>`, `<language>`, `<game_instructions>`, `<writing_guidelines>`. Singular noun + snake_case to match the existing in-tree precedent (`<scenario>`, `<inputs>`, `<status_current_variable>`, `<previous_context>`, `<user_intent>`). Plural-vs-singular: the reference article uses singular tag names; we follow.

### D2: Existing Markdown headings stay inside the wrappers

E.g. `<formatting># Formatting:\n***Emphasize***\n…</formatting>`. Removing the headings would change the model's reading rhythm. Keeping them is free and preserves the human-readable diff for `git blame` purposes.

### D3: The `[GAME INSTRUCTIONS: ...]` line loses its bracket+colon prefix

The current `[GAME INSTRUCTIONS: ...]` was a poor-man's name; the new `<game_instructions>` IS the name. Removing the redundant `[GAME INSTRUCTIONS: ` prefix and the trailing `]` makes the diff cleaner and prevents the model from seeing two different names for the same thing. The internal prose is otherwise byte-identical.

### D4: Do NOT wrap scenario/series/character sections

The `# STORY SERIES`, `# SCENARIO`, and `# CHARACTER DESCRIPTION` blocks render dynamic content (`{{ series_name }}`, `{{ lore_character }}`) and the SCENARIO block already has its own `<scenario>...</scenario>` wrapper around the character description. Adding more wrappers around dynamic-content blocks risks confusing lore-related plugins/tests that may grep for the literal `# STORY SERIES` heading or the existing `<scenario>` boundary.

### D5: Identity-output test for `vento-prompt-template`

The relevant existing test for `system.md` rendering is in `vento-prompt-template`. Its expected-string fixture must be updated to include the new wrapping tags. The functional test ("template renders, all variables substituted, no Vento errors") continues to pass without further work because no template logic changes — only static text is wrapped.

## Risks / Trade-offs

- **R1 (low): The model interprets the new tags as instructions to emit XML.** Mitigation: the four wrapped blocks all live inside a `system`-role message, where the model already routinely sees `<scenario>`, `<inputs>`, etc. without echoing them. Verified during the integration smoke test.
- **R2 (low): Future plugin work greps for the literal old prose.** Search of HRP plugin files turned up zero matches for "GAME INSTRUCTIONS" / "Writing guidelines" / "# Formatting" — no plugin currently quotes these. Tags are added; prose is preserved. Net risk minimal.
- **R3 (medium): A user with a custom `PROMPT_FILE` (per `file-based-prompt-storage` spec) keeps an old un-wrapped copy.** Acceptable: that capability exists exactly so users can override the default; their custom prompt is whatever they wrote. The default ships with the new wrappers; that is the contract.

## Migration Plan

Single-step: edit `HeartReverie/system.md`, update the `vento-prompt-template` test's expected-string fixture, run all tests, container build, smoke-test the rendered prompt via the prompt-preview UI (per `prompt-preview` spec) to confirm the new tags render, then commit.

## Open Questions

None blocking. The HRP change `restyle-output-format-prompts` does not strictly require this one to land first (its plugin fragments use their own local tag names like `<status>`, `<options>`, `<scene>`), but landing them together gives reviewers a coherent story.

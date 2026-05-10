## Why

The HR core `system.md` template has four "core" prompt sections (`# Formatting`, `# Language`, the long `[GAME INSTRUCTIONS: ...]` line, and `# Writing guidelines`) that are anonymous in the rendered prompt — they appear as bare Markdown headings inside one giant `system` message. Two practical problems follow:

1. **Plugin fragments cannot reference them.** A plugin prompt that wants to say "remember the rule from the writing guidelines about pausing the story at an appropriate point" has nothing stable to point at. Heading text is brittle and the LLM treats everything as one undifferentiated wall of instructions.
2. **The reference style this codebase is adopting (青空莉's "组合和命名提示词") requires every meaningful prompt block to live inside a uniquely-named XML container** so it has an addressable name, both for human authoring (search/grep) and for in-prompt cross-references. The companion HRP change `restyle-output-format-prompts` is rewriting plugin fragments to follow this style; without doing the same for the core sections, the core remains the only un-named region in the assembled prompt.

## What Changes

- Wrap the four core prose sections in `system.md` with named XML containers, identical names on top and bottom (per reference). No prose changes inside the containers — only the wrapping tags are added:
  - `# Formatting:` block → wrapped in `<formatting>...</formatting>`.
  - `# Language:` block → wrapped in `<language>...</language>`.
  - The long single-line `[GAME INSTRUCTIONS: ...]` block → rewritten as `<game_instructions>` … `</game_instructions>` (the leading `[GAME INSTRUCTIONS: ` literal and the closing `]` are removed; their content is preserved verbatim).
  - `# Writing guidelines:` and its bullet list → wrapped in `<writing_guidelines>...</writing_guidelines>`.
- Keep the Markdown headings inside the wrappers (e.g. `<formatting># Formatting:\n***Emphasize***\n…</formatting>`) so the rendered prompt still reads naturally to the model.
- Do **not** wrap `# STORY SERIES` / `# SCENARIO` / `# CHARACTER DESCRIPTION` — they are dynamic-content insertion points (they read `{{ series_name }}`, `<scenario>`, `{{ lore_character }}`) and renaming them risks breaking lore-prompt-injection rules. The existing `<scenario>...</scenario>` wrapper that already surrounds character description is preserved as-is.
- No code changes. No backend/frontend changes. Only `HeartReverie/system.md` is touched, plus the `vento-prompt-template` capability spec.
- **Modified capability**: `vento-prompt-template` (new requirement: the four core sections SHALL be wrapped in named XML containers).
- **No new capability**, no new files outside `openspec/`.

## Impact

- Affected specs: `vento-prompt-template` (one ADDED requirement).
- Affected code: `HeartReverie/system.md` only.
- Affected tests: any unit test that asserts the rendered output of `system.md` (e.g. `vento-prompt-template` tests) needs its expected-string updated to include the new wrapping tags. No behavior change for the LLM beyond making the prose addressable.
- Operational risk: low. The wrapping tags appear inside a `system`-role message; the LLM treats them as natural-language XML annotations (the same way it handles `<scenario>`, `<inputs>`, etc. that already exist in this template). No upstream API contract change.
- Coordination: this proposal pairs with `restyle-output-format-prompts` in the HRP repo. Both should be applied together so plugin fragments that reference `<writing_guidelines>` etc. land in the same release.

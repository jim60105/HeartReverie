## Why

The project recently adopted an underscore-prefix convention (`_lore/`) for system-reserved directories inside `playground/`. The `prompts/` directory serves the same purpose — storing system data (the custom prompt template) alongside user story data — but still uses a bare name. Renaming it to `_prompts/` unifies the naming convention and simplifies the series listing filter, which currently hard-codes `prompts` as a special exclusion alongside the generic underscore-prefix rule.

## What Changes

- **BREAKING**: Rename the default prompt storage path from `playground/prompts/system.md` to `playground/_prompts/system.md`.
- Update `PROMPT_FILE` default in `writer/lib/config.ts` to use `_prompts` instead of `prompts`.
- Remove the hard-coded `e.name !== "prompts"` filter in `writer/routes/stories.ts` series listing — the existing underscore-prefix exclusion (`!e.name.startsWith("_")`) already covers `_prompts`.
- Update `.env.example`, documentation (`README.md`, `AGENTS.md`), and specs to reflect the new path.
- Update `playground/.gitignore` to preserve `_prompts/` alongside `_lore/`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `file-based-prompt-storage`: Default `PROMPT_FILE` path changes from `playground/prompts/system.md` to `playground/_prompts/system.md`.
- `writer-backend`: Story directory listing requirement updates — remove hard-coded `prompts` exclusion, rely solely on underscore-prefix rule.
- `env-example`: `PROMPT_FILE` documented default value changes from `playground/prompts/system.md` to `playground/_prompts/system.md`.
- `vento-prompt-template`: Purpose description path reference changes from `playground/prompts/system.md` to `playground/_prompts/system.md`.

## Impact

- `writer/lib/config.ts` — default path string change
- `writer/routes/stories.ts` — remove `prompts` special-case filter
- `playground/.gitignore` — add `!_prompts/` preservation rule
- `playground/_prompts/.gitignore` — new file to preserve directory in git
- `.env.example` — update `PROMPT_FILE` default comment
- `README.md` — update `PROMPT_FILE` default path in env var table
- `AGENTS.md` — update prompt file path reference
- `tests/writer/routes/stories_test.ts` — update fixture and assertion
- `tests/writer/routes/prompt_test.ts` — update fixture path
- Existing `PROMPT_FILE` env var overrides are unaffected (user-specified paths remain unchanged)

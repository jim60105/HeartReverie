## 1. Default Path Update

- [x] 1.1 Update the `PROMPT_FILE` default in `writer/lib/config.ts` from `join(PLAYGROUND_DIR, "prompts", "system.md")` to `join(PLAYGROUND_DIR, "_prompts", "system.md")`.

## 2. Stories Listing Filter Simplification

- [x] 2.1 Remove the hard-coded `e.name !== "prompts"` check from the series listing filter in `writer/routes/stories.ts`. The existing `!e.name.startsWith("_")` already covers `_prompts`.

## 3. Git Configuration

- [x] 3.1 Update `playground/.gitignore` to add `!_prompts/` preservation rule alongside the existing `!_lore/` rule.
- [x] 3.2 Create `playground/_prompts/.gitignore` with `*` and `!.gitignore` (same pattern as `playground/_lore/.gitignore`).
- [x] 3.3 Remove the old `playground/prompts/` directory if it exists in the repository tree.

## 4. Test Updates

- [x] 4.1 Update `tests/writer/routes/prompt_test.ts` to use `_prompts` instead of `prompts` in fixture paths.
- [x] 4.2 Update `tests/writer/routes/stories_test.ts` — add a `_prompts` directory to the series listing fixture and assert it is excluded from results by the underscore-prefix rule.

## 5. Documentation and Configuration

- [x] 5.1 Update `AGENTS.md` to change the `PROMPT_FILE` default path from `playground/prompts/system.md` to `playground/_prompts/system.md`.
- [x] 5.2 Update `.env.example` to change the `PROMPT_FILE` default comment from `playground/prompts/system.md` to `playground/_prompts/system.md`.
- [x] 5.3 Update `README.md` to change the `PROMPT_FILE` default path in the environment variable table from `playground/prompts/system.md` to `playground/_prompts/system.md`.
- [x] 5.4 Update any other documentation files (`docs/`) that reference `playground/prompts/`.

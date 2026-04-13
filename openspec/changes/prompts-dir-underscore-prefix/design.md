## Context

The project stores custom prompt templates at `playground/prompts/system.md` by default. The recent lore codex restructure introduced an underscore-prefix convention for system-reserved directories (`_lore/`), with `isValidParam()` rejecting underscore-prefixed names and `stories.ts` filtering them from listings. The `prompts/` directory is currently excluded via a hard-coded name check (`e.name !== "prompts"`) rather than the generic underscore rule.

## Goals / Non-Goals

**Goals:**

- Rename `playground/prompts/` to `playground/_prompts/` to follow the underscore-prefix convention
- Remove hard-coded `prompts` exclusion from stories listing — let the underscore-prefix rule handle it
- Preserve `_prompts/` in version control using the same `.gitignore` pattern as `_lore/`

**Non-Goals:**

- Changing the `PROMPT_FILE` env var name or behavior (only the default value changes)
- Supporting backward-compatible resolution of the old `prompts/` path
- Migrating existing user data (project is pre-release with 0 users)

## Decisions

### Decision 1: Rename to `_prompts` (not merge into `_lore` or other locations)

The prompt template is functionally distinct from lore passages — it's a Vento template, not a `.md` passage with YAML frontmatter. Keeping it in its own `_prompts/` directory maintains clear separation of concerns. The underscore prefix signals "system-reserved" without changing the semantic role.

### Decision 2: Remove hard-coded `prompts` exclusion entirely

After renaming, the existing `!e.name.startsWith("_")` filter in `stories.ts` already covers `_prompts`. The hard-coded `e.name !== "prompts"` check becomes dead code. Removing it simplifies the filter and makes the underscore convention the single source of truth for system directory exclusion.

### Decision 3: Preserve `_prompts/` in git using nested `.gitignore`

Same pattern as `_lore/`: `playground/.gitignore` adds `!_prompts/`, and `playground/_prompts/.gitignore` ignores all content except itself. This ensures the directory exists on fresh clones without leaking user prompt data.

## Risks / Trade-offs

- **[Risk] Existing `PROMPT_FILE` overrides break** → No mitigation needed. Users who set `PROMPT_FILE` explicitly already bypass the default path. Only the default changes.
- **[Risk] Old `playground/prompts/` left behind on existing deployments** → Not a concern for a pre-release project with 0 users. No migration needed.

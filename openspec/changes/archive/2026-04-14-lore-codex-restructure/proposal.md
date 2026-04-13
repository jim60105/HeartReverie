## Why

The current lore codex stores all passages under a standalone `playground/lore/` tree with scope sub-directories (`global/`, `series/<S>/`, `story/<S>/<T>/`). This separates lore data from the series and story directories they belong to, making it harder to manage lore alongside story content. Additionally, filenames carry semantic meaning (e.g., `hero.md` describes a hero) but are not used as implied tags, forcing authors to redundantly declare tags that the filename already conveys.

## What Changes

- **BREAKING** — Relocate scoped lore directories into the story data tree. Global lore moves from `playground/lore/global/` to `playground/_lore/`. Series lore moves from `playground/lore/series/<S>/` to `playground/<S>/_lore/`. Story lore moves from `playground/lore/story/<S>/<T>/` to `playground/<S>/<T>/_lore/`. The top-level `playground/lore/` directory is removed.
- Add filename-as-implied-tag: the stem of each `.md` file (without extension) is normalized and added as an effective tag alongside frontmatter tags and directory-implicit tags. For example, `global/characters/hero.md` with `tags: [protagonist]` produces effective tags `[protagonist, characters, hero]`.
- Remove the migration script `scripts/migrate-scenario.ts` since `scenario.md` migration is no longer needed.
- Remove all mentions of `scenario.md` migration and backward compatibility from `docs/lore-codex.md`.
- Restructure `playground/` gitignore: move the top-level `playground/` ignore from root `.gitignore` to a nested `playground/.gitignore` that ignores all content except `.gitignore` files and the `_lore/` directory. Add `playground/_lore/.gitignore` to preserve the global lore directory in version control without using `.gitkeep` files.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `lore-storage`: Directory paths change from `playground/lore/{global,series/<S>,story/<S>/<T>}/` to `playground/{_lore,<S>/_lore,<S>/<T>/_lore}/`. Filename stem becomes an implied tag source.
- `lore-retrieval`: Effective tag computation gains filename-derived tags. Collection paths change to match new storage layout.
- `lore-api`: API route path construction changes to resolve lore directories under series/story paths instead of the standalone `playground/lore/` tree.
- `lore-prompt-injection`: Template variable generation reads from the new storage paths. No changes to variable naming or semantics.
- `lore-editor-ui`: No spec-level requirement changes (API contract is identical). Only documentation path references need updating — handled as implementation tasks.
- `writer-backend`: Story listing routes must filter out underscore-prefixed directories (e.g., `_lore`) to prevent them from appearing as series or stories. Underscore-prefixed names must be reserved as invalid series/story identifiers.

## Impact

- **Backend** (`writer/lib/lore.ts`): Storage path construction, scope identification, directory-tag depth constants, and passage collection logic all change.
- **Backend** (`writer/lib/template.ts`): The `loreRoot` variable and path passed to `resolveLoreVariables()` changes.
- **Backend** (`writer/routes/lore.ts`): `scopeSegments()` and `loreRoot` construction change to produce paths under series/story directories.
- **Scripts**: `scripts/migrate-scenario.ts` is deleted.
- **Documentation** (`docs/lore-codex.md`): Directory structure tables, tag resolution examples, and migration section updated.
- **Specs**: Five existing specs receive delta modifications (`lore-storage`, `lore-retrieval`, `lore-api`, `lore-prompt-injection`, `writer-backend`).
- **Git configuration** (`.gitignore`, `playground/.gitignore`, `playground/_lore/.gitignore`): Restructure playground gitignore to use nested `.gitignore` files, preserving `playground/_lore/` in version control.
- **Existing data**: The single existing lore passage (`playground/lore/series/悠奈悠花姊妹大冒險/scenario.md`) must be manually relocated to `playground/悠奈悠花姊妹大冒險/_lore/scenario.md`.

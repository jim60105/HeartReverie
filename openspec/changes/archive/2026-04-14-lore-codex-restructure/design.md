## Context

The lore codex system was implemented as a core subsystem of HeartReverie, storing world-building passages in a three-scope hierarchy under `playground/lore/`. The current layout uses `playground/lore/global/`, `playground/lore/series/<S>/`, and `playground/lore/story/<S>/<T>/` as scope roots.

This structure separates lore from the series and story directories it describes. Authors managing `playground/悠奈悠花姊妹大冒險/` must also navigate to a completely separate `playground/lore/series/悠奈悠花姊妹大冒險/` tree to find related lore — a disjointed authoring experience.

Additionally, passage filenames carry semantic meaning (e.g., `hero.md` is about a hero) but this information is not used as an implied tag, forcing redundant explicit tagging.

## Goals / Non-Goals

**Goals:**

- Co-locate lore with the story data it describes, using `_lore/` subdirectories inside existing series/story/root directories
- Add filename stem as an automatic implied tag source alongside directory-implicit tags
- Remove obsolete migration infrastructure (`scripts/migrate-scenario.ts`)
- Clean up scenario.md references from documentation since migration is no longer needed

**Non-Goals:**

- Changing the API route contract (`/api/lore/global/...`, `/api/lore/series/:s/...`, `/api/lore/story/:s/:t/...`) — routes remain the same, only backend path resolution changes
- Changing frontmatter schema, tag normalization rules, or template variable naming
- Recursive directory scanning (still one level of subdirectories)
- Auto-migration tooling for existing data — the single existing passage will be relocated manually

## Decisions

### D1: Use `_lore/` prefix for lore directories

The underscore prefix distinguishes lore directories from story/chapter directories within the same parent. Alternatives considered:

- `.lore/` (hidden directory) — rejected because hidden directories are often ignored by editors and file browsers, making discovery harder
- `lore/` (no prefix) — rejected because it could conflict with a story or series named "lore"
- `__lore__/` (double underscore) — rejected as unnecessarily verbose

The `_lore/` convention clearly marks the directory as system infrastructure while remaining visible and accessible.

### D2: Filename tag uses the stem only

For `hero.md`, the implied tag is `hero` (not `hero.md`). The `.md` extension is stripped before normalization. This aligns with how directory-implicit tags already work (directory name, not path), and normalized via the same `normalizeTag()` function.

### D3: Effective tag computation order

Effective tags are computed as the union of: frontmatter tags → directory-implicit tag → filename-implicit tag. All sources pass through `normalizeTag()` and are deduplicated. If a filename tag duplicates a frontmatter or directory tag, it appears only once. This is the same deduplication logic already used for directory+frontmatter tags.

### D4: Scope-relative paths for directory tag resolution

The current `resolveDirectoryTag()` uses global `rootDepth` constants to skip scope-prefix segments. With the new layout, using `_lore/`-inclusive paths with depth 1 would incorrectly assign `_lore` itself as a directory tag for scope-root files (e.g., `_lore/rules.md` → tag `_lore`).

The fix is to refactor so that `resolveDirectoryTag()` works on **scope-relative paths** (paths relative to the `_lore/` directory itself, e.g., `characters/alice.md` or `rules.md`). With scope-relative paths, a uniform depth threshold of 1 applies to all scopes:

- `rules.md` → 1 part → no directory tag ✓
- `characters/alice.md` → 2 parts → directory tag `characters` ✓

This eliminates the per-scope `rootDepth` map entirely and simplifies the function.

### D5: Reserve underscore-prefixed names as system directories

Since `_lore/` directories are now co-located alongside series/story directories, a naming convention is needed to prevent collisions. All underscore-prefixed directory names (e.g., `_lore`) are reserved as system directories. The `isValidParam()` function in `writer/lib/middleware.ts` and the story listing routes must reject names starting with `_` as series/story identifiers. The stories listing routes (`GET /api/stories`, `GET /api/stories/:series`) must also filter out underscore-prefixed directories from results. This convention is extensible — future system directories can use the same `_` prefix without additional code changes.

### D6: `scopeSegments()` mapping in routes

The API route handler's `scopeSegments()` function currently returns segments relative to `playground/`:

| Scope | Current segments | New segments |
|-------|-----------------|--------------|
| global | `["lore", "global"]` | `["_lore"]` |
| series | `["lore", "series", <S>]` | `[<S>, "_lore"]` |
| story | `["lore", "story", <S>, <T>]` | `[<S>, <T>, "_lore"]` |

### D7: Template engine path change

`template.ts` currently computes `loreRoot = join(PLAYGROUND_DIR, "lore")` and passes it to `resolveLoreVariables()`. With the new layout, there is no single lore root — each scope resolves independently. The function signature changes to accept `PLAYGROUND_DIR` directly, and scope paths are computed internally.

### D8: Nested gitignore for directory preservation

The `playground/` directory is gitignored (user story data). To preserve `playground/_lore/` in version control without `.gitkeep` files, the top-level `playground/` ignore is moved from root `.gitignore` to a nested `playground/.gitignore` that ignores all content except `.gitignore` files and the `_lore/` directory. A second `playground/_lore/.gitignore` ignores all lore content except itself. This pattern ensures git tracks the directory structure without any story data leaking into the repository.

## Risks / Trade-offs

- **[Breaking change]** Existing lore passages must be manually relocated. → Mitigation: Only one passage exists currently (`playground/lore/series/悠奈悠花姊妹大冒險/scenario.md`). Document the manual relocation step.
- **[Filename tag conflicts]** A file named `characters.md` in a `characters/` subdirectory would get duplicate `characters` tags from both filename and directory. → Mitigation: Deduplication already handles this — the tag appears once.
- **[Reserved filename stems]** A file named `all.md` or `tags.md` would produce reserved tag names. → Mitigation: `normalizeTag()` already rejects reserved names, so the filename tag is silently dropped. Document this edge case.
- **[Non-ASCII filenames]** Filenames with CJK characters (common in this project) will have their stem normalized through `normalizeTag()`, which strips non-`[a-z0-9_]` characters. → Mitigation: CJK filenames produce no filename tag (normalized to empty string, rejected). Authors should use ASCII kebab-case filenames or rely on frontmatter tags for CJK tag names. Document this limitation.

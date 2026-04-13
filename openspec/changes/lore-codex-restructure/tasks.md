## 1. Core Library — Storage Path Restructure

- [x] 1.1 Update `collectAllPassages()` in `writer/lib/lore.ts` to resolve scope paths as `playground/_lore/`, `playground/<series>/_lore/`, `playground/<series>/<story>/_lore/` instead of the current `playground/lore/{global,series/<S>,story/<S>/<T>}/` layout. Change the function signature to accept `playgroundDir` instead of `loreRoot`.
- [x] 1.2 Update `identifyScope()` to accept scope as an explicit parameter from the caller rather than inferring it from directory path segments.
- [x] 1.3 Refactor `resolveDirectoryTag()` to work on scope-relative paths (relative to `_lore/` directory) with a uniform depth threshold, eliminating the per-scope `rootDepth` map entirely.
- [x] 1.4 Update `resolveLoreVariables()` export function signature to accept `playgroundDir`, `series`, `story` instead of `loreRoot`, `series`, `story`.

## 2. Core Library — Filename-Based Implicit Tagging

- [x] 2.1 Add `resolveFilenameTag()` function that extracts the `.md` stem, passes it through `normalizeTag()`, and returns the result (or `null` if normalized to empty or reserved).
- [x] 2.2 Update `computeEffectiveTags()` to include the filename-derived tag in the union alongside frontmatter and directory tags, with deduplication.
- [x] 2.3 Update `readPassage()` to call `resolveFilenameTag()` and pass the result to `computeEffectiveTags()`.

## 3. Template Engine Integration

- [x] 3.1 Update `renderSystemPrompt()` in `writer/lib/template.ts` to pass `PLAYGROUND_DIR` directly to `resolveLoreVariables()` instead of computing a `loreRoot` path.

## 4. API Route Path Resolution

- [x] 4.1 Update `scopeSegments()` in `writer/routes/lore.ts` to return new path segments: global → `["_lore"]`, series → `[<S>, "_lore"]`, story → `[<S>, <T>, "_lore"]`.
- [x] 4.2 Remove or update the `loreRoot` constant in the route module to reflect that lore directories are co-located under `PLAYGROUND_DIR` rather than under a standalone `playground/lore/` tree.
- [x] 4.3 Update the tags endpoint (`GET /api/lore/tags`) path resolution to scan `_lore/` directories under `PLAYGROUND_DIR` instead of `playground/lore/`.

## 5. Story Listing and Name Reservation

- [x] 5.1 Update `GET /api/stories` in `writer/routes/stories.ts` to filter out underscore-prefixed directories (e.g., `_lore`) from series listing (alongside existing `prompts` filter).
- [x] 5.2 Update `GET /api/stories/:series` in `writer/routes/stories.ts` to filter out underscore-prefixed directories from story listing.
- [x] 5.3 Add underscore-prefix reservation to parameter validation (e.g., in `writer/lib/middleware.ts` or route-level guards) to reject names starting with `_` as series/story names with HTTP 400.

## 6. Unit Tests — Storage and Retrieval

- [x] 6.1 Update all lore library tests in `tests/writer/lib/lore_test.ts` to use the new directory structure (`_lore/` instead of `lore/global/`, etc.) in test fixtures and assertions.
- [x] 6.2 Add test cases for filename-based implicit tagging: filename provides tag, filename duplicates directory tag, CJK filename produces no tag, reserved filename (all.md) produces no tag.
- [x] 6.3 Update effective tag computation tests to verify the three-source union (frontmatter + directory + filename).
- [x] 6.4 Update integration tests in `tests/writer/lib/lore_integration_test.ts` to use the new `_lore/` directory layout.

## 7. Unit Tests — API Routes

- [x] 7.1 Update all route tests in `tests/writer/routes/lore_test.ts` to create test fixtures under `_lore/` directories and adjust path assertions.
- [x] 7.2 Verify that API route contract (URL paths, request/response format) remains unchanged — only backend path resolution changes.
- [x] 7.3 Add tests in `tests/writer/routes/stories_test.ts` to verify underscore-prefixed directories (e.g., `_lore`) are filtered from story listings and rejected as series/story names.

## 8. Unit Tests — Template Integration

- [x] 8.1 Update template rendering tests in `tests/writer/lib/template_test.ts` to verify lore variables are resolved from the new `_lore/` directory structure.

## 9. Git Configuration

- [x] 9.1 Move `playground/` ignore from root `.gitignore` to nested `playground/.gitignore` that ignores all content except `.gitignore` files and `_lore/` directory. Create `playground/_lore/.gitignore` to preserve the global lore directory in git without `.gitkeep` files.

## 10. Cleanup

- [x] 10.1 Delete `scripts/migrate-scenario.ts`.
- [x] 10.2 Update `docs/lore-codex.md` to remove all mentions of `scenario.md` migration and backward compatibility. Update directory structure documentation to reflect the new `_lore/` layout and filename-as-tag feature. Document the underscore-prefix convention for system-reserved directories.
- [x] 10.3 Update `docs/prompt-template.md` to remove stale `{{ scenario }}` reference and update `lore_scenario` example context.
- [x] 10.4 Update `docs/plugin-system.md` to remove stale `scenario` variable from the core variable listing.
- [x] 10.5 Update `AGENTS.md` to document the underscore-prefix directory convention (`_` prefix = system-reserved, e.g., `_lore`), update any references to the old `playground/lore/` structure, and note that underscore-prefixed names are invalid series/story identifiers.

## 11. Data Migration

- [x] 11.1 Manually relocate the existing lore passage from `playground/lore/series/悠奈悠花姊妹大冒險/scenario.md` to `playground/悠奈悠花姊妹大冒險/_lore/scenario.md` and remove the empty `playground/lore/` tree.

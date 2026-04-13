## 1. Storage Foundation

- [ ] 1.1 Create `playground/lore/` directory structure with `global/`, `series/`, and `story/` scope subdirectories
- [ ] 1.2 Implement YAML frontmatter parser in `writer/lib/lore.ts` (parse `tags`, `priority`, `enabled` with defaults; extract Markdown body)
- [ ] 1.3 Implement directory-as-tag resolution (immediate parent subdirectory name becomes implicit tag when not a scope root)
- [ ] 1.4 Implement scope identification from file path (determine global/series/story scope from explicit `global/`, `series/`, `story/` prefix directories)
- [ ] 1.5 Implement tag normalization for variable names (lowercase, hyphens/spaces → underscores, strip non-alphanumeric; reject reserved names `all`/`tags`)
- [ ] 1.6 Write unit tests for frontmatter parsing, tag resolution, scope identification, and tag normalization

## 2. Retrieval Engine

- [ ] 2.1 Implement scope-based passage collection: scan `global/`, `series/<S>/`, `story/<S>/<T>/` — each scope is structurally separated by its prefix directory, no cross-scope exclusion logic needed
- [ ] 2.2 Implement effective tag computation (union of frontmatter tags + directory-implicit tag)
- [ ] 2.3 Implement tag-based filtering (return passages whose effective tags include a given tag)
- [ ] 2.4 Implement priority-based ordering (descending priority, then filename alphabetically)
- [ ] 2.5 Implement content concatenation (join Markdown bodies with `\n\n---\n\n` separator)
- [ ] 2.6 Write unit tests for scope collection, tag filtering, ordering, and concatenation

## 3. Prompt Injection

- [ ] 3.1 Extend `renderSystemPrompt()` signature, `RenderOptions` type, and all callers to accept `story: string` parameter (currently only `series` is passed)
- [ ] 3.2 Implement lore template variable generation in `writer/lib/lore.ts`: `lore_all`, `lore_<normalized_tag>` per unique tag, `lore_tags` array
- [ ] 3.3 Integrate lore variable generation into `renderSystemPrompt()` in `writer/lib/template.ts` — call lore retrieval with series/story context, spread results into Vento render context
- [ ] 3.4 Ensure all discovered `lore_*` variables are present as empty string when no passages match (not undefined)
- [ ] 3.5 Remove `scenario` variable loading from `writer/lib/template.ts` (delete scenarioPath/scenarioContent logic)
- [ ] 3.6 Update `system.md` prompt template: replace `{{ scenario }}` with `{{ lore_scenario }}` or `{{ lore_all }}`
- [ ] 3.7 Write unit tests for variable generation, story param plumbing, tag normalization in variable names, empty tag handling, and template rendering with lore variables

## 4. Backend API

- [ ] 4.1 Create `writer/routes/lore.ts` as a core route module (same pattern as `writer/routes/stories.ts`)
- [ ] 4.2 Implement `GET /api/lore/tags` — list all unique effective tags across all scopes
- [ ] 4.3 Implement `GET /api/lore/global`, `GET /api/lore/series/:series`, `GET /api/lore/story/:series/:story` — list passage metadata with optional `?tag=` query filter
- [ ] 4.4 Implement `GET /api/lore/{global,series/:series,story/:series/:story}/*path` — read passage (frontmatter + content as JSON)
- [ ] 4.5 Implement `PUT /api/lore/{global,series/:series,story/:series/:story}/*path` — create or update passage file
- [ ] 4.6 Implement `DELETE /api/lore/{global,series/:series,story/:series/:story}/*path` — delete passage file
- [ ] 4.7 Add path traversal protection using `safePath()` and `isPathContained()` for all path parameters
- [ ] 4.8 Register lore routes in `writer/app.ts` with authentication middleware
- [ ] 4.9 Write integration tests for all CRUD endpoints, including auth, validation, and error cases

## 5. Frontend UI

- [ ] 5.1 Create Vue component: `LoreBrowser.vue` — passage list with scope tabs (global/series/story) and tag filter chips
- [ ] 5.2 Create Vue component: `LoreEditor.vue` — frontmatter fields (tag input, priority number, enabled toggle) + Markdown content textarea
- [ ] 5.3 Create Vue composable: `useLoreApi.ts` — API client for lore CRUD operations
- [ ] 5.4 Add Vue Router route for lore management page (e.g., `/lore`) as core route
- [ ] 5.5 Write frontend component tests with Vitest

## 6. Migration

- [ ] 6.1 Create migration script: for each `playground/<series>/scenario.md`, generate `playground/lore/series/<series>/scenario.md` with frontmatter `tags: [scenario]`, `priority: 1000`
- [ ] 6.2 Run migration on existing story data (the one series `悠奈悠花姊妹大冒險`)
- [ ] 6.3 Verify migrated passage is retrievable via `lore_scenario` template variable
- [ ] 6.4 Delete original `scenario.md` files after migration verification

## 7. Documentation

- [ ] 7.1 Create `docs/lore-codex.md` — user-facing documentation covering directory structure, frontmatter schema, tag system, template usage, and API reference
- [ ] 7.2 Update `AGENTS.md` — add lore-codex as core feature, document `writer/lib/lore.ts` and `writer/routes/lore.ts`
- [ ] 7.3 Update relevant docs if applicable

## 8. Integration Testing

- [ ] 8.1 End-to-end test: create passages in all three scopes, render prompt template, verify correct lore injection
- [ ] 8.2 End-to-end test: verify tag filtering produces correct template variables with normalized names
- [ ] 8.3 End-to-end test: verify disabled passages are excluded from prompt output
- [ ] 8.4 End-to-end test: verify scope-based scan does not double-count passages in child scopes
- [ ] 8.5 Regression test: verify existing prompt rendering still works with lore system active (no scenario.md)

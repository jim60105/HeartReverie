## Context

The project currently uses a single `scenario.md` file per series, loaded by `writer/lib/template.ts` and injected as the `{{ scenario }}` Vento variable. This approach has severe limitations: no topic-level organization, no per-story scoping, no way to share global lore across series, and no selective injection based on relevance. Authors must cram all world-building context into one monolithic file, wasting prompt tokens on irrelevant content.

The existing plugin architecture supports dynamic prompt variable injection via `getPromptVariables()` (returns variables spread into the Vento render context) and lifecycle hooks (`prompt-assembly`, `post-response`, etc.). The frontend is a Vue 3 SPA (`reader-src/`) with Vue Router. The backend exposes REST APIs under `/api/` via Hono route modules.

SillyTavern's World Info system provides the closest prior art but relies on keyword-triggered automatic injection from a JSON database. Our design diverges intentionally: file-based Markdown passages with manual tag-based template injection, fitting the project's file-first philosophy.

## Goals / Non-Goals

**Goals:**
- Replace `scenario.md` with a structured, multi-scope lore system
- Allow authors to organize world-building information as individual Markdown files with YAML frontmatter
- Support three hierarchical scopes: global, series, story
- Enable tag-based organization (directory-implicit and explicit frontmatter tags)
- Provide Vento template variables for selective passage injection by tag
- Expose backend CRUD API for lore passage management
- Provide frontend UI for browsing, filtering, and editing passages
- Migrate existing `scenario.md` files to series-scoped passages

**Non-Goals:**
- Keyword-triggered automatic injection (SillyTavern's primary feature) — all injection is explicit via template variables
- Probability-based or conditional activation rules
- Cross-references or recursive inclusion between passages
- Real-time collaborative editing
- Version history or diff tracking for passages
- Full-text search across passage content (tag-based filtering is sufficient for v1)

## Decisions

### Decision 1: Storage location and directory structure

**Choice:** Store lore under `playground/lore/` with explicit scope-prefixed subdirectories that mirror the API URL structure.

```
playground/
  lore/
    global/                      # Scope: all series/stories
      characters/                # Subdirectory → implicit tag "characters"
        alice.md
      world/
        geography.md
      rules.md                   # No subdirectory → no implicit directory tag
    series/
      <series>/                  # Scope: all stories within this series
        characters/
          bob.md
        setting.md
    story/
      <series>/
        <story>/                 # Scope: this specific story only
          chapter-notes.md
```

**Rationale:** Placing lore under `playground/` keeps it with other user data (chapters, prompts, scenario). The `lore/` prefix prevents collision with series directories. Explicit `global/`, `series/`, `story/` scope folders mirror the API URL structure (`/api/lore/global/`, `/api/lore/series/:s/`, `/api/lore/story/:s/:t/`) and eliminate two ambiguities: (1) subdirectories within a series scope cannot be confused with story scope roots, and (2) a series named "global" does not collide with the global scope directory. Three scope levels mirror the natural hierarchy of fiction world-building. Subdirectories within each scope serve as implicit tag namespaces.

**Alternatives considered:**
- *Per-series `lore/` directory* (e.g., `playground/<series>/lore/`): Rejected because it can't support global scope and clutters the series directory.
- *Separate top-level `lore/` directory*: Rejected because it breaks the convention that all user data lives under `playground/`.
- *Flat scope layout* (e.g., `playground/lore/<series>/` without `series/` prefix): Rejected because subdirectories become ambiguous (tag subdir vs story scope root), and a series named "global" collides with the global scope directory.

### Decision 2: Passage file format (YAML frontmatter + Markdown)

**Choice:** Each passage is a `.md` file with optional YAML frontmatter.

```markdown
---
tags: [npc, tavern, comic-relief]
priority: 100
enabled: true
---
# The Old Tavern Keeper

A grumpy old man who runs the only tavern in town...
```

Frontmatter schema:
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tags` | `string[]` | `[]` | Explicit tags for filtering and retrieval |
| `priority` | `number` | `0` | Sort order; higher priority passages appear first when multiple match |
| `enabled` | `boolean` | `true` | Whether the passage is active; disabled passages are excluded from retrieval |

**Rationale:** YAML frontmatter is the standard for Markdown metadata (used by Jekyll, Hugo, Obsidian, etc.). Three fields are sufficient for v1 — tags for organization, priority for ordering, enabled for toggling without deletion.

The passage **title** is derived from the filename (e.g., `old-tavern-keeper.md` → display name "old-tavern-keeper"). No `title` field in frontmatter to avoid name/filename divergence.

**Alternatives considered:**
- *JSON frontmatter*: Rejected — YAML is more readable for non-technical authors.
- *Adding `title`, `description`, `keywords` fields*: Rejected for v1 — YAGNI. Tags cover the filtering use case; title from filename is sufficient.

### Decision 3: Tag resolution (directory-implicit + explicit)

**Choice:** A passage's effective tags are the union of:
1. **Explicit tags** from frontmatter `tags` field
2. **Directory tag** from the immediate parent subdirectory name (if not a scope root)

Example: `playground/lore/global/characters/alice.md` with frontmatter `tags: [protagonist, human]`
→ Effective tags: `["characters", "protagonist", "human"]`

Example: `playground/lore/global/rules.md` with frontmatter `tags: [gameplay]`
→ Effective tags: `["gameplay"]` (no directory tag since `global/` is a scope root)

**Rationale:** Directory-as-tag provides natural filesystem organization without requiring authors to repeat the directory name in frontmatter. The union approach means moving a file between directories automatically adjusts its implicit tag.

### Decision 4: Scope resolution at prompt render time

**Choice:** When rendering a prompt for series S and story T, the retrieval engine collects passages from three directories — each scanned **non-recursively into child scope directories** to avoid double-counting:
1. `playground/lore/global/*.md` + `playground/lore/global/<tag-subdirs>/*.md`
2. `playground/lore/series/<S>/*.md` + `playground/lore/series/<S>/<tag-subdirs>/*.md`
3. `playground/lore/story/<S>/<T>/*.md` + `playground/lore/story/<S>/<T>/<tag-subdirs>/*.md`

Concretely: for each scope root, scan `.md` files in the root and in one level of tag subdirectories. Since the explicit scope folders (`global/`, `series/`, `story/`) structurally separate the three scopes, there is no ambiguity between tag subdirectories and child scope roots.

All matching passages (with `enabled: true`) are merged into a single pool. Scope is NOT a tag — it's determined entirely by directory location.

**Rationale:** This mirrors how authors think: some lore is universal, some applies to a series, some is story-specific. The engine automatically includes the right passages based on the active story context. The explicit scope folders (`global/`, `series/`, `story/`) structurally prevent cross-scope confusion, eliminating the need for dynamic child-scope exclusion logic.

### Decision 5: Template variable generation

**Choice:** The lore retrieval engine in `writer/lib/lore.ts` computes template variables that are spread directly into the Vento render context by `renderSystemPrompt()` in `writer/lib/template.ts`:

- `lore_all` — Concatenated content of all in-scope, enabled passages, sorted by priority (descending), separated by `\n\n---\n\n`
- `lore_<normalized_tag>` — Concatenated content of passages matching a specific tag (effective tags include directory-implicit), sorted by priority

Additionally, the engine provides:
- `lore_tags` — Array of all unique effective tags found across in-scope passages (for the prompt editor to display available tags)

**Tag normalization for variable names:** Tags are normalized to valid identifiers: lowercased, hyphens/spaces replaced with underscores, non-alphanumeric/underscore characters removed. The reserved names `all` and `tags` cannot be used as tag values (they are reserved for `lore_all` and `lore_tags`). If two tags normalize to the same identifier, their passages are merged under that variable.

In the Vento template, authors write:
```
{{ lore_all }}
```
or selectively:
```
{{ lore_character }}
{{ lore_comic_relief }}
```

**Empty variable guarantee:** All `lore_<tag>` variables discovered at scan time are present in the template context. If no passages match a tag, the variable resolves to an empty string `""` (not undefined). This prevents Vento render errors from undefined variables.

**Story context plumbing:** The current `renderSystemPrompt()` signature accepts only `series: string`. To support story-scoped lore, the signature, `RenderOptions` type, and all callers (`buildPromptFromStory`, chat handler, prompt preview) must be extended to also pass `story: string`. This is a prerequisite change tracked in the tasks.

**Rationale:** Direct integration avoids the overhead of the plugin hook system for a core feature. One variable per tag gives authors fine-grained control over what lore appears where in the prompt. The `lore_tags` array enables the prompt editor UI to show available tags.

**Alternatives considered:**
- *Vento custom filter* (`{{ "character" | lore }}`): Rejected — requires modifying the Vento engine configuration and the template validation whitelist.
- *Single `lore` variable*: Rejected — no selective injection by topic.
- *Plugin via `prompt-assembly` hook*: Rejected — lore codex is a core feature (see Decision 6); prompt fragments go to a fixed location in the template; authors need to place lore at specific positions.

### Decision 6: Core architecture

**Choice:** Implement lore codex as a **core feature** across backend and frontend, not as a plugin.

```
writer/
  lib/lore.ts              # Core: storage, retrieval engine, frontmatter parsing, tag normalization
  routes/lore.ts           # Core: CRUD API routes under /api/lore/
  lib/template.ts          # Modified: call lore retrieval to generate lore_* template variables
reader-src/src/
  views/LoreView.vue       # Core: lore management page
  components/lore/         # Core: LoreBrowser, LoreEditor components
  composables/useLoreApi.ts # Core: API client
```

The lore retrieval engine (`writer/lib/lore.ts`) is called directly by `renderSystemPrompt()` in `writer/lib/template.ts` during template rendering. It receives the active `series` and `story` context, scans the appropriate scope directories, computes effective tags, and returns a map of `lore_*` template variables that are spread into the Vento render context alongside existing variables.

**Rationale:** Implementing as a core feature avoids the architectural mismatch identified in the plugin system: plugins currently support lifecycle hooks and prompt fragments, but not route registration or frontend route/navigation extension. A core implementation follows the single responsibility principle — the lore subsystem is a cohesive feature with tightly coupled storage, retrieval, API, and UI concerns. Splitting it across core and plugin boundaries would violate SRP by scattering one feature's logic across two architectural layers. The direct integration path (`template.ts` → `lore.ts`) is also simpler and more maintainable than hook-based indirection.

**Alternatives considered:**
- *Full plugin*: Rejected — the plugin system lacks route registration and frontend extension points; adding those prerequisites would be a large change unrelated to lore.
- *Hybrid core + plugin*: Rejected — splitting one cohesive feature across core (routes, UI) and plugin (prompt injection) violates SRP and adds unnecessary indirection.

### Decision 7: Backend API design

**Choice:** REST API under `/api/lore/` with explicit scope prefixes to avoid routing ambiguity:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/lore/tags` | List all unique tags across all scopes |
| `GET` | `/api/lore/global` | List passages in global scope |
| `GET` | `/api/lore/global/*path` | Read a specific global passage |
| `PUT` | `/api/lore/global/*path` | Create or update a global passage |
| `DELETE` | `/api/lore/global/*path` | Delete a global passage |
| `GET` | `/api/lore/series/:series` | List passages in series scope |
| `GET` | `/api/lore/series/:series/*path` | Read a specific series passage |
| `PUT` | `/api/lore/series/:series/*path` | Create or update a series passage |
| `DELETE` | `/api/lore/series/:series/*path` | Delete a series passage |
| `GET` | `/api/lore/story/:series/:story` | List passages in story scope |
| `GET` | `/api/lore/story/:series/:story/*path` | Read a specific story passage |
| `PUT` | `/api/lore/story/:series/:story/*path` | Create or update a story passage |
| `DELETE` | `/api/lore/story/:series/:story/*path` | Delete a story passage |

**Rationale:** Explicit `global/`, `series/:series/`, `story/:series/:story/` prefixes eliminate the routing ambiguity of a single `:scope` parameter (where `fantasy/chapter-1` could be a series-scoped file or a story scope). Each scope type has a distinct URL pattern, making routes unambiguous and self-documenting. PUT for create-or-update simplifies the client.

### Decision 8: Migration from scenario.md

**Choice:** Migrate existing `scenario.md` files to `playground/lore/series/<series>/scenario.md` with frontmatter `tags: [scenario]`, `priority: 1000` (high priority to appear first). Remove the `scenario` template variable from `writer/lib/template.ts`. Update `system.md` to use `{{ lore_scenario }}` or `{{ lore_all }}` instead of `{{ scenario }}`. This is a hard break — no backward compatibility alias is provided for `{{ scenario }}`.

**Rationale:** Direct mapping preserves existing content. High priority ensures scenario content appears first in the concatenated output. The tag "scenario" provides backward discoverability via `{{ lore_scenario }}`. A clean break avoids long-lived compatibility shims.

**Migration steps:**
1. For each `playground/<series>/scenario.md`, create `playground/lore/series/<series>/scenario.md` with YAML frontmatter prepended
2. Remove scenario-loading logic from `writer/lib/template.ts`
3. Update `system.md` template to reference `{{ lore_scenario }}` (or `{{ lore_all }}`)
4. Delete original `scenario.md` files after migration is verified

## Risks / Trade-offs

- **[Filesystem scanning performance]** → Scanning many `.md` files on every prompt render could add latency. **Mitigation:** Cache passage metadata in memory; invalidate on file change detection (stat mtime) or API write operations. For v1, scan-on-render is acceptable given expected passage counts (< 100).

- **[Tag namespace collision]** → Directory-implicit tags could collide with explicit tags. **Mitigation:** This is intentional — the union makes them equivalent. Document that directory names and explicit tag values share the same namespace.

- **[Tag normalization edge cases]** → Tags like `comic-relief` normalize to `lore_comic_relief`; multiple tags could normalize to the same variable name (e.g., `comic relief` and `comic-relief`). **Mitigation:** Document normalization rules. Merged passages from colliding tags are acceptable — authors should use consistent tag naming. The `lore_tags` variable provides the original (unnormalized) tag names for reference.

- **[Template variable pollution]** → Many tags generate many `lore_*` variables, potentially colliding with other plugin variables. **Mitigation:** The `lore_` prefix provides namespacing. Reserved names (`all`, `tags`) cannot be used as tag values. Document that lore tag names should not start with plugin-reserved prefixes.

- **[Breaking change to system.md]** → Removing `{{ scenario }}` breaks existing templates. **Mitigation:** This is an intentional hard break. Migration is explicit and documented. The `{{ lore_scenario }}` variable replaces `{{ scenario }}` directly. Migration tasks include updating `system.md` as a required step.

- **[Template variable safety]** → Templates referencing `{{ lore_<tag> }}` for a tag that has no passages in the current scope will get an empty string. However, referencing a tag name that was never discovered across any scope will produce a Vento undefined variable error. **Mitigation:** Document that template authors should only reference tags they know exist, or use `{{ lore_all }}` for comprehensive injection. The prompt editor UI displays `lore_tags` to show available tags. For v1, this is an acceptable limitation.

- **[Path traversal in API]** → Scope/path parameters could be exploited. **Mitigation:** Reuse existing `safePath()` and `isPathContained()` validators from `writer/lib/story.ts`. All paths must resolve within `playground/lore/`. The `*path` wildcard is constrained to one level of tag subdirectory depth.

## Open Questions

1. **Caching strategy**: Should the lore engine cache passage metadata in memory between requests, or is scan-on-render acceptable for v1?
2. **Maximum passage size**: Should there be a size limit on individual passage files to prevent accidental token budget exhaustion?
3. **Template editor integration depth**: Should the prompt editor autocomplete `lore_*` variable names, or just list available tags?

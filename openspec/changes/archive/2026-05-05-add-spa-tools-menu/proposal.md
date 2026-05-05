## Why

Authoring a new series in HeartReverie today requires multiple disjoint round-trips: pick or type a series name in `StorySelector`, create a story via `POST /api/stories/:series/:name/init`, then open the lore codex separately and create one passage at a time through `LoreEditor.vue`. There is also no path to bring an existing SillyTavern (ST) character card (`.png`) into the lore codex — operators must manually copy/paste fields. Both gaps friction-bound the bootstrap of a new project.

A first-class **Tools** area in the SPA — symmetric with `/settings`, accessed from a header menu — gives us a place for one-shot authoring helpers that compose existing primitives (story init + lore PUT). The first two tools cover the high-pain workflows: a "快速新增" form that creates a series + story + (optional) character + (optional) world_info in one submit, and an "ST 角色卡轉換工具" that decodes a PNG character card into editable textareas which the user can review before importing as lore. Designing the Tools area now (instead of bolting these onto Settings) keeps Settings semantically about *configuration* and gives future utilities (importers, batch operations, validators) a natural home.

## What Changes

- **NEW** Top-level `/tools` route group, peer to `/settings`, with a `ToolsLayout.vue` analogous to `SettingsLayout.vue` (sidebar + `<router-view />`), driven by an extensible `toolsChildren` array in `router/index.ts` (parallel to `settingsChildren`).
- **NEW** Tools menu in `AppHeader.vue`: a 🧰 icon button next to the existing ⚙️ button opens a dropdown listing all tools defined in `toolsChildren` (using each route's `meta.title`). Menu is generic — adding a new tools child route automatically adds a menu entry, no header edits required.
- **NEW** Tool 1 — `快速新增` at `/tools/new-series` (`QuickAddPage.vue`): single form with required series + story names and optional character / world_info fields (display name, filename, body). Submits in one click.
  - The series + story are always created via `POST /api/stories/:series/:name/init` (existing endpoint).
  - The character lore file is created via `PUT /api/lore/story/:series/:story/<character-filename>` only if the character display name AND body are both non-empty (filename auto-derived if blank); otherwise skipped. The URL path is **scope-relative** — the backend already prepends `_lore/` (`writer/routes/lore.ts` `scopeSegments`); writing `/api/lore/story/.../_lore/<file>` would create a duplicated `_lore/_lore/` directory.
  - The world_info lore file is created via `PUT /api/lore/story/:series/:story/<world_info-filename>` only if the world_info display name AND body are both non-empty; otherwise skipped. The default filename `world_info.md` is rendered as a placeholder/computed default and does NOT count as user input — the user does not have to clear it to opt out.
  - Both lore writes use the existing lore API contract (`{ frontmatter, content }`). The backend frontmatter validator (`writer/routes/lore.ts` `validatePassageBody`) accepts ONLY `tags`, `priority`, and `enabled`; any extra fields (such as `name`) would be silently dropped at parse time. Tools therefore write the human display name into the markdown body (as an H1) and the filename, never into frontmatter.
  - Before writing, each tool issues a preflight GET against the target passage path; if the file already exists the tool surfaces an inline "已存在同名典籍" warning and the write is BLOCKED until the user explicitly confirms overwrite via a checkbox. Story-init's idempotent 200 response is also distinguished in the UI from a fresh 201 ("已存在同名故事，將沿用現有資料夾").
- **NEW** Tool 2 — `ST 角色卡轉換工具` at `/tools/import-character-card` (`ImportCharacterCardPage.vue`): drag-drop / file-input PNG upload (with a 16 MiB size cap and graceful errors for malformed/truncated chunks), **client-side** parse of PNG `tEXt` chunks (`ccv3` preferred over `chara`, both base64-encoded JSON conforming to the TavernCardV2/V3 spec), populate editable textareas for every imported field, then on **匯入** click write the *current textarea contents* (not the original PNG bytes) to the lore codex through the same scope-relative lore PUT endpoints used by Tool 1.
  - The user picks a target `series + story` (or types new ones — same UX as `StorySelector`) before import; the importer ensures the story is initialised, then writes one or more lore files: a character passage and, if the card includes a `character_book`, a world_info passage with each entry rendered into a single markdown body.
  - When the form has been edited and the user picks a *different* file, the importer SHALL prompt for confirmation before replacing the form state (no silent overwrite of dirty edits).
  - Imported `tags` are sanitised against the backend's tag validator (`writer/routes/lore.ts` `isValidTag`: non-empty, ≤100 chars, no `[`, `]`, `,`, `\n`, `\r`) before any network call: invalid tags are dropped with an inline warning, never silently sent to fail validation server-side.
  - The two tools are independent: Tool 1 works without ever touching a card; Tool 2's import button writes whatever the user sees on screen, so they can hand-edit or even delete fields after parsing.
- **NEW** `useTools` composable (`reader-src/src/composables/useTools.ts`) exposing the menu items derived from `toolsChildren` and a small click-outside helper for the dropdown. Strictly UI glue — does not own routing.
- **NEW** Frontend ST card parser library (`reader-src/src/lib/character-card-parser.ts`) that reads the PNG signature + IHDR + iterates `tEXt`/`zTXt`/`iTXt` chunks, base64-decodes the matched value, JSON-parses it, and normalises the result into a `ParsedCharacterCard` shape with both V3 and V2 inputs collapsed into one structure (V3 wins when both are present). Fully client-side; no backend dependency, no new server routes.
- **NEW** Tests (paths follow the existing `__tests__` co-location convention):
  - `reader-src/src/components/__tests__/ToolsMenu.test.ts` — header dropdown opens, lists items from a stubbed `toolsChildren`, navigates on click, closes on outside click and Escape.
  - `reader-src/src/components/__tests__/QuickAddPage.test.ts` — form validation (required fields), conditional skip of character/world_info, correct sequence of `init` + `PUT` calls with mocked fetch, collision preflight, error surfaces.
  - `reader-src/src/lib/__tests__/character-card-parser.test.ts` — fixtures for V2-only (`chara`), V3-only (`ccv3`), V3+V2 (V3 wins), missing both (rejects with a clear error), malformed base64, malformed JSON, non-PNG file, truncated chunk, oversized file (>16 MiB).
  - `reader-src/src/components/__tests__/ImportCharacterCardPage.test.ts` — parsed fields populate textareas; on edit + import, *edited* values (not originals) are written via lore PUT; `character_book` rendering produces one world_info file when present and zero when absent; dirty-form guard on second upload; tag sanitisation; collision preflight.
  - `reader-src/src/router/__tests__/isReadingRoute.test.ts` — predicate excludes `/settings`, `/settings/*`, `/tools`, `/tools/*` while accepting story slugs that *start with* the substrings (`/settings-archive/...`, `/tools-archive/...`).
- **NEW** Specs: `tools-menu`, `quick-add-tool`, `import-character-card-tool` (each captures its own contract).
- **MODIFIED** `vue-router` spec — adds the `/tools` parent route, `toolsChildren`, the `/tools/new-series` and `/tools/import-character-card` child routes (lazy-loaded `ToolsLayout`).
- **MODIFIED** `page-layout` spec — `AppHeader.vue` requirement gains a 🧰 tools-menu button next to the existing ⚙️ settings button; mobile rules (≤767 px) keep the tools button visible (matching the settings button rule).
- **MODIFIED** `settings-page` spec — extends the existing "last reading route" predicate so it also excludes paths exactly equal to `/tools` and paths starting with `/tools/`, keeping the symmetric exact-or-prefix rule that already protects against false-positive series slugs. The back-button behaviour itself is unchanged; only the capture predicate widens.

## Capabilities

### New Capabilities

- `tools-menu`: Top-level `/tools` route group with a `ToolsLayout.vue` (sidebar tab navigation + content area, mirroring `settings-page`), a 🧰 dropdown trigger in `AppHeader.vue` that lists every tool registered through the `toolsChildren` array, the `useTools` composable that drives the dropdown, and the contract that *adding a new tools child route automatically registers it in the menu* — header markup is not edited per-tool.
- `quick-add-tool`: `/tools/new-series` page that accepts series name, story name, and optional character / world_info fields (display name + filename + body), and on submit creates the story via the existing init endpoint plus the optional lore files via the existing lore PUT endpoint, with explicit skip rules when the optional groups are empty and a single transactional UX (one button, one progress indicator, one error surface).
- `import-character-card-tool`: `/tools/import-character-card` page that ingests a SillyTavern PNG character card client-side (PNG `tEXt` chunk decoder, `ccv3` preferred over `chara`, both base64+JSON), exposes every parsed field in editable textareas, and on import writes the *edited* on-screen content — not the original card bytes — to the lore codex via the existing lore PUT endpoints, including translation of an optional `character_book` into a single world_info passage.

### Modified Capabilities

- `vue-router`: Add the `/tools` parent route (lazy-loaded `ToolsLayout`), the `toolsChildren` exported array, and the `/tools/new-series` and `/tools/import-character-card` child routes.
- `page-layout`: Update the `AppHeader.vue` requirement to include the 🧰 tools-menu button (placement: immediately adjacent to ⚙️), state that it remains visible at all viewport widths just like the settings button, and clarify that the dropdown panel is rendered as a child of the header (not via `<Teleport>`) so it inherits header z-index.
- `settings-page`: Widen the last-reading-route capture predicate so it excludes `/tools` (exact) and paths starting with `/tools/` in addition to the existing `/settings` rules, keeping the back-to-reader behaviour symmetric across both top-level non-reading areas.

## Impact

- **Backend**: zero new endpoints, zero new files. Tool 1 and Tool 2 compose `POST /api/stories/:series/:name/init` (`writer/routes/chapters.ts`) and `PUT /api/lore/{global,series,story}/...` (`writer/routes/lore.ts`).
- **Frontend (new)**:
  - `reader-src/src/components/ToolsLayout.vue`
  - `reader-src/src/components/QuickAddPage.vue`
  - `reader-src/src/components/ImportCharacterCardPage.vue`
  - `reader-src/src/components/ToolsMenu.vue` (the header dropdown)
  - `reader-src/src/composables/useTools.ts`
  - `reader-src/src/lib/character-card-parser.ts`
  - `reader-src/src/types/character-card.ts` — `TavernCardV2`, `TavernCardV3`, `ParsedCharacterCard` types.
- **Frontend (modified)**:
  - `reader-src/src/router/index.ts` — add `toolsChildren`, `/tools` route.
  - `reader-src/src/components/AppHeader.vue` — render `<ToolsMenu />` next to the settings button; share the existing button styling.
  - The `router.afterEach` "last reading route" guard (currently filtering `/settings`) extends to also filter `/tools` paths.
- **Tests (new)**: see What Changes for the four new test files. Existing settings/router tests are not modified beyond adapting any "all top-level routes" assertion.
- **Specs**:
  - Add `openspec/specs/tools-menu/`, `openspec/specs/quick-add-tool/`, `openspec/specs/import-character-card-tool/` after archive.
  - Edit `openspec/specs/vue-router/spec.md` (add `/tools` requirements; extend last-reading-route predicate).
  - Edit `openspec/specs/page-layout/spec.md` (add 🧰 button to header requirement).
- **Docs**: `README.md` mentions the Tools area in the user-facing feature list; `AGENTS.md` references the new files in its component map. (Documentation-only, no code coupling.)
- **Plugins**: zero impact. The contract surface (CSS variable names, plugin loader hooks, lore API) is unchanged.
- **Migration / data**: none. Pre-release project, zero in-the-wild users; new routes are additive and the existing series/story/lore filesystem layout is the source of truth that both tools write into.

## Context

The HeartReverie reader/writer SPA already has two top-level layouts: `MainLayout.vue` (reading at `/`, `/:series/:story`, `/:series/:story/chapter/:n`) and `SettingsLayout.vue` (configuration at `/settings/*`). Settings is driven by a `settingsChildren: RouteRecordRaw[]` array in `reader-src/src/router/index.ts` whose entries each carry a `meta.title`; the `SettingsLayout` sidebar iterates this array to render `<router-link>`s, so adding a tab is a router-only edit. A `router.afterEach` global guard remembers the *last reading route* (anything whose path is **not** `/settings` and does **not** start with `/settings/`) so the back-button can return to where reading was interrupted.

The backend already exposes everything the two tools need:

- `POST /api/stories/:series/:name/init` (`writer/routes/chapters.ts`) creates the series+story directory and an empty `001.md`. Idempotent — a second call returns 200 instead of 201.
- `PUT /api/lore/story/:series/:story/:path{.+}` (`writer/routes/lore.ts`) writes a single passage with body `{ frontmatter, content }`. Path validation rejects traversal, requires `.md`, and limits depth to two segments.

`reader-src/src/components/lore/LoreEditor.vue` and `useLoreApi.ts` already cover the on-the-wire shape (`{ frontmatter: {...}, content: "..." }`) and frontmatter conventions (tags, priority, enabled). The lore-storage spec (`openspec/specs/lore-storage/`) defines that the immediate parent subdirectory provides an implicit tag and the filename stem provides another implicit tag — meaning a character file at `<series>/<story>/_lore/<filename>.md` *with no `tags:` frontmatter* still receives `<filename-stem>` as a tag. Authors can therefore rely on filename + frontmatter together for retrieval.

SillyTavern character cards encode their JSON payload inside PNG `tEXt` chunks. The reference parser at `https://github.com/SillyTavern/SillyTavern/blob/release/src/character-card-parser.js` walks the PNG signature → IHDR → repeated chunks, reads `keyword\0text` from each `tEXt`, base64-decodes, and JSON-parses. Two keywords are relevant: `chara` (V2) and `ccv3` (V3). When both are present, V3 wins. The schema at `https://github.com/SillyTavern/SillyTavern/blob/release/src/spec-v2.d.ts` defines `TavernCardV2` with `spec`, `spec_version`, and a `data` object containing `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `creator_notes`, `system_prompt`, `post_history_instructions`, `alternate_greetings`, `character_book?`, `tags`, `creator`, `character_version`, and `extensions`. V3 wraps the same shape with `spec: "chara_card_v3"`.

The project is pre-release (zero deployed users), so there is no compatibility constraint and no migration step.

## Goals / Non-Goals

**Goals**
- Give the SPA a third top-level area peer to `/` and `/settings`, dedicated to *one-shot authoring helpers* that compose existing primitives without inventing new backend surface.
- Make the tools menu **purely declarative**: a single `toolsChildren` array drives both the routes and the dropdown — adding a tool never edits header markup.
- Quick-Add: turn series-create + story-create + lore-create into one form submission with a clear *all-or-skipped* rule per optional lore group (no half-written character file).
- ST card import: parse PNG cards in the browser (zero backend dependency), expose every parsed field as an editable textarea, and write *exactly what is on screen at click time* — preserving the user's edits over the original card values.
- Reuse `vue-router` last-reading-route logic so leaving Tools behaves identically to leaving Settings.

**Non-Goals**
- A generic "tool plugin host" or runtime tool registry — the menu reads from a static `toolsChildren` array. Plugins do not contribute tools in v1.
- Editing existing series/stories/lore through these tools (Quick-Add is *create*-only; Import is *create*-only). The lore editor already covers update.
- Bulk import (multiple cards, batch mode) — one PNG per session.
- ST extensions / `book.entries.extensions` — the importer collapses each `character_book` entry into a markdown body but does not preserve provider-specific extension blobs.
- Server-side PNG parsing — see D1.
- Reusing the SillyTavern parser source verbatim — see D2.

## Decisions

### D1: Parse the PNG client-side, not in the backend

| Approach | Pros | Cons |
| --- | --- | --- |
| **Client-side parser (chosen)** | Zero new backend routes; PNG bytes never traverse the server (privacy + bandwidth); easy to mock in unit tests with `Blob`/`ArrayBuffer`; instant preview before any network call; fits the "Tool 2's import button writes the textareas, not the file" UX exactly because the parser only feeds the form. | ~150 LOC of binary parsing code in the frontend; we own a reimplementation. |
| Backend parser (e.g. `POST /api/tools/parse-card`) | Could share logic with hypothetical future server-side imports. | Net-new authenticated route + middleware + RFC 9457 wiring; extra round-trip delays preview; PNG bytes hit disk via Hono body parsing; nothing else on the backend needs PNG parsing. |
| Use a third-party npm package | Smallest code footprint. | New dependency surface to audit and pin; the parser is small enough to own; SillyTavern's reference parser is GPL-compatible but importing it adds AGPL-licensed code review burden for ~150 lines. |

**Choice**: client-side. Add `reader-src/src/lib/character-card-parser.ts` (a hand-rolled `parseCharacterCard(file: File): Promise<ParsedCharacterCard>`). The parser:
1. Reads the file via `await file.arrayBuffer()`.
2. Verifies the 8-byte PNG signature `89 50 4E 47 0D 0A 1A 0A`; rejects with `Error("Not a PNG file")` otherwise.
3. Iterates chunks: `length(4) | type(4) | data(length) | crc(4)`. Stops at `IEND`.
4. For each `tEXt` chunk: split data at the first `0x00` → `keyword`, `text`. (For `zTXt`/`iTXt` we record but skip — SillyTavern only writes `tEXt`.)
5. Collects `chara` and `ccv3` candidates. If `ccv3` is present, base64-decode + JSON-parse it; else fall back to `chara`. If both fail or are absent, throw `Error("No SillyTavern character data found")`.
6. Normalises into `ParsedCharacterCard` (a flat shape covering both V2 and V3).

### D2: Don't reuse the SillyTavern source verbatim

The reference parser at SillyTavern depends on Node `Buffer`, `pngjs`, and CommonJS interop — none of which fit a Vite/Vue browser bundle. The PNG `tEXt` walk is ~70 lines of straightforward `DataView` work. Owning ~150 lines beats pulling in a Node-shaped dependency we'd have to polyfill.

### D3: `/tools` mirrors `/settings` instead of nesting under it

Settings is for *configuration that persists across sessions* (theme, prompt, LLM defaults). Tools are *one-shot authoring helpers*. Folding tools into `/settings/*` would conflate the two and force the settings sidebar to grow with verbs ("Quick Add", "Import Card") that don't belong next to nouns ("Theme", "LLM"). A peer route makes the distinction visible in the URL, gives Tools its own sidebar (which can later host categories like "Importers" / "Exporters" / "Validators"), and keeps the back-to-reader behaviour identical because the predicate already keys on path prefix.

### D4: Tools menu is a `toolsChildren`-driven dropdown, not a sidebar entry on the home view

A persistent sidebar on `/` (the reader) wastes the operator's screen real-estate during the 99% reading case. A header dropdown is invoked on demand, scales to N tools without layout pressure, and degrades naturally on mobile (where the existing header is already responsive — see `page-layout` spec). The dropdown reads from `router.options.routes` looking up the `/tools` entry's `children` so a new tool is registered exclusively in `router/index.ts`.

### D5: Quick-Add's "all-or-skipped" rule per optional lore group

Each optional group has three inputs (display name, filename, body). The group is **active** iff `displayName.trim() !== ""` AND `body.trim() !== ""`. The filename input is *not* part of the activity test — it is treated as a derived/default-valued field (world_info pre-fills `world_info.md`; character pre-fills a slug derived from the display name). When the group is inactive (both name and body empty after trim) the lore write is skipped entirely, even if the filename input still shows its placeholder/default. When the group is active, the filename is required (auto-filled by default but the user may override) and is independently validated against the lore filename rules (`.md` suffix, no `/`, no `..`, ≤ backend limits).

This avoids:

- **Display name without body** → metadata-only file that fails to render in any prompt template.
- **Body without display name** → no human label and no first-line H1; reduces utility.
- **Default filename treated as "user opt-in"** → previously a placeholder `world_info.md` would force the user to clear it to skip. Now a placeholder filename never makes a group active.

If the group is active but its filename is blank (e.g. user cleared it), the form fills it with the appropriate default before the activity rule runs. The series + story groups remain unconditionally required.

Frontmatter for both files defaults to `{ enabled: true, priority: 0 }` and intentionally omits `tags` so the lore-storage implicit-tag rules (parent directory + filename stem) provide retrieval keys automatically. Crucially, **the human display name is NOT written into frontmatter** — the backend frontmatter validator (`writer/routes/lore.ts` `validatePassageBody`) only accepts `tags`, `priority`, `enabled` and silently drops every other key. The display name lives in (a) the filename and (b) an H1 at the top of the body (`# <display name>\n\n<body>`).

### D5b: Collision detection on lore PUT

The lore PUT endpoint silently overwrites an existing file (`writer/routes/lore.ts:writePassage` — no preflight, no 409). Both Quick-Add and the importer therefore perform an explicit preflight: a GET against the same scope-relative path resolves to either a populated passage (file exists) or a 404 (does not exist). On *exists*, the tool surfaces an inline warning ("已存在同名典籍：<path>") and disables the write button until the user explicitly toggles a "覆寫現有典籍" checkbox. Only then is the PUT issued. Story-init's response distinguishes 200 (existing series/story dir) from 201 (newly created); the 200 case shows a non-blocking "已沿用現有故事資料夾" notice but does not require a confirmation.

### D6: ST importer writes the textarea content, not the parsed PNG

The user-visible contract is: "edit then import." Implementation:

1. On file pick, the page first compares the new file against any *dirty* form state. If the form has been edited since the last hydration, it prompts "丟棄目前編輯並載入新檔案？" before proceeding (cancel → keep current state, no parsing). After confirmation (or on a clean form), `parseCharacterCard()` returns `ParsedCharacterCard`.
2. The page hydrates a `reactive` form state from the parsed result (all string fields, plus a `bookEntries: Array<{ name, content, keys }>` for `character_book.entries`). A snapshot of this hydrated state is stashed for dirty-detection on subsequent file picks.
3. Each field is rendered as a textarea bound with `v-model` to the form state.
4. The 匯入 button reads from the **form state** (never the original `parsed` ref), runs collision preflight (D5b) and tag sanitisation (per-tag drop with inline warning if it violates `isValidTag`), then constructs:
   - One character lore file (`<character-filename>.md`) whose frontmatter contains only `{ enabled: true, priority: 0 }` plus optional sanitised `tags`. The body opens with `# <display name>` and assembles the major narrative fields under `## Description`, `## Personality`, `## Scenario`, `## First Message`, `## Example Messages`, `## System Prompt`, `## Post-History Instructions`, `## Alternate Greetings` headings (omitting any heading whose corresponding form field is empty). Sections are joined by `\n\n`.
   - Optionally one world_info file (`<world_info-filename>.md`, default `world_info.md`) when `bookEntries.length > 0`. Each entry becomes a `## <entry.name>` section followed by `**Keys:** <comma-joined keys>` and the entry content. The display name is again written as `# <world_info display name>` at the top of the body, never in frontmatter.
5. Both files are written through the lore PUT endpoint at the **scope-relative** path (no `_lore/` prefix in the URL — the backend prepends it).

This makes the parser strictly an autofill: it cannot ship anything to the server without going through the textareas the user just inspected.

### D7: V3-wins-over-V2 happens during parsing, not during write

We don't expose two parsed shapes to the UI. The parser collapses both into one normalized `ParsedCharacterCard` and the rest of the page is unaware of which spec the file used. Concrete rule inside the parser:

- If `ccv3` chunk parses successfully, use it.
- Else if `chara` chunk parses successfully, use it.
- Else throw.

V3 ⊇ V2 at the data level (V3 adds top-level `spec`/`spec_version` wrappers and a richer `character_book.entries[].extensions` blob — irrelevant for our markdown rendering).

### D8: Last-reading-route guard extension

The current `vue-router` spec excludes `/settings` (exact) and `/settings/` (prefix) from the last-reading-route capture. We extend the predicate to also exclude `/tools` (exact) and `/tools/` (prefix). Symmetric rule, no `startsWith("/tools")` (would mis-classify a hypothetical `/tools-archive` series). Implementation lives in the same `router.afterEach` guard.

### D9: No `<Teleport>` for the dropdown

Header sticky positioning + z-index stack is already established by `page-layout`. Rendering the dropdown as a child of the header inherits both. Teleport-to-`<body>` would require duplicating the z-index reasoning and complicate keyboard focus restoration when the header collapses on mobile.

### D10: PNG chunk reader uses `DataView`, not `TextDecoder` for the keyword

`tEXt` keywords are 1–79 bytes of *Latin-1*. `TextDecoder("latin1")` is supported in all evergreen browsers, but the keyword set we care about (`chara`, `ccv3`) is ASCII, so `String.fromCharCode` over the bytes up to the first 0x00 is sufficient and avoids a polyfill question for older WebViews. The base64 payload after the null byte *is* ASCII by definition (base64 alphabet), so the same approach works for the value before `atob()`.

## Risks / Trade-offs

- **Risk**: A user lands on `/tools/new-series`, fills in 3 of 3 character fields plus 0 of 3 world_info fields, submits — the story init succeeds but the character lore PUT fails (e.g. invalid filename). → **Mitigation**: Quick-Add issues the writes sequentially (story init → character → world_info) and on the first failure stops, surfacing a single error toast that names which step failed. The story directory may already exist — that's the normal idempotent state and matches today's `StorySelector` behaviour after a failed create.
- **Risk**: A malformed PNG (not a card, just a regular image) is dropped. → **Mitigation**: Parser throws `"No SillyTavern character data found"`; UI displays the message inline above the file picker; form fields are not populated.
- **Risk**: An oversized file (e.g. a 200 MB PNG) is dropped and exhausts the WebView's memory before parsing fails. → **Mitigation**: A 16 MiB hard cap is enforced **before** reading the file into an `ArrayBuffer`; over-cap files reject with `"檔案過大（>16 MiB）"`. Truncated PNG streams (`tEXt` chunk header claims more bytes than remain in the buffer) are detected and rejected with `"PNG 區塊不完整"` rather than silently using whatever ASCII the parser saw.
- **Risk**: An ST card with extremely long fields (e.g. 100 KB `mes_example`) overwhelms the textarea or the resulting lore body. → **Trade-off**: We render textareas with `wrap="off"` and a fixed max-height with internal scroll. The lore PUT body has no enforced size limit beyond Hono's default; we accept this — a long body is not pathological for a markdown lore passage.
- **Risk**: The `character_book` field is highly variable across cards (some omit it; some carry hundreds or thousands of entries). → **Mitigation**: All entries are rendered (no artificial display cap) but the parser enforces a safety ceiling of 1000 entries; cards beyond that are rejected with `"character_book.entries 超過 1000 筆，無法匯入"` rather than freezing the page. Entry textareas live inside a `<details>` collapsible block so the initial scroll cost is bounded.
- **Risk**: Adding a third top-level layout grows the bundle. → **Trade-off**: Both `ToolsLayout.vue` and the two pages are lazy-loaded via dynamic `import()` exactly as `SettingsLayout` is — first paint of the reader is unaffected.
- **Risk**: Two tools live in three new specs. The capability boundary could blur if Tool 2 starts borrowing UI atoms from Tool 1. → **Mitigation**: Shared concerns (the series/story picker the importer uses) live in `tools-menu` (the layout), not in either tool's spec. Each tool's spec stays focused on its own contract.

## Migration Plan

None. Pre-release project; routes are additive; no existing data is touched.

## Open Questions

- **Q1**: Should the ST importer's series/story picker reuse `StorySelector.vue` directly, or a stripped-down inline variant? → Tentative answer: inline variant. `StorySelector` is tightly coupled to `useStorySelector`'s router-driven state; the importer needs *picker semantics without auto-navigation*. To be confirmed during implementation.
- **Q2**: Should we add a smoke test that mocks the lore API + a PNG fixture end-to-end? → Tentative yes, but kept out of the spec unit-test list to avoid prescribing fixture mechanics. Will be added during implementation if it doesn't introduce a fragile dependency.

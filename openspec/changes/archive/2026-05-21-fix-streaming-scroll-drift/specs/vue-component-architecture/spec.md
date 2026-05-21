## MODIFIED Requirements

### Requirement: ContentArea sidebar relocation tracks render invalidation

`reader-src/src/components/ContentArea.vue` SHALL relocate every `.plugin-sidebar` element produced inside `<ChapterContent>` into the `<Sidebar>` element. The relocation effect SHALL track `currentContent`, `isLastChapter`, `pluginsReady`, AND `renderEpoch` (from `useChapterNav()`) as dependencies — at minimum the union sufficient to re-run whenever the chapter view is re-rendered for any reason. The effect SHALL run with `flush: "post"` and SHALL `await nextTick()` before reading `.plugin-sidebar` so Vue's `v-html` patches have completed. The effect SHALL clear the `<Sidebar>` contents at the start of a relocation pass that actually rewrites the sidebar so stale panels from a previous chapter or a previous render cannot leak. The effect SHALL skip the relocation step entirely when `pluginsSettled` is `false` or `currentContent` is empty.

Because `commitContent()` now leaves rendered v-html DOM intact (no remount during streaming), the relocation effect SHALL be idempotent across consecutive streaming bumps of `renderEpoch`. On each run, after collecting the set of `.plugin-sidebar` candidate panels currently rendered inside `<ChapterContent>`, the effect SHALL compare them against the panels already mounted inside `<Sidebar>` using a stable fingerprint derived from each panel's serialized DOM (e.g. `outerHTML` joined with a separator that cannot appear in HTML such as `\u0000`). The effect SHALL choose its branch as follows:

1. **Fingerprint matches AND `<Sidebar>` already has panels** — the effect SHALL NOT clear `<Sidebar>` (no `innerHTML = ""`), SHALL NOT re-append panels (existing sidebar child node references SHALL remain identical before and after the run), and SHALL remove the duplicate `.plugin-sidebar` nodes from `<ChapterContent>` so the same panel is not rendered in both columns.
2. **`currentContent` actually changed (chapter navigation, edit/save) OR `<Sidebar>` is currently empty** — the effect SHALL clear `<Sidebar>` and move every candidate panel into it.
3. **Same `currentContent`, fingerprint differs, sidebar populated** — the effect SHALL remove the candidate panels from `<ChapterContent>` and leave the existing sidebar panels intact. This covers transient re-render states where the candidate panel is a placeholder that will be replaced by the plugin's full output in a subsequent commit; the next commit will hit branch 1 (fingerprint match) once the plugin re-injects its panel, or branch 2 if `currentContent` is invalidated.

#### Scenario: Sidebar relocation re-runs after byte-identical edit
- **WHEN** the user edits the current chapter to byte-identical content and saves
- **THEN** the rendered chapter view is invalidated, `renderEpoch` increments, and the relocation watch SHALL re-run, populating `<Sidebar>` with the freshly-rendered `.plugin-sidebar` panels

#### Scenario: Sidebar is cleared when navigating to a chapter without plugin panels
- **WHEN** the user navigates from a chapter whose render produced `.plugin-sidebar` panels to a chapter whose render does not
- **THEN** the `<Sidebar>` SHALL be empty after the watch settles — no leaked panels from the previous chapter

#### Scenario: Sidebar relocation re-runs after pluginsReady transitions
- **WHEN** `pluginsReady` flips from `false` to `true` while `currentContent` is non-empty (e.g. async plugin registration completes after the initial render)
- **THEN** the relocation watch SHALL re-run and SHALL relocate any newly-produced `.plugin-sidebar` panels into `<Sidebar>`

#### Scenario: Streaming bumps do not destroy already-relocated sidebar panels
- **WHEN** `commitContent()` fires repeatedly during LLM streaming, bumping `renderEpoch` once per chunk, AND the produced `.plugin-sidebar` panels serialize to the same HTML as the panels already in `<Sidebar>`
- **THEN** sidebar panels already moved into `<Sidebar>` by an earlier relocation pass SHALL remain in place across every chunk; the relocation watch SHALL NOT clear `<Sidebar>` and SHALL NOT re-append the panels; duplicate panel nodes in `<ChapterContent>` for that chunk SHALL be removed so the panel does not appear twice

#### Scenario: Streaming bump that actually changes chapter text re-relocates
- **WHEN** a streaming chunk extends `currentContent` (chapter text grows) AND the produced `.plugin-sidebar` panels serialize differently from the panels currently in `<Sidebar>`
- **THEN** the watch SHALL clear `<Sidebar>` and move the freshly-rendered panels into it (branch 2 — `contentChanged` path)

#### Scenario: Same chapter text but transient placeholder panel re-emitted
- **WHEN** `renderEpoch` bumps while `currentContent` remains byte-identical AND a candidate `.plugin-sidebar` panel appears in `<ChapterContent>` whose serialized HTML differs from the panel currently in `<Sidebar>` (e.g. plugin frontend-render hasn't re-injected its full output yet for this commit)
- **THEN** the watch SHALL remove the candidate panel from `<ChapterContent>` and SHALL leave the existing sidebar panel in place (branch 3); the populated sidebar panel SHALL be preserved until a subsequent commit either matches its fingerprint (branch 1) or invalidates `currentContent` (branch 2)


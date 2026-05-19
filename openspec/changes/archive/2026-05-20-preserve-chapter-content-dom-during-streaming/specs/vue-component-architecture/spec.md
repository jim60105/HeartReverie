## MODIFIED Requirements

### Requirement: ChapterContent v-html token list keys on remountToken

`reader-src/src/components/ChapterContent.vue` SHALL render its rendered-token list with a `v-for` whose `:key` includes the current `remountToken` value (e.g. `:key="\`${idx}-${remountToken}\`"`). The key SHALL NOT include `renderEpoch`. As a result, ordinary `commitContent()` invocations — which bump `renderEpoch` but NOT `remountToken` — SHALL NOT cause any `<div v-html="token.content">` (nor any `<VentoErrorCard>`) to unmount. Vue's `v-html` directive SHALL patch the existing element's `innerHTML` in place when the bound string changes.

A force-remount is only required when a caller has externally mutated the rendered DOM in a way Vue cannot recover from on its own — specifically: `ContentArea.vue`'s sidebar-relocation watch moves `.plugin-sidebar` children out of the v-html div via `appendChild`. If a subsequent re-render produces byte-identical token strings (cancel-edit is the canonical case), Vue's `v-html` short-circuits and the moved children never reappear. The dedicated `forceTokenRemount()` helper exposed by `useChapterNav()` SHALL be used by such callers; it increments `remountToken` (forcing the v-for to remount the affected node) AND `renderEpoch` (so downstream watchers — sidebar relocation, `chapter:dom:ready` dispatch — still fire).

When `ChapterContent` toggles out of edit mode via `cancelEdit` (the user pressed 取消), the v-if-gated tokens template is re-mounted and recreates `.plugin-sidebar` nodes inside chapter content. Because cancel does NOT mutate chapter content, no other reactive signal would notify `ContentArea`'s sidebar-relocation watch. `cancelEdit` SHALL therefore call `forceTokenRemount()` (exposed by `useChapterNav()`) so the relocation watch re-runs, clears the stale sidebar copies, and moves the freshly-recreated panels into place. Without this call the user ends up with duplicated panels (originals in sidebar plus new copies in content) after pressing 取消.

#### Scenario: Streaming commit does not remount v-html nodes

- **WHEN** `commitContent()` is invoked with a new chapter content string (e.g. on each WebSocket `chapters:content` push during LLM streaming) so that `currentContent` and `renderEpoch` change but `remountToken` does NOT
- **THEN** the existing rendered `<div v-html>` root element instance SHALL be reused (Vue patches its `innerHTML` in place, which still re-parses descendants — only the wrapper element instance is guaranteed stable); an imperative marker placed on the v-html ROOT element before the commit (e.g. `el.setAttribute('data-test-marker', 'kept')`) SHALL survive the commit; the document scroll position SHALL be preserved for a reader who has scrolled below the fold

#### Scenario: Chapter navigation reuses v-html root and re-parses descendants

- **WHEN** `currentContent` changes to a different chapter's content (different `tokens` string contents) without `remountToken` changing — e.g. the user clicks Next while the WebSocket subscription stays on the same story
- **THEN** the v-html ROOT element instance at v-for index 0 SHALL still be reused (Vue patches `innerHTML`); the rendered descendants are re-parsed from the new content; `chapter:dom:ready` SHALL be dispatched via the `renderEpoch` bump so plugins re-walk the new descendants

#### Scenario: Byte-identical re-render via forceTokenRemount restores externally-mutated v-html children

- **WHEN** a caller invokes `forceTokenRemount()` while the rendered-token list is byte-identical to the previous render
- **THEN** `ChapterContent` SHALL remount each token element so that any DOM children removed externally (e.g. by the sidebar relocation watch) are recreated from the v-html string

#### Scenario: Cancel from edit mode does not duplicate sidebar panels

- **WHEN** the user clicks 編輯 to enter edit mode and then 取消 to leave without saving
- **THEN** `cancelEdit` SHALL call `forceTokenRemount()` so `ContentArea`'s sidebar relocation watch re-runs, leaving exactly one set of `.plugin-sidebar` panels in the sidebar and zero in chapter content

### Requirement: ContentArea sidebar relocation tracks render invalidation

`reader-src/src/components/ContentArea.vue` SHALL relocate every `.plugin-sidebar` element produced inside `<ChapterContent>` into the `<Sidebar>` element. The relocation effect SHALL track `currentContent`, `isLastChapter`, `pluginsReady`, AND `renderEpoch` (from `useChapterNav()`) as dependencies — at minimum the union sufficient to re-run whenever the chapter view is re-rendered for any reason. The effect SHALL run with `flush: "post"` and SHALL `await nextTick()` before reading `.plugin-sidebar` so Vue's `v-html` patches have completed. The effect SHALL clear the `<Sidebar>` contents at the start of every run so stale panels from a previous chapter or a previous render cannot leak. The effect SHALL skip the relocation step entirely when `pluginsSettled` is `false` or `currentContent` is empty.

Because `commitContent()` now leaves rendered v-html DOM intact (no remount during streaming), the relocation effect SHALL be idempotent across consecutive streaming bumps of `renderEpoch`: it SHALL detect that `.plugin-sidebar` panels already in `<Sidebar>` are still valid and SHALL NOT clear them unless their corresponding source panels have actually changed (the content-key based logic already present in `ContentArea.vue` satisfies this — it is retained as part of this change).

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

- **WHEN** `commitContent()` fires repeatedly during LLM streaming, bumping `renderEpoch` once per chunk
- **THEN** sidebar panels already moved into `<Sidebar>` by an earlier relocation pass SHALL remain in place across every chunk; the relocation watch SHALL NOT clear them unless `currentContent`'s underlying text actually changes in a way that invalidates them

## MODIFIED Requirements

### Requirement: Frontend exposes edit, rewind, and branch actions per chapter

The reader frontend SHALL provide UI controls to invoke the three mutation endpoints on the currently displayed chapter. A composable `reader-src/src/composables/useChapterActions.ts` SHALL expose async functions `editChapter(number, content)`, `rewindAfter(number)`, and `branchFrom(number, newName?)`. Each function SHALL use `useAuth().getAuthHeaders()` to authenticate and SHALL surface backend error responses to the caller. `reader-src/src/components/ChapterContent.vue` SHALL render an action toolbar on each chapter containing at minimum an "Edit" control that opens an inline textarea pre-populated with the current chapter content, a "Rewind to here" control, and a "Branch from here" control.

**After a successful edit the frontend SHALL call `useChapterNav().refreshAfterEdit(targetChapter)` (NOT `reloadToLast()`), where `targetChapter` is the chapter number the user edited. This guarantees the user stays on the chapter they just modified instead of being teleported to the last chapter of the story. `refreshAfterEdit` SHALL invalidate the rendered chapter view such that, when `<ChapterContent>` next renders, the markdown rendering pipeline re-runs and plugin `frontend-render` and `chapter:render:after` hooks are dispatched for that render — even when the new content is byte-identical to the old content. The `ContentArea.vue` sidebar relocation watch (defined in the `vue-component-architecture` spec) SHALL re-run as part of the same render-invalidation cycle so any newly-produced `.plugin-sidebar` panels are moved into `<Sidebar>`.**

After a successful rewind the frontend SHALL reload the chapter list and navigate to the new last chapter (`reloadToLast()`). After a successful branch the frontend SHALL navigate to the newly created story via Vue Router. These controls SHALL be unconditionally available — backend mode is the only reader mode and supports all three mutations.

#### Scenario: Edit flow updates content and stays on the edited chapter
- **WHEN** the user clicks "Edit" on chapter 2, modifies the text, and clicks "Save"
- **THEN** the frontend SHALL call `PUT /api/stories/:series/:name/chapters/2`, and on HTTP 200 SHALL call `useChapterNav().refreshAfterEdit(2)`. After the call resolves, `currentIndex` SHALL correspond to chapter 2 (not the last chapter), the URL SHALL be `/<series>/<story>/chapter/2`, and `<ChapterContent>` SHALL have re-rendered chapter 2 with all plugin `frontend-render` and `chapter:render:after` hooks dispatched

#### Scenario: Edit flow re-renders even on byte-identical save
- **WHEN** the user opens the editor on chapter 3, makes no changes, clicks "Save", and the server returns the unchanged content
- **THEN** `refreshAfterEdit(3)` SHALL invalidate the rendered chapter view (via `triggerRef` on `currentContent` plus a `renderEpoch` increment, as defined in the `chapter-navigation` spec), so that when `<ChapterContent>` next renders, `tokens` is re-evaluated and plugins that mutate tokens (e.g. `chapter:render:after` decorators) re-apply their effects

#### Scenario: Edit flow does not call reloadToLast
- **WHEN** the user saves an edit on any chapter
- **THEN** `ChapterContent.vue#saveEdit` SHALL NOT call `useChapterNav().reloadToLast()`; it SHALL call `refreshAfterEdit(targetChapter)`

#### Scenario: Rewind confirms before deleting
- **WHEN** the user clicks "Rewind to here" on chapter 2 and confirms the action
- **THEN** the frontend SHALL call `DELETE /api/stories/:series/:name/chapters/after/2`, and on HTTP 200 SHALL reload the chapter list and navigate to chapter 2 via `reloadToLast()`

#### Scenario: Branch navigates to the new story
- **WHEN** the user clicks "Branch from here" on chapter 3 and submits the dialog
- **THEN** the frontend SHALL call `POST /api/stories/:series/:name/branch` with `fromChapter: 3`, and on HTTP 201 SHALL navigate via Vue Router to the named `chapter` route `/:series/:story/chapter/:chapter` (resolving to `/:series/<newName>/chapter/3` — the actual path pattern registered in `reader-src/src/router/index.ts`)

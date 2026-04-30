## ADDED Requirements

### Requirement: ChapterContent dispatches chapter:dom:ready after render commits

The `ChapterContent.vue` component SHALL dispatch the frontend hook stage `chapter:dom:ready` exactly once per render commit, including the initial mount commit and every subsequent commit triggered by a change to its `tokens` prop or to `renderEpoch`. The dispatch SHALL be wired via a Vue `watch` (or equivalent reactivity primitive) on `[tokens, renderEpoch]` configured with `flush: "post"` and `immediate: true`, ensuring the dispatch fires AFTER Vue has applied the v-html update to the live DOM.

The dispatch context SHALL contain:
- `container`: the chapter's root `HTMLElement` (the `<div class="chapter-content">` element rendered by the component template).
- `tokens`: the same `RenderToken[]` array consumed by the template's `v-for`.
- `rawMarkdown`: the original chapter content string the tokens were produced from.
- `chapterIndex`: the zero-based index of the chapter (the value already exposed to the template for navigation).

The component SHALL NOT dispatch `chapter:dom:ready` in edit mode (when the chapter editor textarea is showing instead of the rendered tokens), because the rendered DOM does not exist in that state. When edit mode exits and the v-html template re-mounts, the watcher's normal commit-driven dispatch SHALL fire.

#### Scenario: Initial mount dispatches chapter:dom:ready once
- **WHEN** a `ChapterContent` instance mounts for the first time with a non-empty `tokens` prop
- **THEN** after Vue's first post-flush tick, `chapter:dom:ready` SHALL have been dispatched exactly once with the live container element

#### Scenario: Render-epoch bump dispatches again
- **WHEN** the parent calls `bumpRenderEpoch()` (e.g., after cancelling an edit) and the component re-mounts its v-html template
- **THEN** after the post-flush tick, `chapter:dom:ready` SHALL be dispatched again with the freshly-mounted container element; the new container element reference SHALL be different from the previous one (because the template was re-mounted)

#### Scenario: Edit mode does not dispatch
- **WHEN** the user enters edit mode (the chapter editor textarea is shown instead of rendered tokens)
- **THEN** `chapter:dom:ready` SHALL NOT be dispatched while edit mode is active

#### Scenario: Cancelling edit re-dispatches
- **WHEN** the user cancels an active edit, the component exits edit mode and remounts the rendered token template
- **THEN** after the post-flush tick following the remount, `chapter:dom:ready` SHALL be dispatched with the new container element

### Requirement: ChapterContent dispatches chapter:dom:dispose before unmount

The `ChapterContent.vue` component SHALL dispatch the frontend hook stage `chapter:dom:dispose` exactly once during `onBeforeUnmount`, passing the same `HTMLElement` previously used as the `container` for `chapter:dom:ready` plus the current `chapterIndex`. This allows plugins that maintain container-keyed state (e.g. `Range` registrations) to release that state and avoid leaking detached DOM across long sessions.

#### Scenario: Unmount dispatches chapter:dom:dispose
- **WHEN** a mounted `ChapterContent` instance is unmounted (e.g., the user navigates to a different route, switches stories, or the parent re-keys the component)
- **THEN** `chapter:dom:dispose` SHALL be dispatched exactly once with the previously-mounted container element and the current `chapterIndex` BEFORE Vue tears the element out of the DOM

#### Scenario: Dispose is skipped when no container exists
- **WHEN** unmount fires before the template ref ever populated (e.g., the component was never fully mounted)
- **THEN** the dispose dispatch SHALL be skipped without throwing

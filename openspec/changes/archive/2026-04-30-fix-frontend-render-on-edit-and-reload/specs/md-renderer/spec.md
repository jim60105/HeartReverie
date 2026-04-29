## ADDED Requirements

### Requirement: Plugin-settled ordering for renderChapter

`useMarkdownRenderer.renderChapter()` SHALL be invoked only by callers that have already verified plugin initialization has settled (`usePlugins().pluginsSettled.value === true`). The composable itself SHALL NOT block, await, or otherwise gate on plugin readiness; correctness is enforced by the caller (e.g. `ChapterContent.vue` mounted under a `v-if="pluginsSettled && currentContent"` guard in `ContentArea.vue`). When called with an empty `frontend-render` handler list (e.g. because plugin loading failed, or no plugins are installed), `renderChapter()` SHALL behave exactly as it does today: placeholders are not extracted and prose passes through markdown + DOMPurify.

#### Scenario: renderChapter is invoked only after plugins have settled
- **WHEN** the production reader is mounted with the readiness gate in place
- **THEN** every call to `renderChapter()` originating from `ChapterContent.vue` SHALL occur after `pluginsSettled.value` has flipped to `true`

#### Scenario: renderChapter still works without plugins
- **WHEN** `renderChapter()` is called and zero `frontend-render` handlers are registered
- **THEN** the function SHALL execute the existing "no plugins registered" path (no XML extraction, content passed through to markdown + DOMPurify) and return a valid `RenderToken[]` array

### Requirement: Token re-evaluation on input mutation

The `tokens` computed inside `ChapterContent.vue` SHALL re-evaluate whenever any of its tracked dependencies changes by Vue's reactivity rules: the markdown source backing `props.rawMarkdown` (i.e. `currentContent` in `useChapterNav`), `props.isLastChapter`, `chapters[currentIndex].stateDiff`, `pluginsReady.value`, and `renderEpoch.value` from `useChapterNav()`.

`useChapterNav()` SHALL ensure that whenever a chapter content value is committed by any load path — including the case where the new value is `===` (string-equal) to the existing `currentContent.value` — at least one of the following invalidations occurs:

- `currentContent` (a `shallowRef`) is invalidated via `triggerRef`, OR
- `renderEpoch` is incremented.

In practice the implementation SHALL do both, so that any computed or watch that reads either `currentContent` or `renderEpoch` re-runs. The contract is "the rendered chapter view is invalidated such that, the next time `ChapterContent` evaluates `tokens`, `renderChapter()` runs and `chapter:render:after` is dispatched for that render". The contract is not "fires exactly once" — Vue MAY skip evaluations when no consumer is mounted, and the spec tolerates that.

`renderEpoch` SHALL be monotonically non-decreasing and SHALL NOT be exposed for direct mutation outside `useChapterNav()`.

#### Scenario: Same-content reload still invalidates the rendered view
- **WHEN** a chapter is reloaded (e.g. after edit-save) and the new content is byte-identical to the previous `currentContent.value`
- **THEN** `useChapterNav()` SHALL invalidate the rendered view such that, when `ChapterContent` next renders, `renderChapter()` runs and `chapter:render:after` is dispatched at least once

#### Scenario: Different-content reload invalidates the rendered view
- **WHEN** a chapter is reloaded and the new content differs from the previous `currentContent.value`
- **THEN** `currentContent` SHALL be reassigned, `renderEpoch` SHALL be incremented, and the `tokens` computed in `ChapterContent.vue` SHALL re-evaluate at the next render

#### Scenario: pluginsReady transition triggers re-evaluation
- **WHEN** a component instance evaluated `tokens` while `pluginsReady.value === false`, and `pluginsReady.value` subsequently flips to `true`
- **THEN** the `tokens` computed SHALL re-evaluate at least once after the transition

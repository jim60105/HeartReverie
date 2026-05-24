## Why

Two small visual issues in the reader's primary reading surface make the chapter column feel cramped against the sticky header and the sidebar's pin offset:

1. `.chapter-toolbar` (the per-chapter action bar inside `ChapterContent.vue`) sits flush against whatever element precedes it (the chapter list, the previous chapter's content, or the page header), with no top breathing room. The visual rhythm reads as "stacked", not "separated".
2. `<aside class="sidebar">` (rendered by `Sidebar.vue`, hosting all relocated `.plugin-sidebar` panels) uses `position: sticky; top: calc(var(--header-height) + 8px);`. With `--header-height: 34px`, the sidebar is pinned 42px below the viewport top, leaving a perceptible gap and putting the sidebar visually out of alignment with the chapter column that begins right below the header. We want the sidebar to scroll with content rather than be pinned at that offset.

These tweaks improve readability without changing any behavior — they are pure layout adjustments to two existing components.

## What Changes

- `reader-src/src/components/ChapterContent.vue`: add `margin-top: 1rem` to the `.chapter-toolbar` selector so each chapter's action bar gets one body-line of vertical breathing room above it.
- `reader-src/src/components/Sidebar.vue`: remove the `top: calc(var(--header-height) + 8px);` declaration from the `.sidebar` selector. Without an anchor offset on a `position: sticky` element, the sidebar effectively scrolls with the page (browsers treat a sticky element without any of `top`/`right`/`bottom`/`left` as non-pinning); `max-height: calc(100vh - var(--header-height) - 16px);` continues to cap the sidebar's height so long, plugin-stuffed sidebars still get an internal scrollbar.

No other declarations are touched, no JS is touched, no plugin contract changes, no API changes. There is no migration: the project is pre-release with zero users in the wild.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `page-layout`: add a new requirement codifying the reading area's vertical spacing contract — specifically the chapter-toolbar's top margin and the sidebar's no-pin sticky behavior. The existing "Content area and sidebar responsive layout" and "Sidebar transient hide during LLM streaming" requirements are unchanged.

## Impact

- **Affected files**
  - `reader-src/src/components/ChapterContent.vue` (single scoped-style edit)
  - `reader-src/src/components/Sidebar.vue` (single scoped-style edit)
  - `reader-src/src/styles/base.css` (delete the dead `#sidebar` block — see Dead-CSS cleanup below)
- **Affected components/specs**: `page-layout` spec gains one new requirement; `chapter-editing` spec is unchanged (it specifies the toolbar exists, not its margin).
- **Dead-CSS cleanup (in scope)**: `reader-src/src/styles/base.css` contains an entire block of `#sidebar { … top: calc(var(--header-height) + 8px); … }` / `#sidebar::-webkit-scrollbar` / `#sidebar:empty` / `.content-wrapper:has(#sidebar:empty)` / mobile `#sidebar { position: static; … }` rules (lines ~131–160). No element in the codebase carries `id="sidebar"`, so the rules are inert today. They are removed by this change because they encode the **same 42px sticky offset we are eliminating** — leaving them in place is a latent footgun: a future accidental `id="sidebar"` (e.g. on the `<aside>` for a11y) would silently restore the bug at higher specificity than the scoped `.sidebar` rule. The equivalent live behavior (`position: sticky`, `:empty` collapse, mobile `position: static`) is already owned by `Sidebar.vue`'s scoped styles and the surviving `Sidebar.vue` `@media (max-width: 767px)` block.
- **APIs/dependencies**: none.
- **Tests**: no existing tests assert these CSS values (`Sidebar.test.ts` / `ChapterContent.test.ts` cover structure and behavior only). Verification is via container build + visual smoke test in `agent-browser` against `localhost:8080`.

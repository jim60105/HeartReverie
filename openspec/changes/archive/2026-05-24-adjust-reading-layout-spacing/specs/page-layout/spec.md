## ADDED Requirements

### Requirement: Reading area vertical spacing rhythm

The reading area's two primary surfaces — the per-chapter action toolbar and the host sidebar — SHALL follow a consistent vertical spacing rhythm so the chapter column reads as discrete, separated units and the sidebar visually aligns with the chapter column it accompanies.

Specifically:

1. **Chapter toolbar top margin** — The `.chapter-toolbar` element rendered by `reader-src/src/components/ChapterContent.vue` SHALL declare `margin-top: 1rem` (in addition to its existing `margin-bottom: 1rem`). This SHALL apply uniformly to every toolbar instance, including the first chapter's toolbar (the rule SHALL NOT be scoped behind a `:not(:first-child)` or sibling combinator).

2. **Sidebar non-pinning sticky position** — The `.sidebar` element rendered by `reader-src/src/components/Sidebar.vue` SHALL retain `position: sticky` but SHALL NOT declare any of `top`, `right`, `bottom`, or `left` in its default (desktop) state. Per the CSS Positioned Layout specification, a `position: sticky` element with no anchor edge does not pin to the viewport during scroll, so the sidebar SHALL scroll with the chapter column. The `max-height: calc(100vh - var(--header-height) - 16px)` cap SHALL remain so tall plugin-stuffed sidebars still produce an internal scrollbar.

3. **Mobile breakpoint unaffected** — `reader-src/src/components/Sidebar.vue` SHALL retain its existing `<style scoped>` `@media (max-width: 767px)` override block, which sets `.sidebar { position: static; max-height: none; overflow-y: visible; }` and `.sidebar.sidebar--hidden-during-stream { display: none; }`. The non-pinning rule in (2) above applies only to the default desktop state where `position: sticky` is in effect.

4. **Dead legacy CSS removed** — `reader-src/src/styles/base.css` SHALL no longer contain the inert `#sidebar`, `#sidebar::-webkit-scrollbar`, `#sidebar:empty`, `.content-wrapper:has(#sidebar:empty)`, or `@media (max-width: 767px) { #sidebar { … } }` rule blocks. No element in the codebase carries `id="sidebar"`, and these blocks encode the same 42px sticky offset this requirement eliminates from the live `.sidebar` selector; leaving them would risk silently re-pinning the sidebar at higher specificity if an `id="sidebar"` were ever added to the `<aside>` for accessibility or anchor-link purposes. The surrounding `.content-wrapper` rule and the mobile `.content-wrapper { grid-template-columns: 1fr; }` declaration SHALL remain intact (they govern the live grid layout and are unrelated to the dead sidebar block).

5. **No behavioural side-effects** — The hide-during-stream class toggle (`.sidebar--hidden-during-stream`), the empty-collapse rule (`.sidebar:empty { display: none; }`), the scrollbar-hiding rules, the plugin relocation `watchPostEffect` in `ContentArea.vue`, and all template structure SHALL be preserved without modification by this requirement.

#### Scenario: Chapter toolbar has 1rem top margin on first chapter

- **WHEN** the reader renders the chapter list and the first `ChapterContent.vue` instance is mounted
- **THEN** its `.chapter-toolbar` element's computed `margin-top` SHALL be `1rem` (16px at the default root font-size)
- **AND** the rule SHALL apply equally regardless of whether the toolbar is the first child of its parent

#### Scenario: Chapter toolbar has 1rem top margin on subsequent chapters

- **WHEN** the reader renders chapter N where N > 1
- **THEN** chapter N's `.chapter-toolbar` element's computed `margin-top` SHALL be `1rem`
- **AND** standard CSS margin collapsing with the preceding sibling's `margin-bottom` MAY occur — this is the intended uniform rhythm and SHALL NOT be worked around

#### Scenario: Sidebar declares position sticky without top offset

- **WHEN** inspecting the `.sidebar` selector in `reader-src/src/components/Sidebar.vue`'s `<style scoped>` block
- **THEN** `position: sticky` SHALL be present
- **AND** `top`, `right`, `bottom`, and `left` SHALL all be absent from the selector's declaration block
- **AND** `max-height: calc(100vh - var(--header-height) - 16px)` SHALL still be present

#### Scenario: Sidebar scrolls with content on desktop

- **WHEN** a desktop user (viewport ≥ 768px) scrolls a long chapter
- **THEN** the `<aside class="sidebar">` element SHALL scroll out of view together with the chapter content rather than pinning at a fixed viewport offset
- **AND** the chapter column SHALL not shift horizontally as a result of any sidebar layout change

#### Scenario: Sidebar respects max-height cap

- **WHEN** the relocated `.plugin-sidebar` panels' total intrinsic height exceeds `calc(100vh - var(--header-height) - 16px)`
- **THEN** the `<aside class="sidebar">` element SHALL render an internal scrollbar (visually hidden via `scrollbar-width: none` and `::-webkit-scrollbar { display: none; }`, per the existing rules)
- **AND** the sidebar SHALL NOT extend beyond the cap

#### Scenario: Mobile layout unchanged

- **WHEN** a mobile user (viewport < 768px) loads the reader
- **THEN** the sidebar SHALL still render `position: static` with `max-height: none` and `overflow-y: visible` per the existing `<style scoped>` `@media (max-width: 767px)` block in `Sidebar.vue`
- **AND** the chapter toolbar's `margin-top: 1rem` SHALL still apply (mobile inherits the desktop spacing rule)

#### Scenario: Dead `#sidebar` rules removed from base.css

- **WHEN** inspecting `reader-src/src/styles/base.css`
- **THEN** no `#sidebar` selector SHALL appear in the file (no `#sidebar { … }`, `#sidebar::-webkit-scrollbar`, `#sidebar:empty`, `.content-wrapper:has(#sidebar:empty)`, or `@media … { #sidebar { … } }` rule blocks)
- **AND** the `.content-wrapper` rule and the mobile `@media (max-width: 767px) { .content-wrapper { grid-template-columns: 1fr; } }` declaration SHALL remain

#### Scenario: Hide-during-stream behaviour preserved

- **WHEN** an LLM streaming request is in flight and `useChatApi().isLoading === true` (per the existing "Sidebar transient hide during LLM streaming" requirement)
- **THEN** the `.sidebar--hidden-during-stream` class SHALL still be toggled on `<aside class="sidebar">` exactly as before
- **AND** the absence of the `top` declaration SHALL NOT affect the hide-then-restore behaviour

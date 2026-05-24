## MODIFIED Requirements

### Requirement: Reading area vertical spacing rhythm

The reading area's two primary surfaces — the per-chapter action toolbar and the host sidebar — SHALL follow a consistent vertical spacing rhythm so the chapter column reads as discrete, separated units and the sidebar visually aligns with the chapter column it accompanies.

Specifically:

1. **Chapter toolbar top margin** — The `.chapter-toolbar` element rendered by `reader-src/src/components/ChapterContent.vue` SHALL declare `margin-top: 1rem` (in addition to its existing `margin-bottom: 1rem`). This SHALL apply uniformly to every toolbar instance, including the first chapter's toolbar (the rule SHALL NOT be scoped behind a `:not(:first-child)` or sibling combinator).

2. **Sidebar non-pinning sticky position** — The `.sidebar` element rendered by `reader-src/src/components/Sidebar.vue` SHALL retain `position: sticky` but SHALL NOT declare any of `top`, `right`, `bottom`, or `left` in its default (desktop) state. Per the CSS Positioned Layout specification, a `position: sticky` element with no anchor edge does not pin to the viewport during scroll, so the sidebar SHALL scroll with the chapter column.

3. **Sidebar has no desktop viewport-height cap** — The `.sidebar` element rendered by `reader-src/src/components/Sidebar.vue` SHALL NOT declare `max-height: calc(100vh - var(--header-height) - 16px)` or any equivalent viewport-relative `max-height` cap in its default (desktop) state. Tall relocated `.plugin-sidebar` panels SHALL be allowed to increase the document height and scroll with the page. A plugin that needs a bounded internal scroll region SHALL define that bound within the plugin panel itself rather than relying on the host `<aside>`.

4. **Mobile breakpoint unaffected** — `reader-src/src/components/Sidebar.vue` SHALL retain its existing `<style scoped>` `@media (max-width: 767px)` override block, which sets `.sidebar { position: static; max-height: none; overflow-y: visible; }` and `.sidebar.sidebar--hidden-during-stream { display: none; }`. The non-pinning rule in (2) and the no-cap rule in (3) apply only to the default desktop state.

5. **Dead legacy CSS removed** — `reader-src/src/styles/base.css` SHALL no longer contain the inert `#sidebar`, `#sidebar::-webkit-scrollbar`, `#sidebar:empty`, `.content-wrapper:has(#sidebar:empty)`, or `@media (max-width: 767px) { #sidebar { … } }` rule blocks. No element in the codebase carries `id="sidebar"`, and these blocks encode the same 42px sticky offset previously eliminated from the live `.sidebar` selector; leaving them would risk silently re-pinning the sidebar at higher specificity if an `id="sidebar"` were ever added to the `<aside>` for accessibility or anchor-link purposes. The surrounding `.content-wrapper` rule and the mobile `.content-wrapper { grid-template-columns: 1fr; }` declaration SHALL remain intact (they govern the live grid layout and are unrelated to the dead sidebar block).

6. **No `overflow-y` or scrollbar declarations on desktop sidebar** — The `.sidebar` default (desktop) state in `reader-src/src/components/Sidebar.vue` SHALL NOT declare `overflow-y`, `scrollbar-width`, or a `::webkit-scrollbar` rule. Without a height cap, these declarations are dead code and, critically, `overflow-y: auto/scroll/hidden` establishes a new scroll container and Block Formatting Context that would silently prevent any descendant `position: sticky` element from sticking relative to the viewport. If a future layout restores a height constraint and needs scroll behavior, the `overflow-y` and scrollbar rules SHALL be added back at that time alongside the constraint.

7. **No behavioural side-effects** — The hide-during-stream class toggle (`.sidebar--hidden-during-stream`), the empty-collapse rule (`.sidebar:empty { display: none; }`), the plugin relocation `watchPostEffect` in `ContentArea.vue`, and all template structure SHALL be preserved without modification by this requirement.

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

#### Scenario: Sidebar has no desktop max-height cap

- **WHEN** inspecting the default `.sidebar` selector in `reader-src/src/components/Sidebar.vue`'s `<style scoped>` block
- **THEN** `max-height: calc(100vh - var(--header-height) - 16px)` SHALL be absent
- **AND** no other viewport-relative `max-height` declaration SHALL replace it in that default selector

#### Scenario: Sidebar scrolls with content on desktop

- **WHEN** a desktop user (viewport ≥ 768px) scrolls a long chapter with relocated sidebar panels
- **THEN** the `<aside class="sidebar">` element SHALL scroll with the chapter content rather than pinning at a fixed viewport offset
- **AND** tall sidebar content SHALL increase the page's scrollable document height instead of being clipped by a host-sidebar max-height cap
- **AND** the chapter column SHALL not shift horizontally as a result of any sidebar layout change

#### Scenario: Plugin-owned scroll regions remain possible

- **WHEN** a relocated `.plugin-sidebar` panel defines its own internal scroll container
- **THEN** that plugin-owned scroll container MAY scroll independently inside the panel
- **AND** the host `<aside class="sidebar">` SHALL NOT be the component imposing the removed viewport-relative height cap

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
- **AND** the absence of desktop `top`, `max-height`, and `overflow-y` declarations SHALL NOT affect the hide-then-restore behaviour

#### Scenario: Desktop sidebar has no overflow-y or scrollbar rules

- **WHEN** inspecting the default `.sidebar` selector in `reader-src/src/components/Sidebar.vue`'s `<style scoped>` block
- **THEN** `overflow-y` SHALL be absent from the declaration block
- **AND** `scrollbar-width` SHALL be absent from the declaration block
- **AND** no `::webkit-scrollbar` rule SHALL target `.sidebar` outside of a `@media (max-width: 767px)` block

## MODIFIED Requirements

### Requirement: Content area and sidebar responsive layout

The `ContentArea.vue` component SHALL render the chapter content and provide a sidebar region for plugin-relocated elements. The sidebar placement mechanism SHALL use a generic `.plugin-sidebar` CSS class convention: `ContentArea.vue` SHALL use a `watchPostEffect` to query all elements matching `.plugin-sidebar` within the content wrapper and relocate them to the sidebar DOM node via `appendChild`. This imperative DOM relocation is appropriate because plugin-rendered HTML arrives as raw strings via `v-html` — Vue's `<Teleport>` directive cannot be used for plugin content since it is not a Vue component. On mobile viewports (below 768px), CSS media queries SHALL make the sidebar `position: static` with a single-column grid layout, causing it to flow below the chapter content. No plugin-specific class names (such as `.status-float`) SHALL be hardcoded in the main project's component code.

#### Scenario: Plugin elements relocated to sidebar on desktop
- **WHEN** plugin-rendered HTML contains an element with the `.plugin-sidebar` class and the viewport is 768px or wider
- **THEN** `ContentArea.vue`'s `watchPostEffect` SHALL relocate the element to the sidebar DOM node

#### Scenario: Sidebar flows below content on mobile
- **WHEN** plugin-rendered HTML contains an element with the `.plugin-sidebar` class and the viewport is below 768px
- **THEN** the element SHALL still be relocated to the sidebar DOM node, but CSS media queries SHALL make the sidebar `position: static` with a single-column grid layout so it flows below the chapter content

#### Scenario: Generic class name used for relocation
- **WHEN** inspecting `ContentArea.vue` source for sidebar relocation logic
- **THEN** the querySelector SHALL use `.plugin-sidebar` — no plugin-specific class names SHALL be hardcoded

#### Scenario: Multiple plugins use sidebar placement
- **WHEN** two different plugins produce HTML elements with the `.plugin-sidebar` class
- **THEN** `ContentArea.vue` SHALL relocate both elements to the sidebar in document order

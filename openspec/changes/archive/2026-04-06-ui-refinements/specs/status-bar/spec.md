## MODIFIED Requirements

### Requirement: Styled status panel rendering
The parsed status data SHALL be rendered as a styled HTML panel with the CSS class `status-float`. On desktop viewports (min-width 768px), JavaScript SHALL move the panel from `#content` to the `#sidebar` element, placing it in a separate right column alongside the story content. The sidebar SHALL use `position: sticky` to keep the panel visible while scrolling. On mobile viewports (below 768px), the panel SHALL remain inline within the content flow. The panel SHALL display the character name and title prominently. The scene description and inner thought SHALL be visible. The inventory SHALL be listed.

#### Scenario: Status panel displays character identity
- **WHEN** the status block is parsed successfully
- **THEN** the rendered panel SHALL show the character name as a heading or prominent label and the title directly associated with the name

#### Scenario: Status panel in sidebar on desktop
- **WHEN** the status block is parsed and the viewport width is 768px or greater
- **THEN** the rendered panel SHALL be moved to the `#sidebar` element, displayed in a separate column to the right of the story content

#### Scenario: Status panel is inline on mobile
- **WHEN** the status block is parsed and the viewport width is below 768px
- **THEN** the rendered panel SHALL appear inline within the content flow

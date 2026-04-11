# Page Layout (Delta)

## MODIFIED Requirements

### Requirement: Body background colour preserved
The `body` element's `background-color` SHALL remain `#0f0a0c` (original love theme) as a fallback. When a background image is configured (via the `frontend-background` capability), the background colour SHALL serve as the fallback beneath the image and overlay layers. The colour merge only affects text and tint variables, not the page background base colour.

#### Scenario: Body background unchanged
- **WHEN** the page is rendered
- **THEN** the body background-color SHALL be `#0f0a0c`

#### Scenario: Background colour visible as fallback under image
- **WHEN** the page is rendered with a configured background image that fails to load
- **THEN** the `#0f0a0c` background colour SHALL remain visible as the fallback

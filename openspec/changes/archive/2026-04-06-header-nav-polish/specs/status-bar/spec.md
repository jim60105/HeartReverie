## MODIFIED Requirements

### Requirement: Collapsible sections for outfit and close-up
The 服飾 (outfit) and 特寫 (close-up) sections SHALL be rendered as collapsible sections (e.g., using `<details>/<summary>` elements) so that users can expand or collapse them. The `<details>` elements SHALL include the `open` attribute by default so that sections are expanded on initial render. Users can still collapse them manually.

#### Scenario: Outfit section is collapsible and expanded by default
- **WHEN** the status panel is rendered with a 服飾 section
- **THEN** the outfit details SHALL be inside a collapsible `<details>` element with a summary label indicating the section (e.g., `穿着`) and SHALL default to expanded (the `open` attribute SHALL be present)

#### Scenario: Close-up section is collapsible and expanded by default
- **WHEN** the status panel is rendered with a 特寫 section
- **THEN** the close-up details SHALL be inside a collapsible `<details>` element with a summary label indicating the section (e.g., `特寫`) and SHALL default to expanded (the `open` attribute SHALL be present)

#### Scenario: User can manually collapse expanded sections
- **WHEN** a `<details>` section is rendered with the `open` attribute
- **THEN** the user SHALL be able to click the `<summary>` element to collapse the section, and click again to re-expand it

## ADDED Requirements

### Requirement: Status block detection and extraction
The renderer SHALL detect `<status>...</status>` blocks in the chapter content using a regex or parser. The entire block from opening to closing tag SHALL be extracted for structured parsing.

#### Scenario: Status block is present in chapter
- **WHEN** the chapter content contains a `<status>...</status>` block
- **THEN** the block SHALL be extracted and passed to the status bar renderer for structured parsing

#### Scenario: No status block in chapter
- **WHEN** the chapter content does not contain a `<status>` block
- **THEN** no status bar SHALL be rendered and the chapter SHALL display without a status panel

### Requirement: Parsing the 基礎 (basic) section
The status bar parser SHALL extract the `基礎:` section which contains a single pipe-delimited line in brackets: `[Name|Title|Description|Thought|Inventory]`. The parser SHALL extract the character name (first field), title (second field), scene description (third field), inner thought (fourth field), and inventory list (fifth field).

#### Scenario: Full 基礎 section is parsed
- **WHEN** the status block contains `基礎:\n[蘭堂悠奈|放學後在商店街閒逛的優等生|午後的陽光...|被人認出來...|書包、手機]`
- **THEN** the parser SHALL extract name as `蘭堂悠奈`, title as `放學後在商店街閒逛的優等生`, description as `午後的陽光...`, thought as `被人認出來...`, and inventory as `書包、手機`

### Requirement: Parsing the 服飾 (outfit) section
The status bar parser SHALL extract the `服飾:` section which contains a single pipe-delimited line in brackets: `[Clothing|Footwear|Legwear|Accessories]`. Each field represents a category of worn items.

#### Scenario: Full 服飾 section is parsed
- **WHEN** the status block contains `服飾:\n[深藍色西式制服(外套+襯衫+短裙)|黑色皮鞋|白色短襪|無]`
- **THEN** the parser SHALL extract clothing as `深藍色西式制服(外套+襯衫+短裙)`, footwear as `黑色皮鞋`, legwear as `白色短襪`, and accessories as `無`

### Requirement: Parsing the 特寫 (close-up) section
The status bar parser SHALL extract the `特寫:` section which contains one or more lines, each in brackets with pipe-delimited fields: `[BodyPart|Description]`. Each line represents a close-up detail of a body part.

#### Scenario: Multiple close-up entries are parsed
- **WHEN** the status block contains multiple close-up lines `[雙手|手指修長白皙...]` and `[頸部|制服領口扣到最上一顆...]`
- **THEN** the parser SHALL extract each entry as a body-part/description pair and present them in order

### Requirement: Styled status panel rendering
The parsed status data SHALL be rendered as a styled HTML panel. The panel SHALL display the character name and title prominently. The scene description and inner thought SHALL be visible. The inventory SHALL be listed.

#### Scenario: Status panel displays character identity
- **WHEN** the status block is parsed successfully
- **THEN** the rendered panel SHALL show the character name as a heading or prominent label and the title directly associated with the name

### Requirement: Collapsible sections for outfit and close-up
The 服飾 (outfit) and 特寫 (close-up) sections SHALL be rendered as collapsible sections (e.g., using `<details>/<summary>` elements) so that users can expand or collapse them. They SHOULD default to collapsed to keep the interface compact.

#### Scenario: Outfit section is collapsible
- **WHEN** the status panel is rendered with a 服飾 section
- **THEN** the outfit details SHALL be inside a collapsible element with a summary label indicating the section (e.g., `穿着`) and SHALL default to collapsed

#### Scenario: Close-up section is collapsible
- **WHEN** the status panel is rendered with a 特寫 section
- **THEN** the close-up details SHALL be inside a collapsible element with a summary label indicating the section (e.g., `特寫`) and SHALL default to collapsed

### Requirement: Handling partial or missing sections
The status bar renderer SHALL gracefully handle status blocks where one or more sections (基礎, 服飾, 特寫) are missing. Only the present sections SHALL be rendered.

#### Scenario: Status block with only 基礎 section
- **WHEN** the status block contains only a `基礎:` section and no `服飾:` or `特寫:` sections
- **THEN** the panel SHALL render the basic character info and omit the outfit and close-up collapsible sections without errors

#### Scenario: Status block with empty fields
- **WHEN** a pipe-delimited field within a section is empty (e.g., `[Name||Description||]`)
- **THEN** the renderer SHALL display the present fields and leave empty fields blank or omit them gracefully

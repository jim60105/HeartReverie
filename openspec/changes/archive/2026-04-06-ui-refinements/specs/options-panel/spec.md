## MODIFIED Requirements

### Requirement: Options block detection and extraction
The renderer SHALL detect `<options>...</options>` blocks in the chapter content. The entire block from opening to closing tag SHALL be extracted for structured parsing. Options blocks SHALL only be rendered on the last chapter: when the current chapter is the last chapter in the story, the extracted block SHALL be passed to the options panel renderer as normal; when the current chapter is not the last chapter, the block SHALL be extracted but replaced with an empty placeholder (no visible output), preventing options from cluttering intermediate chapters.

#### Scenario: Options block is present in last chapter
- **WHEN** the chapter content contains an `<options>...</options>` block and the current chapter is the last chapter in the story
- **THEN** the block SHALL be extracted and passed to the options panel renderer for full display

#### Scenario: Options block is present in non-last chapter
- **WHEN** the chapter content contains an `<options>...</options>` block and the current chapter is not the last chapter in the story
- **THEN** the block SHALL be extracted from the content but replaced with an empty placeholder, producing no visible output

#### Scenario: No options block in chapter
- **WHEN** the chapter content does not contain an `<options>` block
- **THEN** no options panel SHALL be rendered for that chapter

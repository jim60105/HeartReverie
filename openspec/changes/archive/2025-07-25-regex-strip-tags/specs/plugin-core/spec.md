## MODIFIED Requirements

### Requirement: Strip tag pattern support
The system SHALL support both plain tag names and regex pattern strings in the `stripTags` manifest field.

#### Scenario: Plain tag name (existing behavior)
- **WHEN** a `stripTags` entry is a plain string (no leading `/`)
- **THEN** the system generates a regex pattern `<tagName>[\s\S]*?</tagName>` as before

#### Scenario: Regex pattern string
- **WHEN** a `stripTags` entry starts with `/` (e.g., `"/<T-task\\b[^>]*>[\\s\\S]*?<\\/T-task>/g"`)
- **THEN** the system extracts the inner pattern (stripping leading `/` and trailing `/flags`) and uses it directly in the combined regex

#### Scenario: Invalid regex pattern
- **WHEN** a `stripTags` entry starts with `/` but contains an invalid regex
- **THEN** the system logs a warning and skips the entry without crashing

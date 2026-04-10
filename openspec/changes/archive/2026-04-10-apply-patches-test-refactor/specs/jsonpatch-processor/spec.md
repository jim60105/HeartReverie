## MODIFIED Requirements

### Requirement: Malformed JSON handling
The tool SHALL handle JSON arrays containing unescaped ASCII double quotes inside string values. It SHALL attempt standard JSON parsing first (fast path), then fall back to line-by-line manual extraction for malformed entries. This logic SHALL reside in the `parser` module after refactoring.

#### Scenario: Standard JSON
- **WHEN** a `<JSONPatch>` block contains well-formed JSON
- **THEN** the tool SHALL parse it using the standard JSON parser

#### Scenario: Unescaped quotes in values
- **WHEN** a string value contains unescaped double quotes (e.g., Chinese emphasis marks)
- **THEN** the tool SHALL extract op, path, and value fields manually and process the operation

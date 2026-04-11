## MODIFIED Requirements

### Requirement: Malformed JSON handling
The tool SHALL handle JSON arrays containing unescaped ASCII double quotes inside string values. It SHALL attempt standard JSON parsing first (fast path), then fall back to brace-aware block accumulation for malformed entries. The fallback parser SHALL handle both single-line and multiline (pretty-printed) malformed JSON objects by tracking brace depth with quote awareness. This logic SHALL reside in the `parser` module.

#### Scenario: Standard JSON
- **WHEN** a `<JSONPatch>` block contains well-formed JSON
- **THEN** the tool SHALL parse it using the standard JSON parser

#### Scenario: Unescaped quotes in values
- **WHEN** a string value contains unescaped double quotes (e.g., Chinese emphasis marks)
- **THEN** the tool SHALL extract op, path, and value fields manually and process the operation

#### Scenario: Multiline malformed JSON object
- **WHEN** a malformed JSON object is pretty-printed across multiple lines within a `<JSONPatch>` block
- **THEN** the tool SHALL accumulate lines using brace-depth tracking and extract the operation correctly

#### Scenario: Mixed single-line and multiline malformed entries
- **WHEN** a `<JSONPatch>` block contains both single-line and multiline malformed objects
- **THEN** the tool SHALL parse all entries correctly regardless of formatting

### Requirement: Insert operation
The `insert` operation SHALL add a new key-value pair to an object, or append a value to an array when the path ends with `-`. If the key already exists, the value SHALL be replaced (upsert semantics). Missing intermediate mappings SHALL be auto-created. When the path ends with `/-` and the parent is not a sequence, the tool SHALL create a new sequence containing the value.

#### Scenario: Insert into object
- **WHEN** `{ "op": "insert", "path": "/inventory/sword", "value": "iron sword" }` is applied to `{ inventory: {} }`
- **THEN** the result SHALL be `{ inventory: { sword: "iron sword" } }`

#### Scenario: Append to array
- **WHEN** `{ "op": "insert", "path": "/items/-", "value": "potion" }` is applied to `{ items: ["shield"] }`
- **THEN** the result SHALL be `{ items: ["shield", "potion"] }`

#### Scenario: Insert existing key (upsert)
- **WHEN** `{ "op": "insert", "path": "/inventory/sword", "value": "steel sword" }` is applied to `{ inventory: { sword: "iron sword" } }`
- **THEN** the result SHALL be `{ inventory: { sword: "steel sword" } }`

#### Scenario: Append with dash on non-sequence parent
- **WHEN** `{ "op": "insert", "path": "/items/-", "value": "potion" }` is applied to `{ items: "old_scalar" }`
- **THEN** the result SHALL be `{ items: ["potion"] }` — the scalar is replaced with a new sequence

## ADDED Requirements

### Requirement: RFC 6901 path parsing
The tool SHALL parse JSON Pointer paths according to RFC 6901: splitting on `/` after the leading slash, preserving empty segments, and unescaping `~1` → `/` then `~0` → `~` (in that order per RFC 6901 §4).

#### Scenario: Simple path
- **WHEN** the path is `/a/b/c`
- **THEN** segments SHALL be `["a", "b", "c"]`

#### Scenario: Escaped tilde
- **WHEN** the path is `/a~0b`
- **THEN** segments SHALL be `["a~b"]`

#### Scenario: Escaped slash
- **WHEN** the path is `/a~1b`
- **THEN** segments SHALL be `["a/b"]`

#### Scenario: Empty segment
- **WHEN** the path is `/a//b`
- **THEN** segments SHALL be `["a", "", "b"]`

#### Scenario: Double escape
- **WHEN** the path is `/~01`
- **THEN** segments SHALL be `["~1"]` (unescape `~0` → `~` after `~1` → `/`)

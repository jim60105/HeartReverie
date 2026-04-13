## ADDED Requirements

### Requirement: Directory discovery
The script SHALL scan all immediate child directories of `playground/` and process only those containing a file named `init-status.yml`.

#### Scenario: Directory with init-status.yml
- **WHEN** `playground/foo/init-status.yml` exists
- **THEN** the script SHALL process `playground/foo/` and its sub-directories

#### Scenario: Directory without init-status.yml
- **WHEN** `playground/bar/` does not contain `init-status.yml`
- **THEN** the script SHALL skip `playground/bar/` entirely

### Requirement: State initialization
The script SHALL load `init-status.yml` as a YAML value tree. For each sub-directory, the script SHALL clone the initial state before applying any patches, ensuring sub-directories do not affect each other.

#### Scenario: Independent sub-directory processing
- **WHEN** sub-directory A modifies path `/char/hp` to 50 and sub-directory B does not
- **THEN** sub-directory B's output SHALL retain the original `/char/hp` value from `init-status.yml`

### Requirement: Markdown file ordering
The script SHALL discover files matching the pattern `/^\d+\.md$/` in each sub-directory and process them in ascending numeric order.

#### Scenario: Numeric sort order
- **WHEN** a sub-directory contains `001.md`, `002.md`, and `010.md`
- **THEN** the script SHALL process them in the order 001 → 002 → 010

#### Scenario: Non-matching files ignored
- **WHEN** a sub-directory contains `readme.md` or `notes.txt`
- **THEN** these files SHALL be ignored

### Requirement: JSONPatch extraction
The script SHALL extract all JSON arrays between `<JSONPatch>` and `</JSONPatch>` tags in each markdown file. If a file contains multiple `<JSONPatch>` blocks, all SHALL be extracted and applied in document order.

#### Scenario: Single JSONPatch block
- **WHEN** a markdown file contains one `<JSONPatch>…</JSONPatch>` block
- **THEN** the script SHALL parse and apply that block's operations

#### Scenario: Multiple JSONPatch blocks
- **WHEN** a markdown file contains two `<JSONPatch>…</JSONPatch>` blocks
- **THEN** the script SHALL parse and apply both blocks in document order

#### Scenario: No JSONPatch block
- **WHEN** a markdown file contains no `<JSONPatch>` tags
- **THEN** the script SHALL skip the file without error

### Requirement: Replace operation
The `replace` operation SHALL set the value at the specified path to the given value. If the target key does not exist, it SHALL be created (upsert semantics). Missing intermediate mappings SHALL be auto-created.

#### Scenario: Replace existing value
- **WHEN** `{ "op": "replace", "path": "/a/b", "value": "new" }` is applied to `{ a: { b: "old" } }`
- **THEN** the result SHALL be `{ a: { b: "new" } }`

#### Scenario: Replace non-existent key (upsert)
- **WHEN** `{ "op": "replace", "path": "/a/c", "value": "new" }` is applied to `{ a: { b: "old" } }`
- **THEN** the result SHALL be `{ a: { b: "old", c: "new" } }`

### Requirement: Delta operation
The `delta` operation SHALL add the given numeric value to the existing value at the specified path. If the target does not exist or is not a number, it SHALL be treated as `0`. String delta values SHALL be parsed as floating-point numbers. Missing intermediate mappings SHALL be auto-created.

#### Scenario: Positive delta
- **WHEN** `{ "op": "delta", "path": "/hp", "value": 10 }` is applied to `{ hp: 90 }`
- **THEN** the result SHALL be `{ hp: 100 }`

#### Scenario: Negative delta
- **WHEN** `{ "op": "delta", "path": "/hp", "value": -20 }` is applied to `{ hp: 100 }`
- **THEN** the result SHALL be `{ hp: 80 }`

#### Scenario: Delta on missing path
- **WHEN** `{ "op": "delta", "path": "/mp", "value": 50 }` is applied to `{ hp: 100 }`
- **THEN** the result SHALL be `{ hp: 100, mp: 50 }`

### Requirement: Insert operation
The `insert` operation SHALL add a new key-value pair to an object, or append a value to an array when the path ends with `-`. If the key already exists, the value SHALL be replaced (upsert semantics). Missing intermediate mappings SHALL be auto-created.

#### Scenario: Insert into object
- **WHEN** `{ "op": "insert", "path": "/inventory/sword", "value": "iron sword" }` is applied to `{ inventory: {} }`
- **THEN** the result SHALL be `{ inventory: { sword: "iron sword" } }`

#### Scenario: Append to array
- **WHEN** `{ "op": "insert", "path": "/items/-", "value": "potion" }` is applied to `{ items: ["shield"] }`
- **THEN** the result SHALL be `{ items: ["shield", "potion"] }`

#### Scenario: Insert existing key (upsert)
- **WHEN** `{ "op": "insert", "path": "/inventory/sword", "value": "steel sword" }` is applied to `{ inventory: { sword: "iron sword" } }`
- **THEN** the result SHALL be `{ inventory: { sword: "steel sword" } }`

### Requirement: Remove operation
The `remove` operation SHALL delete the key from an object or the element at the given index from an array.

#### Scenario: Remove object key
- **WHEN** `{ "op": "remove", "path": "/inventory/sword" }` is applied to `{ inventory: { sword: "x", shield: "y" } }`
- **THEN** the result SHALL be `{ inventory: { shield: "y" } }`

#### Scenario: Remove array element by index
- **WHEN** `{ "op": "remove", "path": "/items/0" }` is applied to `{ items: ["a", "b", "c"] }`
- **THEN** the result SHALL be `{ items: ["b", "c"] }`

### Requirement: Output file
The script SHALL write the final patched state to `current-status.yml` in each sub-directory using YAML format.

#### Scenario: Output written
- **WHEN** all patches in sub-directory `playground/story/branch1/` are applied
- **THEN** `playground/story/branch1/current-status.yml` SHALL contain the final YAML state

### Requirement: Error handling
The script SHALL log errors (file name, operation, path) to stderr and continue processing remaining files and directories. A single bad patch SHALL NOT abort the entire script.

#### Scenario: Invalid path in patch
- **WHEN** a patch references a non-existent intermediate path
- **THEN** the script SHALL log an error to stderr and skip that operation

### Requirement: Malformed JSON handling
The script SHALL handle JSON arrays containing unescaped ASCII double quotes inside string values. It SHALL attempt standard JSON parsing first (fast path), then fall back to line-by-line manual extraction for malformed entries.

#### Scenario: Standard JSON
- **WHEN** a `<JSONPatch>` block contains well-formed JSON
- **THEN** the script SHALL parse it using the standard JSON parser

#### Scenario: Unescaped quotes in values
- **WHEN** a string value contains unescaped double quotes (e.g., Chinese emphasis marks)
- **THEN** the script SHALL extract op, path, and value fields manually and process the operation

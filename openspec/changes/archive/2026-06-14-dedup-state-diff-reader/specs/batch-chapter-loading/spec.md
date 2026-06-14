## ADDED Requirements

### Requirement: State-diff sidecar reads use a single shared helper

Reading and validating a chapter's `NNN-state-diff.yaml` sidecar SHALL be performed exclusively through a single shared helper `readStateDiff(dirPath, chapterNum, logger?)` in `writer/lib/story-chapter-io.ts`. The helper SHALL read the `NNN-state-diff.yaml` file for the given zero-padded chapter number, parse it as YAML, and return the parsed `StateDiffPayload` only when it has an `entries` array; it SHALL return `undefined` when the file is absent, unparseable, or malformed (missing or non-array `entries`). When a failure is anything other than `Deno.errors.NotFound`, the helper SHALL log it at warn level through the optional `logger` argument (when provided) with context including the operation and the chapter number; a `NotFound` failure SHALL be silent. No route handler SHALL retain an inline `readTextFile` + `parseYaml` + `entries`-validation block for the state-diff sidecar — every HTTP and WebSocket read path (the batch-list mode and single-chapter read in `chapters.ts`, and the poll loop in `ws-subscribe.ts`) SHALL call this helper. The WebSocket poll path SHALL pass a logger adapter so its historical read-error logging is preserved.

#### Scenario: Valid diff file is returned
- **WHEN** `readStateDiff(dir, n)` reads a `NNN-state-diff.yaml` whose parsed content has an `entries` array
- **THEN** the helper SHALL return the parsed `StateDiffPayload`

#### Scenario: Missing diff file returns undefined silently
- **WHEN** `readStateDiff(dir, n, logger)` is called and the `NNN-state-diff.yaml` file does not exist (`Deno.errors.NotFound`)
- **THEN** the helper SHALL return `undefined` and SHALL NOT call `logger.warn`

#### Scenario: Malformed YAML is logged and returns undefined
- **WHEN** `readStateDiff(dir, n, logger)` is called and the file contains malformed YAML (or the read fails with a non-NotFound error)
- **THEN** the helper SHALL return `undefined` and SHALL call `logger.warn` exactly once with the operation and chapter-number context

#### Scenario: Valid YAML without an entries array returns undefined
- **WHEN** `readStateDiff(dir, n)` reads valid YAML that has no `entries` array
- **THEN** the helper SHALL return `undefined`

#### Scenario: WebSocket poll path preserves read-error logging
- **WHEN** the `ws-subscribe.ts` poll loop reads a state-diff sidecar via `readStateDiff` and the read fails with a non-NotFound error
- **THEN** the failure SHALL still be logged on the WebSocket path via the logger adapter passed to the helper

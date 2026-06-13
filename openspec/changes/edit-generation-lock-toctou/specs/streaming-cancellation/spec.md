## ADDED Requirements

### Requirement: Generation lock also guards chapter-edit and rewind mutations

The per-story generation lock (the registry acquired by `runUnderGenerationLock` in `writer/lib/chat-shared.ts` and by `tryMarkGenerationActive` in the chapter-mutation routes) SHALL serve as a single mutual-exclusion domain that covers both LLM generations and chapter-file mutations (edit and rewind). A chapter edit or rewind SHALL NOT execute its filesystem mutation while a generation is streaming into the same story, and a generation SHALL NOT begin streaming into a story while a chapter edit or rewind holds the lock. The two paths SHALL use the same registry instance so neither can interleave with the other against the same `(series, story)` key. This guarantee SHALL hold even though the chat path acquires the lock late (after prompt building) and the edit/rewind paths acquire it just before their mutation — because both acquisitions go through the same atomic check-and-acquire primitive on the same registry.

#### Scenario: Edit and generation cannot interleave on the same story
- **WHEN** a chapter edit or rewind for `(series, story)` and an LLM generation for the same `(series, story)` are both attempted with overlapping timing
- **THEN** whichever acquires the lock first SHALL proceed and the other SHALL be rejected (HTTP 409 for the edit/rewind, or the generation's existing concurrent-generation refusal) until the holder releases the lock

#### Scenario: Single registry domain
- **WHEN** the chat path acquires the lock via `runUnderGenerationLock` and an edit handler attempts `tryMarkGenerationActive` for the same story
- **THEN** the edit handler's acquisition SHALL fail because both operate on the same registry keyed by `"<series>/<name>"`

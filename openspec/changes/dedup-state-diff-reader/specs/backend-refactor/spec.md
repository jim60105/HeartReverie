## ADDED Requirements

### Requirement: Chapter-file listing is centralized in the canonical helper

Listing a story's chapter files (filtering directory entries to `NNN.md` names via `/^\d+\.md$/` and sorting them in ascending numeric order) SHALL be performed through the canonical `listChapterFiles()` helper in `writer/lib/story-chapter-io.ts`. The route layer SHALL NOT retain inline re-implementations of this listing. `writer/routes/ws-subscribe.ts` SHALL use `listChapterFiles()`, wrapped so that any thrown (non-NotFound) directory-read error preserves its existing early-return-with-`logWsError("dir-read", err)` behavior, since `listChapterFiles()` returns `[]` on `NotFound` and throws otherwise. `writer/routes/export.ts` SHALL use `listChapterFiles()` if and only if its inline listing has identical semantics (the same `\d+\.md` filter, numeric sort, and tolerate-missing-directory behavior); if export's listing differs semantically it SHALL be left unchanged and the divergence documented.

#### Scenario: ws-subscribe uses the canonical lister with preserved error handling
- **WHEN** the `ws-subscribe.ts` poll loop lists chapter files
- **THEN** it SHALL call `listChapterFiles()`, and a thrown directory-read error SHALL still trigger `logWsError("dir-read", err)` followed by an early return — preserving the prior behavior

#### Scenario: No inline chapter-listing regex remains in the converted routes
- **WHEN** the route layer is inspected for inline `/^\d+\.md$/` chapter listings after this change
- **THEN** `ws-subscribe.ts` SHALL contain none (and `export.ts` SHALL contain none if its semantics matched and it was converted)

#### Scenario: export.ts listing is left intact when semantics differ
- **WHEN** `export.ts`'s inline listing does not have identical semantics to `listChapterFiles()` (e.g. it includes non-numeric files or sorts differently)
- **THEN** `export.ts` SHALL be left unchanged and the reason SHALL be documented rather than silently altering export output

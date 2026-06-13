## ADDED Requirements

### Requirement: Deleting the last chapter prunes its usage record

Whenever the highest-numbered chapter `N` is deleted from a story — via the HTTP `DELETE /api/stories/:series/:name/chapters/last` route or via the WebSocket `chat:resend` path — the backend SHALL prune the usage record for chapter `N` from `_usage.json` by calling `pruneUsage(dirPath, N - 1)`, which keeps every record whose `chapter` is less than or equal to `N - 1` and removes the rest. This pruning SHALL be performed by the shared `deleteLastChapter()` helper so both transports behave identically and the persisted token totals do not drift upward after a deletion. When `_usage.json` is absent, the prune SHALL be a no-op and SHALL NOT fail the deletion.

#### Scenario: Last-chapter delete removes only the deleted chapter's record
- **GIVEN** a story whose `_usage.json` contains one record for chapter 1 and one record for chapter 2, and the directory contains `001.md` and `002.md`
- **WHEN** the last chapter is deleted (via DELETE-last or `chat:resend`)
- **THEN** `_usage.json` SHALL retain only the chapter-1 record and SHALL NOT contain the chapter-2 record

#### Scenario: Prune is a no-op when no usage ledger exists
- **GIVEN** a story with chapters `001.md` and `002.md` but no `_usage.json`
- **WHEN** the last chapter is deleted
- **THEN** the deletion SHALL succeed and SHALL NOT create or fail on the missing `_usage.json`

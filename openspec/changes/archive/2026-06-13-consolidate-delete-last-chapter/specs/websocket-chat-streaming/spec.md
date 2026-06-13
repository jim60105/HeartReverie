## MODIFIED Requirements

### Requirement: Chat resend over WebSocket

An authenticated client SHALL send `{ type: "chat:resend", id: string, series: string, story: string, message: string }` to delete the last chapter and re-send a message. Before deleting, the server SHALL consult `isGenerationActive(series, story)` and, when a generation is active for the target story, SHALL emit `{ type: "chat:error", id, detail: "Generation in progress for this story" }` and SHALL NOT delete any chapter or proceed with the chat. When no generation is active, the server SHALL delete the last chapter file via the shared `deleteLastChapter()` helper (the same helper used by `DELETE /api/stories/:series/:name/chapters/last`), which removes the highest-numbered chapter file, best-effort removes its state/diff sidecar artifacts, and prunes the deleted chapter's usage record from `_usage.json`. The server SHALL NOT re-implement chapter listing, deletion, sidecar cleanup, or usage pruning inline. After a successful deletion the server SHALL process the chat message identically to `chat:send`. The same delta streaming and correlation rules SHALL apply.

If the shared helper reports no chapters to delete, the server SHALL emit `{ type: "chat:error", id, detail: "No chapters to delete" }` and SHALL NOT proceed with the chat. If the deletion throws a filesystem error, the server SHALL distinguish `Deno.errors.NotFound` (emitting `{ type: "chat:error", id, detail: "Story not found" }`) from other errors; for other errors the server SHALL log the failure server-side with context (`id`, `series`, `story`, and the error message) before emitting `{ type: "chat:error", id, detail: "Failed to delete last chapter" }`. The deletion catch block SHALL NOT swallow the error without logging.

#### Scenario: Resend deletes last chapter then streams
- **WHEN** the client sends `{ type: "chat:resend", id: "msg-2", series: "s1", story: "n1", message: "改去便利商店" }` and no generation is active for `s1/n1`
- **THEN** the server SHALL delete the last chapter file of story `n1` via the shared helper (pruning its usage record), then stream the new LLM response as `chat:delta` messages with `id: "msg-2"`, and finalize with `chat:done`

#### Scenario: Resend when no chapters exist
- **WHEN** the client sends `chat:resend` for a story with zero chapters
- **THEN** the server SHALL send `{ type: "chat:error", id, detail: "No chapters to delete" }` and SHALL NOT proceed with the chat

#### Scenario: Resend rejected during active generation
- **WHEN** the client sends `chat:resend` for a story that currently has an active generation (registry refcount greater than zero)
- **THEN** the server SHALL send `{ type: "chat:error", id, detail: "Generation in progress for this story" }`, SHALL NOT delete any chapter, and SHALL NOT proceed with the chat

#### Scenario: Resend deletion failure is logged, not swallowed
- **WHEN** the shared deletion helper throws a filesystem error other than `Deno.errors.NotFound` during a `chat:resend`
- **THEN** the server SHALL log the failure server-side with context (the request `id`, `series`, `story`, and the error message) before emitting `{ type: "chat:error", id, detail: "Failed to delete last chapter" }`

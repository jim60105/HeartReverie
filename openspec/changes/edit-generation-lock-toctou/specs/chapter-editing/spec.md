## MODIFIED Requirements

### Requirement: Protect chapter mutations from racing an active generation

The server SHALL maintain a per-story active-generation registry as an in-memory `Map<string, number>` keyed by `"<series>/<name>"` whose value is the number of generations currently streaming into that story (a refcount). `writer/lib/chat-shared.ts` SHALL increment the refcount for the key before opening the LLM SSE stream and SHALL decrement it in a `finally` block that covers stream completion, errors, and aborts triggered by `chat:abort`; when the refcount would drop to zero the entry SHALL be removed from the map. A plain `Set<string>` is insufficient because two overlapping generations against the same story would let the first generation's `finally` delete the key while the second is still writing; the refcount ensures the registry accurately reflects whether *any* generation is still streaming.

When the TOCTOU race is demonstrated — that is, when a concurrent generation acquires the lock between the edit route's early check and its write, and the edit is shown (by a reproducing test) to proceed under that active lock — the chapter edit (`PUT .../chapters/:number`) and rewind (`DELETE .../chapters/after/:number`) handlers SHALL guard against the racing generation **atomically with their mutation**, not merely with an early read-only check. This atomic-locking guarantee is **contingent on that reproduction**: if the race cannot be demonstrated, this change is abandoned (not archived) and the early-check behavior remains unchanged — the atomic requirement SHALL NOT be adopted speculatively. Under the demonstrated race, each handler MAY perform an early `isGenerationActive(series, name)` read as a cheap fast-fail before parsing the request body, but this early check is an optimization and SHALL NOT be the sole guard. After request/body validation and immediately before the file mutation, the handler SHALL acquire the lock with `tryMarkGenerationActive(series, name)`; when acquisition fails (the story already has an active generation or another in-flight mutation), the handler SHALL return HTTP 409 with an RFC 9457 Problem Details body and SHALL NOT modify any file. When acquisition succeeds, the handler SHALL perform the mutation (for PUT: `Deno.stat` + `atomicWriteChapter` + state-file cleanup; for rewind: the descending deletions + `pruneUsage`) inside a `try` block whose `finally` calls `clearGenerationActive(series, name)`, guaranteeing the lock is released on every exit path including early returns and thrown errors. The lock used by these handlers SHALL be the same registry the chat path acquires via `runUnderGenerationLock`, so an edit cannot proceed while a generation streams into the same story and vice versa. This closes the check-then-write window in which a `chat:send` could acquire the lock between an edit handler's early check and its write and silently lose either the edit or the streamed content. Because the lock is held across the mutation, two concurrent edits (or an edit concurrent with a rewind) against the same story SHALL serialize: the second SHALL receive HTTP 409 while the first holds the lock.

The branch handler SHALL NOT consult the registry — branching is a read-only operation on the source and captures whatever the source file contains at copy time.

#### Scenario: Atomic guarantee applies when a generation acquires the lock between the edit's check and its write
- **WHEN** a reproducing (red) test demonstrates that a concurrent generation acquires the lock for `alpha/tale` between the edit route's early `isGenerationActive` check and its write, and the edit would otherwise proceed under that active lock
- **THEN** the atomic acquire-with-`finally` requirement SHALL apply: the edit handler SHALL acquire the lock via `tryMarkGenerationActive` immediately before its mutation, return HTTP 409 without writing when acquisition fails, and release the lock in a `finally`

#### Scenario: Race not reproducible — no behavior change required
- **WHEN** neither the Hono test harness nor direct sequencing can demonstrate an interleaving where the edit write proceeds under an active generation lock
- **THEN** this change SHALL be marked **not reproducible**, abandoned/closed, and NOT archived, the atomic-locking requirement SHALL NOT be adopted, and the existing early-check behavior SHALL remain unchanged

#### Scenario: Registry entry is cleared after normal stream completion
- **WHEN** `executeChat()` finishes streaming a chapter for `alpha/tale` and it was the only active generation for that story
- **THEN** the refcount for `"alpha/tale"` SHALL drop to zero, the entry SHALL be removed from the map, and a subsequent `PUT .../chapters/:number` SHALL proceed

#### Scenario: Registry entry is cleared after chat:abort
- **WHEN** a client sends a WebSocket `chat:abort` during the only active generation for `alpha/tale`
- **THEN** the refcount for `"alpha/tale"` SHALL drop to zero and the entry SHALL be removed from the map after the abort handler runs, even though generation did not complete normally

#### Scenario: Overlapping generations keep the story locked until the last one finishes
- **WHEN** two generations for `alpha/tale` overlap in time and the first one completes (or is aborted) while the second is still streaming
- **THEN** the refcount SHALL drop from `2` to `1` but the entry SHALL remain in the map, and a `PUT .../chapters/:number` or `DELETE .../chapters/after/:number` sent in that window SHALL still be rejected with HTTP 409

#### Scenario: Concurrent edit is rejected during generation
- **WHEN** the registry has a refcount ≥ 1 for `"alpha/tale"` and a client sends `PUT /api/stories/alpha/tale/chapters/1`
- **THEN** the server SHALL respond HTTP 409 with `type`, `title`, `status: 409`, and a `detail` field referencing the active generation

#### Scenario: Generation acquired after the early check still blocks the write
- **WHEN** a `PUT /api/stories/alpha/tale/chapters/1` passes its early `isGenerationActive` check and then parks on body parsing, and a generation acquires the lock for `alpha/tale` before the PUT reaches its write
- **THEN** the PUT's `tryMarkGenerationActive` acquisition SHALL fail and the server SHALL return HTTP 409 without writing the chapter file

#### Scenario: Concurrent edits to the same story serialize
- **WHEN** two `PUT /api/stories/alpha/tale/chapters/:number` requests for the same story overlap in time
- **THEN** while the first holds the lock the second SHALL receive HTTP 409, and after the first releases the lock in its `finally` a subsequent edit SHALL proceed

#### Scenario: Lock is released on the mutation's error path
- **WHEN** a `PUT` or rewind handler acquires the lock and the mutation throws (e.g. `Deno.stat` fails or a write error occurs)
- **THEN** the handler's `finally` SHALL call `clearGenerationActive(series, name)` so the story is not left permanently locked

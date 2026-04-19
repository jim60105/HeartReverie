## Why

The `response-stream` hook stage is declared as a valid `HookStage` in `writer/types.ts` and documented as a lifecycle stage in the `plugin-hooks` spec, but `executeChat()` in `writer/lib/chat-shared.ts` never calls `hookDispatcher.dispatch("response-stream", ...)`. This makes the stage dead code — plugins that register handlers for it are silently ignored. Activating this hook unlocks a class of plugins that operate on live streaming output: chunk transformation, live redaction/censorship, word replacement, streaming metrics collection (token counters, first-token latency), and real-time content moderation — all without requiring the client to reload or re-render after generation completes.

## What Changes

- Dispatch `response-stream` from `executeChat()` for each non-empty content delta parsed from the LLM SSE stream (both in the main loop and for the trailing buffer flush), before the delta is written to disk, accumulated into `aiContent`, or emitted to `onDelta()`.
- Define a structured `ResponseStreamPayload` context type for the hook in `writer/types.ts` so plugin authors and TypeScript consumers see a typed contract (chunk, mutable output, metadata, correlationId).
- Use a mutable `chunk` field on the context as the chunk-transformation channel: handlers may overwrite it to transform the chunk, or set it to an empty string to drop the chunk from the written file and client stream.
- Preserve existing streaming behavior when no handler is registered: dispatch with zero handlers SHALL be a no-op that returns the chunk unchanged, and the `aiContent` accumulator, file write, and `onDelta` callback SHALL see the original chunk byte-for-byte.
- Document the new dispatch point and payload shape in the `plugin-hooks` spec (which already names the stage but lacks dispatch-point and payload detail).

## Capabilities

### New Capabilities

_(none — this change activates an already-declared hook stage rather than introducing a new capability)_

### Modified Capabilities

- `plugin-hooks`: tighten the `response-stream` stage specification — add an explicit dispatch-point requirement inside `executeChat()`, define the payload contract (fields and mutability semantics), and specify the chunk-transformation / chunk-drop behavior. Requirements added, none removed.

## Impact

- **Code**: `writer/lib/chat-shared.ts` (add dispatch calls in the SSE loop and trailing buffer), `writer/types.ts` (add `ResponseStreamPayload` interface).
- **Specs**: `openspec/specs/plugin-hooks/spec.md` — expand the `response-stream` scenarios.
- **Tests**: `tests/writer/lib/` — add `chat-shared` hook-dispatch tests that verify (a) dispatch occurs per chunk, (b) handler mutations to `chunk` propagate to file + `onDelta`, (c) empty string drops the chunk, (d) no-handler case is unchanged.
- **Plugins**: No existing plugin registers for `response-stream`, so no plugin migrations are required. The hook becomes available for future plugins.
- **APIs**: No HTTP/WebSocket API changes. No environment variable changes. No breaking changes for end users.
- **Performance**: One additional `await hookDispatcher.dispatch(...)` per SSE chunk. When no handler is registered this is a synchronous Map lookup + early return, with negligible overhead.

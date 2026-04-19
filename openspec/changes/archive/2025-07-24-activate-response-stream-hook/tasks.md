## 1. Type definitions

- [x] 1.1 Add `ResponseStreamPayload` interface to `writer/types.ts` with fields: `correlationId: string`, `chunk: string` (mutable), `series: string`, `name: string`, `storyDir: string`, `chapterPath: string`, `chapterNumber: number`, and optional `logger?: unknown` (injected by `HookDispatcher`). Include a JSDoc block explaining that `chunk` is mutable and setting it to `""` drops the chunk. Export the interface. Acceptance: `deno task typecheck` (or project equivalent) passes; the interface is importable from `writer/types.ts` in a throwaway test import.

## 2. Dispatch activation in `executeChat()`

- [x] 2.1 In `writer/lib/chat-shared.ts`, locate the main SSE parse loop block that currently reads `const delta = parsed.choices?.[0]?.delta?.content; if (delta) { aiContent += delta; await file.write(encoder.encode(delta)); onDelta?.(delta); }`. Replace the body of the `if (delta)` block so that it (a) awaits `hookDispatcher.dispatch("response-stream", { correlationId, chunk: delta, series, name, storyDir, chapterPath, chapterNumber: targetNum })`, (b) coerces the returned `ctx.chunk` to empty string if it is not a string, (c) only performs the file write, `aiContent` append, and `onDelta` call when the resulting string length is > 0. Acceptance: diff shows `hookDispatcher.dispatch("response-stream", ...)` called inside the main loop, with persistence actions guarded by the post-dispatch `chunk` value.
- [x] 2.2 Apply the identical transformation to the trailing-buffer flush block (the `if (buffer.trim())` branch outside the main while loop). Acceptance: both delta-handling code paths invoke the same dispatch helper logic; no duplicate divergent behavior.
- [x] 2.3 Extract the post-dispatch coercion + persistence into a small inlined helper or clearly factored block so the logic is not duplicated verbatim (e.g., a local arrow function `persistChunk(delta)` inside `executeChat`). Acceptance: `executeChat` contains one definition of the persist-after-dispatch logic; both call sites use it.
- [x] 2.4 Verify the dispatch call does NOT propagate an `AbortSignal` into handlers (handlers are not expected to observe abort; existing `pre-write` / `post-response` do not either). Acceptance: no new `signal` field on the context.

## 3. Backend tests — `writer/lib/chat-shared`

- [x] 3.1 Add a test file `tests/writer/lib/chat_shared_response_stream_test.ts` (or extend the existing chat-shared test file if one exists). Use a stubbed `fetch` that returns a controllable SSE `ReadableStream`, a real `HookDispatcher`, and a temp `PLAYGROUND_DIR`. Acceptance: test file runs under `deno task test:backend`.
- [x] 3.2 Test: dispatch occurs per delta — register a spy handler, stream 3 deltas, assert handler called 3 times with `context.chunk` equal to each original delta in order.
- [x] 3.3 Test: no-handler baseline unchanged — with zero `response-stream` handlers, assert the final chapter file bytes, the `aiContent` returned in `ChatResult.content`, and the collected `onDelta` sequence are byte-for-byte identical to pre-activation expectations (use golden string).
- [x] 3.4 Test: handler transforms chunk — register a handler that sets `context.chunk = context.chunk.toUpperCase()`; assert file contents, `ChatResult.content`, and `onDelta` sequence are all uppercased.
- [x] 3.5 Test: handler drops chunk — register a handler that sets `context.chunk = ""` for exactly one of three deltas; assert that delta appears nowhere in file / content / `onDelta` calls, and the other two deltas are unaffected.
- [x] 3.6 Test: multiple handlers compose by priority — register priority 10 (`toUpperCase`) and priority 20 (wrap with `<>`); stream `"hello"`; assert final persisted string is `"<HELLO>"`.
- [x] 3.7 Test: non-string mutation coerces to empty — register a handler that sets `context.chunk = 42`; assert no `TypeError` propagates, `onDelta` NOT invoked for that chunk, nothing written for that chunk.
- [x] 3.8 Test: handler exception is isolated — register a handler that throws, plus a later-priority handler that transforms; assert streaming completes, the thrower's failure is absorbed (no rejection from `executeChat`), and the chapter file reflects whatever value `context.chunk` had when the thrower returned (i.e., either the pre-mutation value or a partial mutation).
- [x] 3.9 Test: trailing-buffer dispatch — craft an SSE stream where the last `data: {...}` line has no trailing `\n` (so it lands in the residual buffer); assert the `response-stream` handler is invoked for that final delta.
- [x] 3.10 Test: other-field mutations ignored — register a handler that sets `context.chapterPath = "/elsewhere"` and `context.chapterNumber = 999`; assert the real `chapterPath` is still written to, and `ChatResult.chapter` equals the originally-computed number.

## 4. Spec sync

- [x] 4.1 After implementation and tests pass, sync `openspec/changes/activate-response-stream-hook/specs/plugin-hooks/spec.md` into `openspec/specs/plugin-hooks/spec.md` (via the OpenSpec sync workflow / archive step — do NOT edit the main spec directly during implementation). Acceptance: `openspec status --change activate-response-stream-hook` reports the change as ready-to-archive.
- [x] 4.2 Update `docs/plugin-system.md` so any passage that labels `response-stream` as undispatched is corrected to describe it as active, and the payload (`chunk` mutable, `correlationId`, `series`, `name`, `storyDir`, `chapterPath`, `chapterNumber`) is documented with a minimal code example. Acceptance: `grep -n "response-stream" docs/plugin-system.md` shows updated wording; no remaining "not yet active" or equivalent phrasing for `response-stream`.

## 5. Validation

- [x] 5.1 Run `deno task test:backend` — all tests pass.
- [x] 5.2 Run `deno task test` — full suite (backend + frontend) passes.
- [x] 5.3 Manual smoke: start server (`./serve.sh`), send a chat via the web reader, confirm chapter streams and persists as before (i.e., no regression for the no-handler case).
- [x] 5.4 Manual plugin smoke (optional but recommended): create a disposable plugin under `plugins/` (or `PLUGIN_DIR`) that registers a `response-stream` handler printing each chunk to the plugin logger; verify logs show one entry per chunk during a live chat.
- [x] 5.5 Run `openspec validate activate-response-stream-hook` (or project-equivalent validate command) and confirm no errors.

## Context

OpenRouter's Chat Completions API exposes reasoning text on every SSE chunk via two non-standard fields on the assistant delta:

- `choices[0].delta.reasoning` — a plain string containing the next slice of human-readable reasoning text (the same "what the model is thinking" surface that other providers call `thoughts` or `reasoning_summary`).
- `choices[0].delta.reasoning_details` — an array of structured items (`{type, text?, signature?, format?, ...}`) used to round-trip provider-opaque reasoning state across turns. The user-supplied sample preserves this verbatim on subsequent calls so the model can continue from where it left off.

Today `executeChat()`'s SSE handler only inspects `delta.content`. The reasoning fields are silently dropped, even though we already opted into reasoning by sending `reasoning: { enabled: true, effort }` in the request body. The frontend `thinking` plugin already knows how to fold `<think>` and `<thinking>` blocks into collapsible `<details>` elements via its `frontend-render` hook — it has been waiting for actual reasoning content to arrive.

Chapter files currently look like:

```
<user_message>
{user message}
</user_message>

{model content}
```

This change inserts a `<think>` block between the closing `</user_message>` and the model content, fed by streaming reasoning deltas:

```
<user_message>
{user message}
</user_message>

<think>
{reasoning text}
</think>

{model content}
```

The `user-message` plugin's `pre-write` hook already places `<user_message>...</user_message>\n\n` as the chapter prefix. The reasoning block sits exactly where the model content used to start.

## Goals / Non-Goals

**Goals:**

- Stream OpenRouter `delta.reasoning` text into the chapter file as a `<think>...</think>` block, in real time, with the same dual-write (file + WebSocket `chat:delta`) semantics as content deltas.
- Make the feature transparent: models / providers / configurations that don't emit reasoning produce zero `<think>` markup in the chapter file (no empty blocks).
- Preserve existing post-response semantics: `aiContent` (the model's answer text returned in HTTP/WS completion envelopes and consumed by `post-response` hooks) does NOT include reasoning text. Reasoning lives on disk in the chapter file but is not part of the "model output" semantically.
- Interact correctly with cancellation and mid-stream-error paths set up in `2026-04-29-fix-streaming-cancellation`: an open `<think>` block must be closed before the chapter file is closed, regardless of whether the stream ended cleanly, was aborted by the client, or was terminated by a mid-stream provider error.
- Require ZERO new hooks. Stay within the existing 5-stage hook surface.

**Non-Goals:**

- Round-tripping the structured `reasoning_details` array across turns. HeartReverie rebuilds prompts from chapter Markdown each turn; the structured array carries provider-opaque tokens that cannot survive a Markdown round-trip without sidecar JSON storage. Cross-turn chain-of-thought continuity is therefore explicitly out of scope.
- Suppressing reasoning from the next-turn prompt context. Today the `thinking` plugin manifest lists `tags: ["thinking", "think"]` but does NOT declare `promptStripTags`; thus prior chapters' `<think>` blocks WILL be sent to the model on subsequent turns as part of `previousContext`. Whether to add `promptStripTags` is a separate token-budget decision (see Open Questions); this change keeps the default permissive.
- Adding a new `reasoning-stream` hook. The user explicitly preferred a no-new-hooks approach; we honour that by handling reasoning inside `executeChat()` directly, transparent to plugins.
- Modifying the upstream request shape. `reasoning: { enabled, effort }` already exists; reasoning surface comes back automatically when supported by the model.

## Decisions

### D1 — Where reasoning text gets written: writer codebase, not a plugin

**Decision**: Implement reasoning extraction and `<think>` framing inside `chat-shared.ts`. No plugin changes (other than verifying the existing `thinking` plugin manifest still makes sense).

**Rationale**:

- Wire-format parsing (reading `delta.reasoning` / `delta.reasoning_details` from SSE chunks) is unambiguously a writer responsibility — it's transport-layer concern.
- For a plugin to receive reasoning deltas, we'd need a new hook stage (`reasoning-stream` or similar) or a discriminator field on `response-stream`. Both add hooks; user said no.
- The `thinking` plugin's contribution is purely DISPLAY: its `frontend-render` hook folds existing `<think>` text into collapsibles. It has no reason to know about wire format. By framing reasoning into `<think>` tags inside the writer, we feed exactly what the plugin already knows how to render, with no contract change.
- Consequence: this is a small, surgical writer change rather than a hook-system extension.

**Alternative considered**: extend `response-stream` hook signature with a `kind: "content" | "reasoning"` field, dispatch for both. Rejected — bumps every existing `response-stream` consumer (e.g. context-compaction must opt-out of reasoning), expands hook contract, doesn't reuse the thinking plugin's `frontend-render` cleanly.

### D2 — State machine: contiguous reasoning bursts each get their own `<think>` block

**Decision**: Maintain a single boolean `inThinkBlock` inside `executeChat()`. Transitions (byte sequences are exact):

- Reasoning text observed AND `!inThinkBlock`: write `<think>\n` + reasoning text, set `inThinkBlock = true`.
- Reasoning text observed AND `inThinkBlock`: write reasoning text only.
- Content delta observed AND `inThinkBlock`: write `\n</think>\n\n`, set `inThinkBlock = false`, then proceed with existing `persistChunk` flow (which dispatches `response-stream` and writes content). The leading `\n` ensures `</think>` sits on its own line even when the last reasoning chunk did not end with a newline.
- Stream ends (clean done, abort, or mid-stream-error throw) AND `inThinkBlock`: in the existing `finally { file.close(); }` we add a step to write `\n</think>\n` first (one trailing newline because nothing follows). Because `finally` runs for ALL exit paths (success, abort, ChatError throw, hook error), this is a single point of cleanup.

**Single-chunk reasoning + content**: When one SSE chunk's `delta` carries BOTH reasoning text AND content text, the state machine SHALL process reasoning first (open + write reasoning), then emit `\n</think>\n\n` to close, then process the content delta. This guarantees the canonical byte order regardless of whether the upstream split reasoning/content across two chunks or fused them into one.

**Cleanup error nesting**: `closeThinkBlockIfOpen()` performs an async file write and an `onDelta` invocation; either may throw. To preserve the primary error from the streaming loop (`ChatAbortError`, mid-stream `ChatError`, hook throw), the cleanup SHALL be wrapped in its own nested try/finally:

```ts
} finally {
  try {
    await closeThinkBlockIfOpenBestEffort();
  } catch (cleanupErr) {
    logger.warn("close-think-block failed", { cleanupErr });
  } finally {
    file.close();
  }
}
```

This guarantees that `file.close()` always runs, the primary error always propagates, and a closer-write failure becomes a logged warning rather than a masked exception.

**Rationale**:

- Real reasoning streams from OpenRouter are typically monotonic (reasoning first, then content). The state machine handles that case in O(1) extra state.
- "Interleaved" mode — reasoning resuming after content has begun — is permitted by the spec by simply re-opening a fresh `<think>` block when reasoning text arrives while `!inThinkBlock`. No special interleave logic required.
- Closing `<think>` in `finally` (rather than at end of stream) covers the abort/error cases automatically: a chapter file aborted mid-reasoning still has a syntactically valid `<think>` block on disk, ready for the frontend `thinking` plugin to fold.

**Alternative considered**: write `<think>` opener at very start (next to `<user_message>` prefix), close after first content, and silently drop any later reasoning. Rejected — drops legitimate model behaviour and forces an empty `<think></think>` for non-reasoning models if we open it eagerly.

### D2.5 — Reasoning-only streams remain "no-content" errors

**Decision**: A stream that emits reasoning but zero `delta.content` chunks SHALL continue to throw `ChatError("no-content", ..., 502)` exactly as today. The streaming `finally` SHALL still close the `<think>` block before `file.close()`, so the chapter file on disk remains syntactically valid; but the route handler SHALL convert the error to its existing 502 / `chat:error` envelope, no `chat:done` SHALL be sent, and the chapter SHALL effectively be discarded by the user-facing UX. The LLM-interaction-log entry for the failed turn SHALL include `reasoningLength`.

**Rationale**: a model emitting reasoning without ever producing an answer is broken; the existing no-content error is the right signal. Suppressing the error just because reasoning was emitted would let "thinking forever" runs masquerade as successes.

### D3 — Reasoning text bypasses `response-stream` and `aiContent`

**Decision**: Inside `executeChat()`, reasoning text deltas:

- ARE written directly to the chapter file (raw bytes — no hook dispatch).
- ARE forwarded to `onDelta?.(...)` (so WebSocket `chat:delta` carries them and the frontend renders them live).
- Are NOT appended to the `aiContent` accumulator (the internal "transformed model answer" buffer).
- Are NOT passed through the `response-stream` hook (so `context-compaction`, future summarisers, etc. do not transform the model's scratchpad).

**Public `ChatResult.content` semantics** (clarified, not changed): `ChatResult.content` is currently `preContent + aiContent`, so it includes the `<user_message>...</user_message>\n\n` prefix produced by the `user-message` plugin's `pre-write` hook. With this change, `ChatResult.content` SHALL still be `preContent + aiContent` — meaning it continues to include `<user_message>` but SHALL NOT include `<think>` markup or reasoning text. The HTTP `POST /chat` response body's `content` field is the same string. The only divergence introduced by this change is between (a) the chapter file on disk, which contains `<user_message>` + `<think>` + content, and (b) the response envelope's `content` field, which contains `<user_message>` + content. Plugins consuming `post-response` SHALL see the same `content` value as today (no `<think>`).

**Rationale**:

- `aiContent` is the canonical "model answer" string returned in the HTTP completion envelope and surfaced to `post-response` hooks. Including reasoning would break the semantic of that field — e.g. `state` plugins parsing the output would have to learn to skip `<think>` blocks.
- Skipping the `response-stream` hook is the safer default: those handlers were written assuming "this is the model's output". If a future plugin genuinely wants to react to reasoning, we can add a hook then; YAGNI for now.
- Forwarding to `onDelta` preserves the live "watch the model think" UX the frontend already supports.

**Trade-off**: the chapter file on disk and the `aiContent` returned in the response envelope WILL diverge for reasoning-emitting turns (disk has `<think>` block + content; envelope has just content). This is intentional and worth documenting; the chapter file is the source of truth, and re-reading the file later is the canonical way to see reasoning.

### D4 — Reasoning text source priority: `delta.reasoning` first, fall back to `delta.reasoning_details[].text`

**Decision**: Per chunk, extract reasoning text via:

1. If `typeof delta.reasoning === "string"` and it has length > 0, use that.
2. Else, if `delta.reasoning_details` is an array, concatenate `text` strings from each item that has a string `text` field (skip non-string items, skip items with `signature` only).
3. Else, no reasoning text for this chunk.

**Rationale**:

- OpenRouter and most reasoning-model providers populate `delta.reasoning` (the simple text shortcut). It is the documented common path.
- `delta.reasoning_details` carries the structured form (sometimes with multiple parts: `text`, `signature`, etc.). We only want the human-readable parts.
- Both fields are non-standard extensions, but consistently named across OpenRouter's reasoning models. Custom `LLM_API_URL`s that don't emit them simply produce no `<think>` block.

**Alternative considered**: only inspect `delta.reasoning` (text). Rejected — some providers emit only `reasoning_details` with no flattened `delta.reasoning` field.

### D5 — Where the `<think>` block opens: lazily, on first reasoning text

**Decision**: Do NOT pre-emit `<think>\n` as part of `pre-write`'s `preContent`. Open lazily on first reasoning delta inside the SSE loop.

**Rationale**:

- For non-reasoning models (or `reasoning.enabled=false`), no reasoning ever arrives — pre-emitting `<think>` would leave an unclosed or empty block on disk.
- The `pre-write` hook is owned by plugins; we don't want the reasoning feature in `chat-shared.ts` to inject content via a path it doesn't own.
- Lazy open keeps the no-reasoning case bit-identical to today's chapter file format.

### D6 — Mid-stream-error and abort interactions

**Decision**:

- Abort during reasoning: `<think>` is closed by `finally`, `aborted=true` cleanup branch runs as today, `ChatAbortError` is thrown. The chapter file on disk has `<user_message>...</user_message>\n\n<think>\n<partial reasoning>\n</think>\n` and nothing else — a syntactically valid file.
- Mid-stream provider error during reasoning: `<think>` closed by `finally`, `ChatError("llm-stream", ..., 502)` is thrown. Chapter file has `<user_message>...</user_message>\n\n<think>\n<partial reasoning>\n</think>\n`.
- Mid-stream provider error during content (after reasoning closed): unchanged from today — `<think>` was already closed, partial content preserved.
- Abort during content (after reasoning closed): unchanged from today.

**Rationale**: The `2026-04-29-fix-streaming-cancellation` design narrowed the abort catch around `reader.read()` and added a single `finally { file.close(); }`. Adding `closeThinkBlockIfOpen()` immediately before `file.close()` in that `finally` handles every exit path with one line.

### D7 — Logging

**Decision**: Add an optional `reasoningLength: number` field to the LLM-interaction-log success entry (alongside the existing `aiContentLength`). For abort and mid-stream-error log entries, also include the reasoning length already streamed.

**Rationale**: cheap observability on a non-trivial new behaviour. Lets operators verify reasoning is/isn't streaming for a given model without tail-grepping chapter files.

## Risks / Trade-offs

- **Risk**: A non-OpenRouter `LLM_API_URL` that emits reasoning under a different field name (`delta.thoughts`, `delta.reasoning_summary_text`, etc.) won't trigger our extraction. → Mitigation: scope is explicitly OpenRouter Chat Completions; document the field names; future custom-URL support can extend the source priority list (D4).
- **Risk**: A model that interleaves reasoning and content rapidly will produce many small `<think>` blocks. → Mitigation: the frontend `thinking` plugin already folds multiple blocks; small fragmentation is cosmetically fine. If a specific model proves problematic we can add coalescing later.
- **Trade-off**: chapter file content diverges from `aiContent` envelope (D3). → Mitigation: documented in spec, asserted by tests; the divergence is intentional and aligns with semantic separation of "scratchpad" vs "answer".
- **Trade-off**: prior turns' `<think>` blocks are sent to the model in the next prompt's `previousContext` (no `promptStripTags` for `think`). → Mitigation: deferred to Open Question Q1; current behaviour is permissive (full transparency in prompt); easy to flip later by adding `promptStripTags: ["think", "thinking"]` to `plugins/thinking/plugin.json`.
- **Risk**: Large reasoning bursts could fragment the chapter file write into many tiny `file.write()` calls. → Mitigation: same dual-write pattern we already use for content deltas; not a new bottleneck.
- **Risk**: `delta.reasoning_details` may carry binary or non-string `text` items (e.g. signature blobs). → Mitigation: D4's extractor is type-guarded; non-string `text` and items with no `text` field are skipped.
- **Risk**: A `frontend-render` plugin that extracts xml-shaped blocks non-greedily (e.g. external `scene-info-sidebar` matching `<scene>...</scene>`) can match a tag mention *inside* a `<think>` block and consume the closing `</think>`, leaving an unclosed `<think>` whose incomplete-block fallback then gobbles the rest of the chapter. Live reproduction observed at `艾爾瑞亞/狩獵任務/chapter/1` after this change shipped: a `<scene>` mention inside `<think>` collided with a body `</scene>`, removing the `</think>` in the process. → **Mitigation**: the `thinking` plugin's `frontend-render` registration priority MUST be the lowest among any plugin that extracts xml-shaped blocks (set to `30` in `plugins/thinking/frontend.js:27`; external plugins extracting `<scene>`/`<status>`/etc. use `35+`). The `FrontendHookDispatcher` sorts handlers by ascending priority, so `thinking` runs first and removes complete `<think>...</think>` blocks before any other extractor sees the text. Plugin authors adding new `frontend-render` extractors MUST pick a priority strictly greater than `30`.

## Open Questions

**Q1 — Should prior `<think>` blocks be stripped from `previousContext` on next turn?**
Current default (no change): they are sent to the model. That matches OpenRouter's recommended pattern of preserving reasoning across turns to maintain chain-of-thought continuity. But it costs tokens proportional to historical reasoning volume. Recommendation: leave default permissive, document the decision in the spec, and make stripping a one-line manifest flip in `plugins/thinking/plugin.json` if a future change wants the cheaper behaviour. NOT addressed in this change.

**Q2 — Should we also expose a per-story `_config.json` toggle to disable `<think>` block streaming even when `reasoning.enabled=true`?**
Recommendation: no, YAGNI. Operators can already set `reasoningEnabled: false` per story, which suppresses reasoning at the upstream provider — a strictly better lever than a client-side filter.

## Accepted Trade-offs (not addressed by this change)

- **Reasoning text containing literal `<think>` / `</think>` substrings will break frontend folding.** OpenRouter's reasoning text is plain natural-language; collisions are vanishingly unlikely in practice. We accept the risk rather than introducing escaping (which would require symmetric un-escaping in the frontend `thinking` plugin and would alter the model's verbatim text on disk). If a real-world model proves problematic, a future change can add minimal substitution.
- **`response-stream` hook bypass means redaction/safety plugins do NOT see reasoning.** This is an explicit privacy/safety trade-off: any future plugin that filters or redacts model output via `response-stream` will not run on reasoning text. If a future redaction need arises, the right answer is a dedicated `reasoning-stream` hook stage rather than retrofitting `response-stream`. We document this so plugin authors don't assume `response-stream` is the universal output sink.
- **Whitespace-only reasoning fragments open a `<think>` block.** The extraction predicate is `length > 0`, not `text.trim().length > 0`. Whitespace fragments are rare in practice and dropping them silently could lose intentional newlines that providers use to separate reasoning paragraphs. We accept the rare empty-looking block.
- **`reasoningLength` is `string.length`, not byte count.** This matches the existing `aiContentLength` field. Per JavaScript semantics, this is UTF-16 code-unit count; CJK characters and BMP emoji count as 1, non-BMP emoji count as 2. Operators reading the log should be aware.

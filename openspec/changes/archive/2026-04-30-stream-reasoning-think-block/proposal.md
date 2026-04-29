## Why

Reasoning-capable models (e.g. `deepseek-v4-pro`, GPT-5 thinking variants) accessed via OpenRouter currently stream their chain-of-thought as `delta.reasoning` text on every SSE chunk, with the structured form available as `reasoning_details` on the final assistant message. Today `executeChat()` ignores both fields entirely — so the model's deliberation is invisible to the reader, never persisted to disk, and effectively wasted. We already pay for those reasoning tokens (when `reasoning.enabled=true`), and the existing `thinking` plugin is poised to fold `<think>` blocks into collapsible UI elements but never receives any input. This change makes reasoning a first-class part of the chapter file so users can read, fold, and audit how the model thought through each turn.

## What Changes

- `executeChat()` SHALL inspect each SSE chunk's `choices[0].delta.reasoning` (string) AND, as a fallback, extract reasoning text from `choices[0].delta.reasoning_details[*].text` (structured form).
- When the first reasoning text is observed for a turn, the writer SHALL open a `<think>` block in the chapter file (immediately after the `<user_message>` block written by the `user-message` plugin's `pre-write` hook, and before any model content).
- Reasoning text SHALL be streamed to disk and to the WebSocket / `onDelta` callback in the same dual-write fashion as content deltas, so the frontend `thinking` plugin's existing `frontend-render` fold renders it live as the model thinks.
- When the first content delta arrives after reasoning has started, the writer SHALL close the open `<think>` block with `</think>\n\n` and switch to the existing content-write path.
- If reasoning ever resumes after content has begun (interleaved chain-of-thought, allowed by some models), a new `<think>` block SHALL be opened — i.e. each contiguous reasoning burst is wrapped in its own `<think>...</think>`.
- If the stream ends while a `<think>` block is still open (reasoning-only turn, or stream ended/aborted mid-reasoning), the writer SHALL close it cleanly in the existing `finally` block before the chapter file is closed.
- The reasoning text SHALL NOT be passed through the `response-stream` hook (so plugins like `context-compaction` do not summarise/transform reasoning), and SHALL NOT contribute to `aiContent` returned in the HTTP / WebSocket completion envelope (so post-response hooks see only the model's answer, not its scratchpad). It SHALL still be visible to the WebSocket / `onDelta` callback as part of the live stream.
- `LLMStreamChunk.choices[0].delta` is extended with optional `reasoning?: string` and `reasoning_details?: ReadonlyArray<{ text?: string }>` fields. No upstream request shape changes (we already send `reasoning: { enabled, effort }`).
- The `thinking` plugin requires no code changes — its existing `frontend-render` hook already folds `<think>...</think>`. We will, however, double-check that its manifest handles prompt-context and display correctly (see Impact).
- Backend tests cover: reasoning-only stream, content-only stream (no regression), reasoning→content (canonical), interleaved reasoning↔content, abort during reasoning, mid-stream error during reasoning, malformed `reasoning_details` payload.

## Capabilities

### New Capabilities
- `reasoning-think-block`: contract for streaming OpenRouter `delta.reasoning` / `delta.reasoning_details` text into chapter files as `<think>...</think>` blocks, including state-machine semantics, abort/error interactions, and the boundary with the `response-stream` hook.

### Modified Capabilities
- `writer-backend`: the `LLM API proxy` requirement gains a paragraph and one scenario for reasoning streaming; cross-references the new capability for the full contract.

## Impact

**Code**:
- `writer/lib/chat-shared.ts` — extend `handlePayload` with reasoning extraction and a small state machine; add a `closeThinkBlockIfOpen()` helper called from the streaming `finally`.
- `writer/types.ts` — extend `LLMStreamChunk.choices[0].delta` with optional `reasoning` and `reasoning_details` fields.
- `tests/writer/lib/` — add `chat_shared_reasoning_test.ts` with the seven scenarios above.

**Plugins**:
- `plugins/thinking/plugin.json` — verify the existing `tags`, `displayStripTags`, and absence of `promptStripTags` behave as desired now that real `<think>` blocks live in chapters. If we want the model to NOT see prior turns' reasoning in the next prompt (to save tokens), we MAY add `promptStripTags: ["think", "thinking"]` here. Decision deferred to design.md.
- No backend module changes for `thinking`; its `frontend-render` hook already handles fold.

**Other surfaces**:
- WebSocket `chat:delta` envelope unchanged — reasoning deltas flow through `onDelta` as plain text fragments (`<think>\n` / reasoning text / `</think>\n\n`), which is exactly what the existing frontend Markdown pipeline + thinking plugin's extract-and-fold pattern already handles.
- HTTP `POST /chat` response body — `aiContent` field intentionally excludes the `<think>` text (post-response hooks should see only model output). The chapter file on disk is the source of truth and contains the full `<user_message>` + `<think>` + content sequence.
- LLM interaction log — gains an optional `reasoningLength: number` field on the success log entry, mirroring the existing `aiContentLength`. Useful for observability of reasoning token usage.

**Dependencies**: none. No new env vars, no new config fields, no new hooks.

**Risks**:
- Some non-reasoning models, or reasoning models with `reasoning.enabled=false`, will emit no `delta.reasoning` — must be a pure no-op (no empty `<think></think>` block in chapter file).
- OpenRouter's `delta.reasoning` is a non-standard extension; if a custom `LLM_API_URL` (vLLM, etc.) doesn't emit it, the feature simply disengages (no `<think>` block, content streams as today).
- The structured `reasoning_details` array carries provider-specific opaque tokens (signatures, encrypted segments) we do NOT persist — only the human-readable `text` portion is appended to `<think>`.

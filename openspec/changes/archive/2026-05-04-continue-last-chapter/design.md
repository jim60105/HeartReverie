## Context

The HeartReverie chat pipeline (`writer/lib/chat-shared.ts → executeChat() → streamLlmAndPersist({ kind: "write-new-chapter" })`) creates a fresh `NNN.md` chapter file for every user turn. When the upstream LLM stops generating prematurely — provider-side timeout, mid-stream error, accidental user `chat:abort`, or simply the model deciding the response is "done" before reaching the project's 20-line minimum — the user has only two recovery paths today:

1. **Edit** the chapter (open `chapterEditor`, paste / type the missing prose by hand). Wasteful and breaks immersion.
2. **Resend** (`chat:resend` deletes the last chapter and re-issues the same `chat:send`). Discards the partial bytes already on disk and re-pays the upstream cost for tokens that were already produced.

Recent work on `streaming-cancellation` makes both abort and mid-stream error reliably preserve the partial chapter file — so the bytes the user wants to keep are already on disk. The missing piece is a one-click affordance to **continue** generation in place, which is the focus of this change.

Two implementation paths exist for "continue":

- **Path A — second user turn that says "請繼續"**. Trivial to wire up (the existing `chat:send` handles it), but requires a real `<user_message>` block to be appended to the chapter file (visible in the export, polluting the prose), and asks the LLM to *interpret* the directive — which models often respond to by restating the previous paragraph or by switching modes.
- **Path B — assistant-prefill**. Send chapters 1..n−1 in `previous_context` (existing flow) and append the **stripped** content of chapter n as a final `{ role: "assistant", content }` message. The OpenAI-compatible upstream treats this as a prefill: the model resumes generation by appending tokens that are concatenated to the supplied assistant content, with no restating. This requires zero changes to the system prompt template (`system.md`) and zero changes to the chapter file format on disk — the chapter retains its leading `<user_message>` block from the original `chat:send`, and the streamed continuation deltas are appended to its existing tail.

Path B is the right answer for this codebase because the project explicitly defaults `LLM_API_URL` to OpenRouter (per `writer/lib/config.ts`), where prefill via a trailing assistant message is documented and reliable. The trade-off is provider-dependence (covered in **Risks / Trade-offs** below).

## Goals / Non-Goals

**Goals:**

- Let the user resume generation on the latest chapter with a single click, with zero loss of bytes already streamed to disk.
- Reuse the existing streaming, cancellation, mid-stream-error, token-usage, and idle-timer code paths in `streamLlmAndPersist()` and `writer/routes/ws.ts` — the new code path SHALL be a thin specialisation, not a parallel pipeline.
- Make the prompt construction transparent to the system prompt template (`system.md`) — the trailing assistant prefill is appended to the rendered message array *after* `renderSystemPrompt()` returns, so authors editing `system.md` need not learn a new control flow.
- Preserve the chapter file format on disk: the existing `<user_message>…</user_message>` block at the head of chapter n stays intact; new bytes are appended to the file's tail.
- Disable the Continue button precisely when continuation would be invalid (no story, no chapters, empty latest chapter, or another generation in flight).

**Non-Goals:**

- Continuing earlier chapters (only chapter n, i.e. the highest-numbered file). Continuing chapter k < n would require re-positioning chapter k+1..n into `previous_context` and re-appending k+1..n bytes after the continuation completes — out of scope.
- Mid-chapter editing or "continue from cursor" — the prefill is always the entire content of chapter n.
- Adding a `prefill: true` / `continue_final_message: true` request flag for providers that need it. The default upstream (OpenRouter) infers prefill from the trailing assistant role; strict-OpenAI deployments accept the documented limitation (see Risks).
- Backward compatibility / migration. The project is pre-release with zero deployed users; the new HTTP route and WS envelope ship without a deprecation window.

## Decisions

### Decision 1: Assistant-prefill via trailing message, not a system instruction or user "continue" turn

**Choice**: Append `{ role: "assistant", content: <stripped chapter-n> }` as the **last** entry of the rendered `messages` array passed to the upstream `fetch()`. Do not add a synthetic user turn. Do not modify `system.md`.

**Rationale**:
- OpenAI's `chat/completions` schema accepts an arbitrary terminal role. OpenRouter explicitly documents that providing a trailing assistant message causes the upstream model to **continue** that message rather than restart — the tokens generated are concatenated to the supplied content in the model's context, and only the *new* tokens are streamed back. This is the cheapest, most contract-faithful way to express "continue from here".
- A synthetic user "請繼續" turn would (a) require an additional `<user_message>` block to be visible on disk for round-trip fidelity (otherwise the next prompt build re-reads the chapter and the synthetic turn is lost — but if we *don't* persist it the model in this generation sees a user turn the next round won't), (b) ask the model to *interpret* a meta-instruction in the same language as the prose (Traditional Chinese), and (c) frequently cause restating in practice.
- A `system` role injection ("You stopped early. Continue.") has the same restating problem and additionally pollutes the system prompt cache in providers that do prefix caching.

**Alternatives considered**:
- Modify `system.md` with a `{{ if isContinue }}` Vento branch that flips the trailing user message to an assistant prefill. Rejected because the cards-mode prompt editor (`PromptEditorMessageCard.vue`) does not support runtime role flipping mid-template, and the Vento sandbox whitelist would need a new conditional pattern.
- Send `messages: [...history]` and pass the chapter-n content as a non-standard `prefill` request field. Rejected: not in the OpenAI / OpenRouter schema; would be silently dropped or rejected.

### Decision 2: New `WriteMode` variant `continue-last-chapter` rather than overloading `write-new-chapter`

**Choice**: Add `{ kind: "continue-last-chapter"; targetChapterNumber: number; existingContent: string }` to the `WriteMode` discriminated union in `writer/lib/chat-shared.ts` (alongside the three existing variants `"write-new-chapter"`, `"append-to-existing-chapter"`, `"discard"`). Switch `streamLlmAndPersist()` on this new arm for: file-open mode (`{ append: true }` instead of `{ truncate: true }`), `pre-write` hook skip (no new user message), `<think>` framing reuse, `post-response.source = "continue"`.

**Rationale**:
- The existing `WriteMode` enum already discriminates between `write-new-chapter`, `append-to-existing-chapter` (plugin-action append), and `discard`. Adding `continue-last-chapter` is the minimum-surprise extension and TypeScript's exhaustive `switch` will surface every site that needs to handle it.
- Reusing `append-to-existing-chapter` is tempting (both modes append) but wrong: the plugin-action append wraps content in a synthetic `<{appendTag}>…</{appendTag}>` envelope, runs `normaliseAppendContent()`, and skips the `response-stream` hook. Continue does **not** wrap (the prefill is conceptually one continuous prose block with the existing chapter content), and **does** dispatch `response-stream` per chunk so plugins (e.g. dialogue-colorize) get every delta.

**Alternatives considered**:
- Boolean `isContinue` flag on `write-new-chapter`. Rejected — the file-open semantics differ enough (truncate vs. append) that a single arm with conditionals would be harder to read and easier to break.

### Decision 3: Parse chapter n into `<user_message>` and prose, send as user turn + assistant prefill

**Choice**: When building the prompt for continue, parse the latest chapter's on-disk bytes into two parts:

- `userMessageText` = the *content* of the **first** `<user_message>…</user_message>` block in the chapter, with the wrapping tags removed (or `""` when no such block exists).
- `assistantPrefill` = the chapter bytes with that first `<user_message>…</user_message>` block removed, then run through `stripPromptTags()` to drop any other plugin framing tags (e.g. `<state>`).

Render `system.md` with `userInput: userMessageText` (so the trailing user turn carries the user's possibly-edited prompt) and append `{ role: "assistant", content: assistantPrefill }` as the final message in the array. The chapter file on disk is **NOT** modified; only the in-memory message array sent upstream is structured this way.

**Rationale**:

- Users frequently edit chapter n on disk between generations: they may rewrite the `<user_message>` block to refine the directive, or trim/rewrite the half-generated prose, or both. Splitting the chapter at the `<user_message>` boundary makes both kinds of edit semantically meaningful: edits to `<user_message>` change the user turn the model sees; edits to the prose change the assistant prefill the model continues from. A naive "strip everything and treat as one assistant prefill" approach would fold edits to `<user_message>` into the prefill (or drop them entirely after `stripPromptTags()`), silently discarding the user's revised intent.
- The `stripPromptTags()` helper used by `previous_context` strips `<user_message>…</user_message>` *with content*, so chapters 1..n−1 still send only prose in the prior assistant turns — preserving the existing convention. Only chapter n is parsed differently because it is the active turn whose user_message must drive the next generation.
- When `<user_message>` is absent (chapter starts directly with prose, possible if the user-message plugin was disabled or the user manually deleted the tag), `userMessageText = ""` and the trailing user turn renders empty (Vento `system.md` handles empty `userInput` gracefully — it has done so since the project's first round before any user input exists). The assistant prefill carries the entire stripped chapter and the model continues from there.
- When `<user_message>` is present but the prose after it is empty (the LLM produced nothing yet, or the user manually deleted the prose), `assistantPrefill = ""` and the trailing assistant message has empty content. The provider receives a normal user turn with no prefill and effectively re-runs generation from scratch — semantically equivalent to a fresh `chat:send` on the same prompt, which is the correct behaviour.

**Alternatives considered**:

- Strip the entire chapter via `stripPromptTags()` and treat the stripped result as one assistant prefill (the original v1 design of this change). Rejected because it discards user edits to `<user_message>` — `stripPromptTags()` removes the block with its content.
- Send chapter n as a single assistant message containing the unstripped bytes (including `<user_message>` tags). Rejected because it teaches the model that assistant turns may begin with `<user_message>` tags, polluting its grammar; also pollutes prefix caches in providers that hash messages.
- Persist the parsed `userMessageText` to a sidecar file so it survives across continues. Rejected: the chapter file is the canonical source of truth; reading it fresh from disk on each call gives the same effect with zero schema change.

**Edge case — multiple `<user_message>` blocks in chapter n**: the parser SHALL extract only the **first** occurrence. Any subsequent `<user_message>` blocks (rare, possible if a previous continue round fed a synthetic user turn — though this design does not produce them) are removed by `stripPromptTags()` from the prose remainder.

### Decision 9: Re-read chapter n from disk on every Continue invocation

**Choice**: `buildContinuePromptFromStory()` SHALL call `Deno.readTextFile(chapterPath)` for the latest chapter on every Continue invocation. No in-memory cache, no reuse of bytes loaded for a previous round.

**Rationale**:

- Users may edit the chapter file via the in-UI editor (`chapterEditor`) or by external means (text editor on disk, sync from another device) between LLM rounds. Continue is conceptually "resume from whatever is on disk *right now*"; any caching layer would silently use stale bytes and produce a continuation that doesn't follow from what the user sees.
- The cost is one `Deno.readTextFile` call per Continue (a few KB to a few hundred KB of UTF-8); negligible compared to the upstream LLM round-trip. Chapters 1..n−1 continue to be loaded by the existing `buildPromptFromStory()` flow, which already reads them fresh on each prompt build.

**TOCTOU window**: between the read in `buildContinuePromptFromStory()` and the `Deno.open(..., { append: true })` in `streamLlmAndPersist()`, the user could theoretically edit the file again. Three layers of mitigation:

1. The per-story generation lock (`tryMarkGenerationActive`) is acquired *before* the read and held until persistence completes; any continue-or-chat invocation observes a consistent locked state.
2. The chapter editor in the frontend disables edit/save while `isLoading` is true (the same flag that gates the Continue button), so concurrent in-UI edits cannot interleave.
3. **Snapshot guard**: immediately before opening the chapter file for append, `streamLlmAndPersist()` re-reads the bytes from disk and compares them to `writeMode.existingContent` (captured during the parse step). On mismatch the function throws `ChatError("conflict", "Latest chapter changed during continue; please retry", 409)` before any append occurs. This catches the rare case of an external editor (CLI, sync daemon, second connected client without UI gating) racing the lock.

Once the snapshot has been verified and the file is open for append, the stream may run for many seconds; we accept that bytes appended during streaming may interleave with a sufficiently determined external writer, but in practice this requires shell access during an active stream. The result in that pathological case is whatever bytes ended up concatenated; we document this as accepted.

### Decision 4: New `executeContinue()` parallel to `executeChat()`, no parameter overload

**Choice**: Add a separate exported function `executeContinue(options: ContinueOptions)`. Do not extend `executeChat()` with a `mode` parameter.

**Rationale**:
- `ContinueOptions` lacks the `message` field that `ChatOptions` requires (no user input). A union type with optional `message` would weaken the existing call sites that rely on `message: string`.
- The route handlers (`chat.ts`, `ws.ts`) need different validation (continue has no message-length check; instead it has a "no-chapter" / "empty-chapter" precheck), so the route-level dispatch is already different. A separate library function reflects that.

**Alternatives considered**:
- Single `executeChat()` with `mode?: "send" | "continue"`. Rejected for the type-safety reason above.

### Decision 4a: Response `content` is the **full updated chapter**, not just the newly generated bytes

**Choice**: The HTTP response `{ chapter, content, usage }` and the `post-response` hook event MUST carry **the full updated chapter** in `content` — original pre-continue bytes plus everything appended during this stream — NOT just the bytes produced by the LLM during this call. To produce this value, the `"continue-last-chapter"` arm of `streamLlmAndPersist()` re-reads the chapter file from disk via `Deno.readTextFile(chapterPath)` after the stream completes and assigns the result to `chapterContentAfter` on the return value. The route handler in `chat.ts` (and the WS handler) then returns `result.chapterContentAfter` as the response `content` field — NOT `result.content` (which by the existing contract continues to be only the newly generated bytes).

**Rationale**:
- This mirrors the existing `"append-to-existing-chapter"` arm in `writer/routes/plugin-actions.ts`, which already re-reads the chapter file from disk and dispatches `post-response` with the full chapter. Plugins like `context-compaction` rely on receiving the **full chapter content**, not a delta — diverging here would silently break them for continue-mode events.
- It also matches what the frontend needs: after a continue completes, the chapter view should show the same bytes that are on disk. Returning only the delta would force the frontend to re-concatenate, duplicating logic that already exists server-side and creating drift if framing transforms (e.g. `<think>` stripping) ever differ.
- Re-reading from disk (rather than computing `existingContent + transformedAppendedBytes` in memory) is the same conservative pattern `plugin-actions.ts` uses; it guarantees the response reflects exactly what was persisted, even if a chunk-level transform or hook mutated the byte stream between memory and disk.

**Alternatives considered**:
- Return only the delta in `content`. Rejected: inconsistent with append-mode plugin-actions behaviour and breaks plugins that expect full-chapter `post-response` payloads.
- Compute `existingContent + transformedAppendedBytes` in memory without re-reading. Rejected: duplicates logic and risks divergence from on-disk bytes if a hook transforms chunks.

### Decision 5: Reuse `tryMarkGenerationActive` / `clearGenerationActive` for concurrency

**Choice**: `executeContinue()` SHALL call `tryMarkGenerationActive(series, name)` and release in `finally` exactly like `executeChat()`. A continue request while another generation is active SHALL throw `ChatError("concurrent", …, 409)`.

**Rationale**:
- The frontend Continue button is gated by `isLoading`, but defence in depth matters: a second tab, a stale request, or a script could race. The existing per-story lock in `writer/lib/generation-registry.ts` is the right primitive and is already wired to surface 409.

### Decision 6: HTTP endpoint at `/chat/continue`, WS message type `chat:continue` — not overload `chat:send`

**Choice**: Distinct routes. The HTTP endpoint is `POST /api/stories/:series/:name/chat/continue` (no body required); the WS envelope is `{ type: "chat:continue", id, series, story }` (no `message`).

**Rationale**:
- The request payloads differ (no `message`). Overloading `chat:send` with `message: ""` would muddy validation (`message.trim().length === 0` currently rejects empty messages with 400) and force every reader of `chat:send` semantics to learn a new branch.
- The reply envelopes are identical (`chat:delta` / `chat:done` / `chat:error` / `chat:aborted`), so the streaming path on both server and client reuses the same correlation-by-`id` mechanism without change.

### Decision 7: Frontend gating refs surfaced from `useChapterNav`

**Choice**: Expose two new computed refs from `useChapterNav` (or whichever composable owns the chapter list state): `chapterCount` (number of `NNN.md` files) and `latestChapterIsEmpty` (boolean — true when the highest-numbered chapter's content is whitespace-only). The Continue button binds `disabled` to `disabled || isLoading || chapterCount === 0 || latestChapterIsEmpty`.

**Rationale**:
- These two refs are the single source of truth that map directly to the backend's refusal conditions (no chapter file → 400; empty latest chapter → 400). Mirroring the conditions in the UI prevents avoidable round-trips and gives the user the same semantic gate either way.
- Pre-existing `useChapterNav` already polls and parses chapter content for navigation purposes, so the data is in scope without a new fetch.

### Decision 8: No new request-body fields, no `prefill: true` upstream flag

**Choice**: Send the existing OpenRouter request body unchanged. Rely on the trailing-assistant-message convention.

**Rationale**:
- OpenRouter infers prefill from the trailing role; OpenAI's strict API likewise has no opt-in flag (and may insert a leading newline when the trailing message is `assistant`). Adding a `prefill: true` field would be ignored by both and rejected by stricter providers — it adds no value and creates compatibility risk.
- Anthropic via OpenRouter passthrough does honour the trailing-assistant convention as documented in OpenRouter's prefix-completion docs.

## Risks / Trade-offs

- **[Risk] Provider-dependent prefill semantics.** Strict OpenAI (api.openai.com) does not officially document prefill via a trailing assistant message and may insert a leading newline or fail to continue cleanly with some models (notably gpt-3.5-turbo and o-series reasoning models). → **Mitigation**: project default `LLM_API_URL` is OpenRouter, where this is documented and tested; this caveat is recorded in the `continue-last-chapter` capability spec and surfaced in release notes. Operators swapping to strict OpenAI accept the limitation; if a future change needs to support that case we can add a `prefill_strategy: "trailing-assistant" | "user-continue-prompt"` config knob.
- **[Risk] Concatenation seam looks wrong.** If chapter n's last byte is mid-token (e.g. an opening Chinese punctuation `「` with no closing `」`), the upstream may continue with content that doesn't visually merge cleanly. → **Mitigation**: the model is a language model and produces locally coherent continuations; in practice this works. We do NOT trim trailing whitespace from the prefill — preserving the exact byte boundary is more important than cosmetic merging.
- **[Risk] Frontend gating drift from backend reality.** If `useChapterNav` polls less frequently than the user clicks, the button could be enabled while the backend now sees an empty latest chapter (e.g. plugin truncated it). → **Mitigation**: the backend's defence-in-depth precheck returns 400 with a generic "Latest chapter is empty" detail; the frontend surfaces it via the existing `errorMessage` ref. No silent failure.
- **[Trade-off] No "continue earlier chapter" capability.** Out of scope for this change. Users with truncated chapter k < n must edit manually or rewind to chapter k. We accept this trade-off because (a) the truncation case overwhelmingly occurs on the chapter currently being generated, and (b) the in-place append semantics are clean only at the tail of the latest file.
- **[Risk] Plugin `post-response` consumers may not expect `source: "continue"`.** → **Mitigation**: audit `plugins/*` `post-response` handlers and ensure either default-branch fall-through or explicit handling of the new value. The proposal already covers this; tasks.md enumerates the audit.
- **[Trade-off] Continue does not dispatch `pre-write`.** Plugins that rely on `pre-write` to inject a leading `<user_message>` block (none exist today, but the user-message plugin is conceptually similar) would be skipped. → **Mitigation**: this is by design — there is no new user message in the continue path. Document it in the `continue-last-chapter` spec.

## Migration Plan

Not applicable — pre-release project, zero deployed users. After merge:

1. Backend tests + frontend tests run in CI.
2. Manual smoke test: trigger a chat:send, abort it mid-stream, click Continue, confirm the chapter file's bytes are appended in place and the streaming UI shows only the new tokens.
3. No data migration, no env-var change, no plugin manifest change.

Rollback: revert the merge; the new HTTP route and WS message type disappear; existing flows continue to work because no existing code path was modified beyond the additive `WriteMode` switch arm.

## Open Questions

- Should the Continue button live inside `ChatInput.vue` (next to Send/Stop/Resend) or in `ChapterContent.vue` as a chapter-footer affordance? **Tentative answer**: `ChatInput.vue`, because the action is conceptually a chat operation and the button needs the same `isLoading` / `errorMessage` / `streamingContent` reactive context that `ChatInput.vue` already imports. Tasks.md commits to `ChatInput.vue`; revisit in code review if UX prefers the chapter footer.
- Should `chat:continue` reuse the per-passphrase rate limiter applied to `chat:send`, or be exempt? **Tentative answer**: reuse — a continue is an LLM call with the same upstream cost profile as a send. Tasks.md applies the existing limiter middleware to the new HTTP route.

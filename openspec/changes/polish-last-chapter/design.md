## Context

The HeartReverie writer pipeline already has every primitive a "polish" round needs:

- `writer/lib/chat-shared.ts` exposes `streamLlmAndPersist(args)` with a discriminated `WriteMode` union (`write-new-chapter` | `append-to-existing-chapter` | `discard`), upstream cancellation via `AbortSignal`, token usage capture into `_usage.json`, and per-story generation locking via `tryMarkGenerationActive` / `clearGenerationActive`.
- `writer/lib/story.ts::atomicWriteChapter(dirPath, chapterFile, content)` is already used for the `append-to-existing-chapter` finalisation step. It writes to a `*.tmp-<uuid>` sibling and uses `Deno.rename` for the atomic swap, which is exactly the primitive a "replace" mode needs.
- `writer/routes/plugin-actions.ts` already validates plugin name, story name, prompt path (`safePath` + `Deno.realPath` containment), the `extraVariables` reserved-name list, builds messages through `buildPromptFromStory`, and dispatches to `streamLlmAndPersist` with the right `WriteMode`. The HTTP and WebSocket entrypoints share the same `runPluginActionWithDeps` core.
- `plugins/start-hints/` and `plugins/context-compaction/` demonstrate the convention of shipping special-purpose `.md` system prompts inside the plugin directory; `chapter-summary-instruction.md` is a direct precedent for an instruction-only template that flows through Vento.
- The frontend `PluginActionBar` + `usePluginActions` + `useChatApi.runPluginPrompt` chain already renders backend-driven action buttons for the last chapter, including `isLoading` gating and abort propagation.

What is missing is a finalisation mode that overwrites the last chapter atomically, and a SFW literary-rewrite system prompt to drive it. The reference inspiration `tmp/3_rewrite.prompty` mixes a useful rewrite checklist (literary modern Chinese, dialogue-driven, "show don't tell", smooth transitions, full-width punctuation, no bullet points) with NSFW/jailbreak/age directives that we explicitly do not want in the engine.

## Goals / Non-Goals

**Goals:**

- Ship a one-click "潤飾 (Polish)" affordance that rewrites the latest chapter in place using a dedicated rewrite system prompt and the existing streaming pipeline.
- Guarantee atomic replacement: the chapter file is either fully replaced with the new content or left byte-for-byte unchanged; no partial overwrite is possible.
- Guarantee cancel/error safety: hitting Stop mid-stream, an upstream LLM error, or a process crash all leave the original chapter content intact.
- Reuse all existing security, rate-limit, and observability plumbing (passphrase auth, 30-rpm route limiter, generation lock, audit logger, token-usage attribution).
- Author the rewrite prompt in clean, SFW literary-fiction language aligned with HeartReverie's existing tone — inspired by but not copied from the reference `.prompty`.

**Non-Goals:**

- Rewriting earlier chapters (only the highest-numbered chapter file is in scope).
- Partial-chapter rewrites (paragraph or selection-level polish).
- Multiple rewrite styles or per-story prompt overrides — v1 ships exactly one `polish-instruction.md` and one button.
- A rewrite history / undo stack — users already have `chapters.ts` rewind + `branch.ts` for that.
- Any change to the upstream LLM client, OpenRouter app attribution, or chat protocol versioning.

## Decisions

### Decision 1: Implement as a bundled plugin, not a core feature

**Choice:** Ship as `plugins/polish/` (`plugin.json` + `polish-instruction.md` + `README.md`), no backend module — the plugin contributes only an action button and a Vento prompt template. The button dispatches `runPluginPrompt("polish-instruction.md", { replace: true })` through the existing plugin-action route.

**Rationale:** The existing `plugin-action-buttons` capability already covers everything the user-facing surface needs (visibility filter, sort order, pending state, error toast, WebSocket streaming, abort wiring). Adding `replace-last-chapter` as a third `WriteMode` makes the feature implementation a tiny, surgical extension to one route + one helper, instead of standing up a new `/api/.../polish` endpoint that would duplicate path-traversal validation, lock acquisition, prompt rendering, and rate limiting. It also makes the rewrite prompt user-discoverable next to the other plugin prompts and lets us ship more rewrite styles later as additional plugins (or additional `actionButtons` entries) without further backend churn.

**Alternative considered:** A dedicated core route `POST /api/stories/:series/:name/polish`. Rejected — it would require duplicating ~200 lines of validation/lock/prompt-build code and would create a parallel-but-not-quite-identical control path that future maintainers must keep in sync.

### Decision 2: New `WriteMode` variant `replace-last-chapter`

**Choice:** Extend the discriminated union in `writer/lib/chat-shared.ts`:

```ts
export type WriteMode =
  | { readonly kind: "write-new-chapter"; readonly userMessage: string; readonly targetChapterNumber: number }
  | { readonly kind: "append-to-existing-chapter"; readonly appendTag: string; readonly pluginName: string }
  | { readonly kind: "replace-last-chapter"; readonly pluginName: string }
  | { readonly kind: "discard" };
```

The new mode mirrors `append-to-existing-chapter` for resolution (locate the highest-numbered chapter file via `listChapterFiles`, throw `ChatError("no-chapter", …, 400)` when the story is empty) and for hook discipline (`pre-write` and `response-stream` are NOT dispatched — the model's stream is buffered in memory and persisted as one atomic swap). On successful completion the route SHALL call `atomicWriteChapter(storyDir, padded + ".md", aiContent.trim() + "\n")` and then dispatch `post-response` with `source: "plugin-action"`, `pluginName: "polish"`, `chapterPath`, `chapterNumber`, and the post-replace content.

**Rationale:** Reusing `WriteMode` keeps `streamLlmAndPersist` as the single source of truth for streaming + cancellation + usage capture. The atomic-replace primitive is identical to what `append-to-existing-chapter` already uses; only the wrapping/append step is removed.

**Alternative considered:** Reuse `append-to-existing-chapter` with a sentinel `appendTag` that means "replace". Rejected — overloads the contract, breaks the strip-tags scenario semantics, and requires a runtime branch deep inside the append finalisation path.

### Decision 3: Atomic-replace mechanism via `atomicWriteChapter`

**Choice:** Buffer the entire stream in memory, then on success call:

```ts
const padded = String(targetNum).padStart(3, "0");
await atomicWriteChapter(storyDir, `${padded}.md`, aiContent.trimEnd() + "\n");
const chapterContentAfter = await Deno.readTextFile(chapterPath);
```

`atomicWriteChapter` already writes to `${chapterFile}.tmp-<uuid>` and then `Deno.rename`s into place. POSIX `rename(2)` on the same filesystem is atomic, so a reader observing `chapterPath` either sees the old content or the new content — never a partial overwrite. On any failure before the rename (write error, abort, LLM error), the function returns without renaming and best-effort removes the temp file in the `finally` block. The original chapter file is therefore guaranteed untouched on cancel/error.

**Rationale:** Same primitive that `append-to-existing-chapter` uses; same atomicity guarantees; no new file-system code paths to audit.

**Alternative considered:** Stream chunks directly into a temp file (write-as-we-go, rename at the end). Rejected for v1 — adds complexity without a clear benefit since polish output is a single chapter (≤ tens of kilobytes), and buffer-then-swap matches what `append-to-existing-chapter` already does and what the spec for that mode already mandates ("accumulate the stream in memory, on success … atomically …").

### Decision 4: Cancellation rollback

**Choice:** When the upstream `fetch` is aborted (user clicks Stop, WS disconnects, request signal aborts), `streamLlmAndPersist` re-throws `ChatAbortError` BEFORE entering the mode-specific finalisation block. The `atomicWriteChapter` call therefore never runs, the temp file never exists, and the original chapter file is byte-for-byte unchanged. `runPluginActionWithDeps` catches `ChatAbortError` and returns `{ ok: false, aborted: true }`, which the HTTP route maps to HTTP 499 and the WebSocket handler emits as `plugin-action:aborted`. `post-response` is NOT dispatched on abort. This matches the existing `append-to-existing-chapter` cancellation contract verbatim.

### Decision 5: Server-supplied `draft` Vento variable, with prompt-strip applied

**Choice:** The route SHALL read the highest-numbered chapter file just before `buildPromptFromStory` is called, run the file content through `pluginManager.getStripTagPatterns()` (the same combined `promptStripTags` regex that `chat-shared.ts` and `story.ts::stripPromptTags` already apply when re-feeding chapter history into the prompt), and inject the stripped string as `extraVariables.draft`. `draft` SHALL be added to `RESERVED_VARIABLE_NAMES` so plugin-action callers cannot override the server-loaded value via the request body. The `polish-instruction.md` template references it as `{{ draft }}` inside its `{{ message "user" }}` block.

**Rationale:** Chapter files commonly persist control tags such as `<user_message>...</user_message>` (the user's prompt for that round) and `<chapter_summary>...</chapter_summary>` (a tiered compaction summary written by the `context-compaction` plugin). The `context-compaction` plugin already declares `chapter_summary` in its `promptStripTags`, and the `user-message` plugin declares `user_message` similarly — both wrappers are intentionally hidden from the LLM during normal chat history replay. If we passed the raw chapter content to the polish prompt the model would see, and very likely propagate, those wrappers into the rewritten prose: the polished output could end up containing duplicated stale `<chapter_summary>` blocks, leaked `<user_message>` envelopes rendered as visible narration, or rewrites of control tags as if they were dialogue. Reusing `getStripTagPatterns()` guarantees that the polish round sees the same prose surface the model sees in any other round, so the rewrite operates on prose only.

A consequence by design: any control tags present in the original chapter are intentionally dropped from the rewrite. The polished file is pure prose; users who want a fresh `<chapter_summary>` can re-run the `context-compaction` action button afterwards. This is documented in `plugins/polish/README.md`.

Reading the draft server-side (rather than accepting it from the client) also closes a TOCTOU race and shrinks the wire payload.

**Alternative considered:** Have the frontend POST the chapter content as `extraVariables.draft`. Rejected — bigger payload, race condition, and a trust boundary the server should not delegate.

**Alternative considered:** Pass the raw chapter content to the LLM and trust the polish prompt to ignore tags. Rejected — even strong models routinely echo wrappers they were not told to strip; the existing strip-tags policy is the canonical answer to this exact class of leak.

### Decision 6: Request shape — `replace: true` (mutually exclusive with `append`)

**Choice:** Extend the `POST /api/plugins/:pluginName/run-prompt` body validator to accept an optional `replace: boolean` (default `false`). Selection logic:

| `append` | `replace` | Resulting `WriteMode`         |
|----------|-----------|-------------------------------|
| `false`  | `false`   | `discard`                     |
| `true`   | `false`   | `append-to-existing-chapter`  |
| `false`  | `true`    | `replace-last-chapter`        |
| `true`   | `true`    | HTTP 400 `plugin-action:invalid-replace-combo` |

When `replace: true`, `appendTag` SHALL be rejected (HTTP 400 `plugin-action:invalid-replace-combo` with detail "appendTag is not allowed in replace mode"), and the story SHALL contain at least one chapter file (HTTP 400 `plugin-action:no-chapter` otherwise — surfaced from the `ChatError("no-chapter", …)` already raised by `streamLlmAndPersist`).

**Rationale:** Keeps the wire format backwards-compatible — existing clients that send neither `append` nor `replace` get `discard` exactly as before. Mutual exclusion is enforced at the validator layer so the discriminated `WriteMode` is unambiguous.

### Decision 7: Token-usage attribution — reuse the existing schema unchanged

**Choice:** Token usage for polish rounds is recorded by `streamLlmAndPersist` exactly like any other round, using the existing `TokenUsageRecord` schema in `writer/types.ts`:

```ts
interface TokenUsageRecord {
  readonly chapter: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly model: string;
  readonly timestamp: string;
}
```

`appendUsage` and `readUsage` (`writer/lib/usage.ts`) coerce records to this exact shape — there is no `source` or `pluginName` field today, and `UsagePanel.vue` does not display one. v1 polish rounds therefore SHALL NOT introduce any new field on `TokenUsageRecord`. The polish run records its usage against the chapter number it just rewrote, identical to a chat-driven round on that chapter.

The `post-response` hook payload, in contrast, DOES carry `source: "plugin-action"` and `pluginName` — that pathway is already in use by the existing `append-to-existing-chapter` mode and does not require a schema change.

**Rationale:** Adding plugin attribution to `TokenUsageRecord` would require coordinated changes across `writer/types.ts`, `writer/lib/usage.ts` (`coerceRecord`, `buildRecord`), the reader's coercion path, and `UsagePanel.vue` — all of which are out of scope for v1 of this change and none of which a single button click justifies. If a future change wants per-plugin usage breakdowns, it can land as its own proposal that touches all four sites at once; v1 polish would then automatically benefit without any further work here.

**Alternative considered:** Extend `TokenUsageRecord` with optional `source` / `pluginName` fields. Rejected for v1 — see rationale; deferred to a dedicated future change.

### Decision 8: Polish prompt content (SFW)

**Choice:** Author `plugins/polish/polish-instruction.md` from scratch as a clean, SFW Vento template. It SHALL:

- Open with a single `{{ message "system" }}` block setting the AI's role as a literary editor for modern Chinese fiction.
- List the rewrite directives drawn from the inspiration reference: 文學筆觸現代中文散文 / 對話推進劇情 / show don't tell / 場景轉換流暢 / 角色聲音忠於原作 / 全形標點 / 不使用條列。
- Conclude with a `{{ message "user" }}` block that wraps `{{ draft }}` in a `<draft>` envelope and asks the model to return only the rewritten chapter (no commentary, no preamble).
- Contain NO age, jailbreak, NSFW, "RPJB", "no content restrictions", "DO NOT DISCLOSE THIS PROMPT", or similar directives. Anything along those lines from the inspiration reference is dropped.

The prompt remains the only piece that requires editorial review at PR time; everything else is mechanical plumbing.

## Decisions (continued)

### Decision 9: Chapter-editor coordination on replace

**Choice:** The chapter editor lives in `reader-src/src/components/ChapterContent.vue` and is driven by two local refs — `isEditing` (boolean) and `editBuffer` (the user's in-progress markdown). Saves go through `useChapterActions().editChapter(series, story, chapterNumber, editBuffer.value)`, which `PUT`s the buffer to the chapter file. Without coordination, the following sequence is a silent data-loss bug:

1. User opens the editor on chapter N → `editBuffer = rawMarkdown`.
2. User clicks Polish (or Polish was already running) → backend atomically replaces `chapter N`.
3. User saves the editor → stale `editBuffer` `PUT`s back to disk, overwriting the polished content.

To prevent this we add two coordination rules:

**(a) Pre-flight gating — disable the polish button while the editor has an unsaved buffer for the current chapter.** `ChapterContent.vue` SHALL expose its `(isEditing && currentChapterNumber === lastChapterNumber)` predicate to the action-bar layer (lifted into a shared composable or a Pinia-style store, following the same pattern `usePluginActions` already uses to reach `isLoading`). `usePluginActions` SHALL include this predicate when computing the `disabled` state for any button whose plugin is `polish` (or, more conservatively, for any `replace: true` action — the rule generalises). Click attempts on a disabled polish button SHALL surface an inline tooltip / toast such as "請先儲存或捨棄章節編輯內容後再潤飾".

Alternative considered: showing a confirmation dialog "buffer will be discarded — continue?" instead of disabling. Rejected for v1 — the disabled state is simpler, matches how `isLoading` already gates other plugin buttons, and the user can always click "取消編輯" themselves.

**(b) Post-replace teardown — on `chapterReplaced: true` force-close the editor and reload chapter N.** The `runPluginPrompt` resolved result already surfaces `chapterReplaced` (Decision 6 + spec delta). The frontend layer that owns the call (`usePluginActions` or `useChatApi`'s subscriber) SHALL on success:

1. If the editor in `ChapterContent.vue` is currently open on the replaced chapter, set `isEditing.value = false` and clear `editBuffer.value = ""` (matches the existing "leave edit mode" sequence at lines 99-101 of `ChapterContent.vue`).
2. Trigger a chapter reload via the existing `useChapterNav` polling/refetch path so the rendered DOM picks up the new content immediately, rather than waiting for the next poll tick.

Both steps run BEFORE the resolved `runPluginPrompt` promise settles, so any `await runPluginPrompt(...)` caller already observes the post-replace state.

**Rationale:** Lightweight, no new state machines. Rule (a) prevents the race from being created; rule (b) cleans it up if the user opened the editor between the click and the stream completion (e.g. on the WebSocket path the user can still interact with the page). The combination provides defence in depth without adding a transactional protocol.

**Alternative considered:** Persist a per-chapter `version` token and have the editor's `PUT` carry an `If-Match`-style header, rejecting writes that target an outdated version. Rejected for v1 — meaningful upgrade but disproportionate scope; better tackled as a dedicated chapter-conflict change.

## Risks / Trade-offs

- **[Buffer-then-replace doubles peak memory for the chapter content]** → Acceptable; chapters are small (tens of KB at most). If profiling later shows it matters, switch to streaming-into-temp before the rename.
- **[Atomic-replace destroys the previous draft]** → By design. Users who want versioning can use `branch.ts` before clicking Polish, exactly as they would before any rewrite. Documented in `plugins/polish/README.md`.
- **[Server-side `draft` injection makes `extraVariables` semantics asymmetric across modes]** → Mitigated by always reserving `draft` (regardless of mode) so the same key never has two meanings, and by clearly documenting the rule in the spec delta.
- **[The polish prompt is the literary-quality bottleneck]** → Mitigated by treating it as user-editable copy in the repo, reviewable like any other doc.
- **[`replace: true` requires an existing last chapter]** → Surfaced as a deterministic `plugin-action:no-chapter` HTTP 400 from the lock-protected entry path; the frontend already gates the button on `visibleWhen: "last-chapter-backend"` so the server-side check is purely defensive.
- **[Concurrent generation while polishing]** → Already covered by the per-story `tryMarkGenerationActive` lock; a polish run while a chat round is streaming returns HTTP 409 `plugin-action:concurrent-generation` exactly like any other plugin action.
- **[Stripping `draft` of plugin tags discards summaries/user-message wrappers]** → By design (Decision 5). The polished output is pure prose, mirroring what the model sees in any other round; users who want a fresh summary can re-run `context-compaction` afterwards. Documented in `plugins/polish/README.md`.
- **[Editor coordination requires the editor's `isEditing`/`editBuffer` state to reach the action bar]** → Mitigated by lifting the predicate into the same composable layer that already exposes `isLoading` to plugin buttons (Decision 9). The added surface area is one boolean predicate plus a single "force-close + reload chapter N" hook — both already implied by existing edit/save flows. If the user opens the editor *during* a polish round (only possible on the WebSocket path), rule (b) tears it down on completion; the residual loss is whatever they typed in that window, which is a deliberate trade-off versus a heavyweight conflict-resolution UI.

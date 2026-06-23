## Context

`runPluginPrompt` (the `POST /api/plugins/:pluginName/run-prompt` route, surfaced to plugins via the `action-button:click` context helper) executes a plugin-owned Vento prompt through the shared LLM pipeline and persists the result according to a discriminated `WriteMode`:

- `append-to-existing-chapter` — append to the highest-numbered chapter, optionally wrapped in `<appendTag>`.
- `replace-last-chapter` — atomically overwrite the highest-numbered chapter; injects the prior content as the reserved `draft` Vento variable.
- `discard` — run the LLM, return the content, write nothing.

The flow is implemented across `writer/routes/plugin-actions.ts` (entry + lock + error translation), `plugin-actions-preflight.ts` (validation, prompt resolution, mode combo), `plugin-actions-validation.ts` (`validateModeCombo`, `validateExtraVariables`), `plugin-actions-execute.ts` (`runUnderLock`: draft injection → `buildPromptFromStory` → `streamLlmAndPersist`), and `writer/lib/chat-shared.ts` (`streamLlmAndPersist`, the `WriteMode` type, atomic chapter writers). The per-story generation lock is acquired by `tryMarkGenerationActive` (`generation-registry.ts`) and released in `finally`. Live progress streams over WebSocket via `ws-plugin-action.ts`.

No mode can place content **between** existing paragraphs. The `sd-webui-image-gen` plugin needs paragraph-anchored insertion so designed images sit next to the narrative beats they illustrate.

## Goals / Non-Goals

**Goals:**
- A generic, plugin-agnostic engine `insert` write mode that splices LLM-produced content after a chosen paragraph of the latest chapter, atomically and under the existing generation lock.
- A deterministic, shared paragraph-segmentation model so the index the LLM is shown (`numbered_paragraphs`) is the exact index `insertAfterParagraph` resolves against.
- Reuse the existing pipeline (validation → preflight → `runUnderLock` → `streamLlmAndPersist` → `post-response`) with minimal new surface area.
- First-class error reporting via RFC 9457 problem slugs, plus WS/HTTP result fields.

**Non-Goals:**
- The engine does NOT know about `<image>`, `<imgthink>`, or any plugin-specific markup. The insertion `text` payload is opaque to the engine.
- No multi-chapter insertion (only the highest-numbered chapter, matching append/replace).
- No insertion-position addressing other than "after paragraph N" (boundary/character-offset addressing is out of scope).
- No streaming-time insertion: the JSON envelope is parsed from the **fully accumulated** response, like `replace` mode.
- No migration of chapters authored under other write modes.

## Decisions

### D1: The engine owns a generic JSON insertion envelope; a plugin `insert-transform` hook may PRODUCE that envelope from a domain-specific LLM response

The `insert` write mode's canonical persistence contract is a JSON envelope of shape:

```json
{ "insertions": [ { "insertAfterParagraph": 3, "text": "<arbitrary string>" }, ... ] }
```

The engine validates the envelope shape and each entry, then splices `text` verbatim into the chapter. Anything domain-specific (e.g. `<imgthink>` + `<image>` blocks) lives **inside** `text` and is the plugin's concern. The engine never parses image semantics.

**However**, requiring the LLM to hand-author the full envelope — including JSON-escaping multi-line markup (`<imgthink>`/`<image>` with embedded newlines and quotes) inside a `text` string — is brittle: a single mis-escaped newline breaks `JSON.parse` and aborts the whole run. To keep the LLM contract simple while keeping the engine generic, the engine adds an OPTIONAL **`insert-transform` backend hook stage** dispatched inside the insert finalizer, under the per-story generation lock, BEFORE the envelope is parsed:

- The engine dispatches `insert-transform` with a context carrying the raw accumulated LLM response (`rawResponse`), the owning `pluginName`, the rendered `numberedParagraphs`, and an output slot `envelope` (initially `null`).
- A plugin's backend handler (origin-filtered: it MUST act only when `ctx.pluginName` matches its own plugin name) may parse the raw response in WHATEVER shape it instructed its LLM to emit (e.g. an array of objects with discrete `imgthink`/`title`/`positive`/`negative`/`nl` fields), assemble the canonical `{ insertions: [...] }` envelope itself (composing each `text` from those fields), and write the resulting JSON string to `ctx.envelope`.
- After dispatch, the engine reads `ctx.envelope`: if a handler set it to a string, the engine parses THAT as the canonical envelope; otherwise it falls back to parsing the raw response directly (so a plugin may still emit the envelope directly without a transform handler).

**Why this over the rejected alternatives:**
- It keeps the engine fully generic: the engine still only knows the `{ insertions: [{ insertAfterParagraph, text }] }` envelope and never image markup. The image-specific schema (imgthink/title/positive/negative/nl → `<image>` assembly) lives entirely in the consuming plugin's backend handler.
- It removes the fragile "LLM must JSON-escape multi-line markup" requirement: the LLM emits flat discrete fields; the PLUGIN (not the LLM) does the markup assembly and JSON construction deterministically in code.
- *Engine-defined image schema* is still rejected — the engine does not gain image fields; the transform hook is domain-agnostic (it only moves "raw response → canonical envelope string" responsibility to plugin code).

The hook is a SERIAL, mutating backend stage (NOT in `PARALLEL_ALLOWED`), so the handler's write to `ctx.envelope` passes through, and it runs inside the existing lock-held critical section (the finalizer already holds the per-story generation lock). The context is NOT deep-frozen (unlike `post-response`) precisely so the handler can set `envelope`.

### D2: Robust JSON extraction, but no silent repair

The LLM may wrap the JSON in a Markdown code fence or emit leading/trailing prose despite instructions. The engine SHALL:
1. `trim()` the accumulated content.
2. Strip a single surrounding ```` ```json … ``` ```` / ```` ``` … ``` ```` fence if present (one outer layer only).
3. `JSON.parse` the result.

If parsing fails, or the result is not an object with an `insertions` array of well-formed entries, the route SHALL fail with `plugin-action:invalid-insert-payload` (HTTP 422) and SHALL NOT modify the chapter. No heuristic "find the first `{`" scavenging — failures are explicit so prompt bugs surface loudly. (Zero-users constraint means we can be strict.)

### D3: Canonical paragraph model — blank-line-delimited, 1-based, shared helper

A new pure helper (e.g. `writer/lib/chapter-paragraphs.ts`) `splitChapterParagraphs(content): { index: number; text: string }[]`:
- Operates on the chapter content **after** `getStripTagPatterns()` scrub (same scrub used for `draft` and chapter history), so the LLM never sees control envelopes and the indices it targets match what it was shown.
- Splits on runs of two-or-more newlines (`/\n\s*\n+/`), trims each segment, drops empty segments, and numbers the survivors `1..N`.
- Is the SINGLE source of truth: `numbered_paragraphs` rendering and `insertAfterParagraph` resolution both call it on the same scrubbed snapshot taken **inside the lock**.

`insertAfterParagraph` semantics:
- `N` in `1..count` → insert after paragraph `N` (between paragraph `N` and `N+1`).
- `0` → insert at the very top of the chapter (before paragraph 1).
- Any value `< 0` or `> count` → reject the whole run with `plugin-action:insert-paragraph-out-of-range` (HTTP 422), atomic: no partial insert.

**Why blank-line paragraphs:** chapters are Markdown prose where paragraphs are blank-line-separated; this matches the reader's own rendering and is stable to re-segment.

**Why scrub before numbering:** if we numbered the raw file (including `<user_message>` etc.), the LLM's indices would drift from the visible prose and from what the splice resolves against. Scrubbing keeps the three views (prompt, response, splice) aligned.

### D4: Length-preserving mask so scrubbed indices map 1:1 to raw offsets

Complication: we number the **visible** content but must write into the **raw** file (which still contains stripped tags). Free-form stripping changes length and would make raw-offset mapping unsound (a stripped block containing blank lines could split a visible paragraph, or a stripped-only inter-paragraph region could shift offsets). **Decision:** instead of removing stripped spans, `splitChapterParagraphs` builds a **position-preserving masked view** — every `getStripTagPatterns()` match is replaced with whitespace of identical byte length (newlines preserved). The masked view is length-identical to the raw string, so paragraph offsets computed on the mask index the raw string directly. Segmentation runs on the mask; stripped blocks become inter-paragraph whitespace and never split a visible paragraph. The "after paragraph N" splice point is paragraph N's `end` offset, which (by construction) lands in the gap after the visible paragraph, never inside a stripped span between paragraphs.

The spliced `text` is inserted **byte-for-byte** (no trim, no internal newline normalisation); the engine only adds outer blank-line separators (collapsing only the join so no >2 consecutive newlines) so the chunk is its own Markdown paragraph. `K=0` resolves to the raw `start` of visible paragraph 1 (preserving any leading stripped content), except for a zero-paragraph chapter where it resolves to offset 0. Multiple insertions are applied descending by resolved offset; same-offset insertions are grouped and concatenated in array order (not reversed) before a single splice.

Multiple insertions are applied **descending by resolved offset** (or by `insertAfterParagraph` then stable order) so earlier splices don't shift the offsets of later ones. Two insertions targeting the same paragraph are applied in the array's given order, both after that paragraph.

### D5: Mode plumbing mirrors `replace`

- `validateModeCombo` gains an `insert` arm: `insert` is mutually exclusive with `append` and `replace`; combining `insert` with any of `append`, `replace`, or a non-`undefined` `appendTag` → `plugin-action:invalid-insert-combo` (HTTP 400). Returned mode discriminant: `"insert-into-chapter"`.
- Preflight: when mode is insert, load + scrub the highest-numbered chapter inside the lock (reusing the replace-mode load path), compute paragraphs, and inject `numbered_paragraphs` (see D6). If the story has no chapter file → `plugin-action:no-chapter` (HTTP 400), no FS touch (reuse existing slug/behaviour).
- `runUnderLock`: build `WriteMode = { kind: "insert-into-chapter", pluginName }`, run `streamLlmAndPersist`, which — for this kind — accumulates the full stream, parses the envelope (D2), resolves offsets (D3/D4), performs the atomic splice via `atomicWriteChapter` (write-temp + rename), re-reads the chapter, and dispatches `post-response` with `{ content: <full chapter after insert>, source: "plugin-action", pluginName, ... }`. `pre-write` and `response-stream` hooks are NOT dispatched (same as append/replace).
- Result envelope adds `chapterInserted: boolean` and `insertedCount: number`; `chapterUpdated`/`chapterReplaced` remain `false` for insert. (Consumers that only check `chapterUpdated` will treat insert as "chapter changed → reload" if we also set `chapterUpdated: true`; **decision:** set `chapterUpdated: true` for insert as well — it semantically updated the chapter — AND add `chapterInserted: true` for precise discrimination. This keeps existing reload logic working while letting insert-aware callers branch.)

### D6: `numbered_paragraphs` reserved variable shape

Inject two forms so prompt authors can choose:
- A reserved Vento variable `numbered_paragraphs` (string): a pre-rendered block, one paragraph per entry, formatted `「{index}」 {text}` (or similar), separated by blank lines — ready to drop into the prompt.
- The same data is the canonical numbering from D3; the rendered string is derived from it deterministically.

`numbered_paragraphs` is added to the reserved-name set (rejecting `extraVariables.numbered_paragraphs` with `plugin-action:extra-variables-collision`) and is the empty string for non-insert modes. It is provided ONLY in insert mode, symmetric with `draft` for replace mode.

### D7: Concurrency / atomicity

The entire load → number → render-prompt → stream → parse → splice → re-read → `post-response` sequence runs while the per-story generation lock is held (acquired by `tryMarkGenerationActive`, released in `finally`). The chapter snapshot is read inside the lock so the offsets used for splicing match the bytes overwritten. `atomicWriteChapter` guarantees readers see either the full pre- or full post-insert content. On abort or any error before the rename, no write occurs and `post-response` is not dispatched.

## Risks / Trade-offs

- **LLM returns malformed JSON** → `plugin-action:invalid-insert-payload` (HTTP 422); chapter untouched. Mitigation: strict but well-documented; the consuming plugin's prompt is heavily constrained and surfaces a clear toast.
- **Paragraph indices drift if the chapter changes between the prompt render and the splice** → eliminated by reading the snapshot once inside the lock and numbering + splicing against that same snapshot; the lock also blocks concurrent generation/edits.
- **Scrubbed-index ↔ raw-offset mapping bug** could splice into the wrong place or inside a stripped tag → Mitigation: `splitChapterParagraphs` returns raw offsets directly (no re-derivation), covered by unit tests including chapters containing stripped tags, leading/trailing blank lines, and CRLF.
- **`chapterUpdated: true` for insert** may surprise insert-unaware callers expecting "append/replace only" → acceptable; the field already means "the chapter file changed", and insert-aware callers use `chapterInserted`.
- **Out-of-range index aborts the whole batch** (no partial apply) → chosen for atomicity/predictability over best-effort; an all-or-nothing insert is easier to reason about and retry.
- **Very large `insertions` arrays / huge `text`** → bounded by the existing LLM response size and the chat pipeline's limits; no new unbounded surface. A sane upper bound on `insertions.length` MAY be added in tasks.

## Migration Plan

No data migration (pre-release, zero users). Deploy is additive: existing append/replace/discard behaviour is unchanged. Rollback = revert the route/lib/frontend edits; no persisted schema changes. The consuming plugin change (`design-image-paragraph-insertion`) must be deployed **after** this engine change, since it depends on `insert: true`, `numbered_paragraphs`, and the envelope contract.

## Open Questions

- Should the rendered `numbered_paragraphs` string include a trailing per-paragraph marker (e.g. `「N→」`) to make the "insert AFTER" semantics visually obvious to the LLM? (Lean yes; finalize in the consuming plugin's prompt rather than hard-coding engine formatting.)
- Cap on `insertions.length`? (Proposed: soft cap, reject absurd counts with `plugin-action:invalid-insert-payload`; exact number deferred to tasks.)

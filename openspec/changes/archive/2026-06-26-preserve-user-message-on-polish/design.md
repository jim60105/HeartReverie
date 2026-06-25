## Context

The **✨ 潤飾** action button (the `polish` built-in plugin) runs the run-prompt route in `replace-last-chapter` mode. The current pipeline:

1. `writer/routes/plugin-actions-execute.ts` (`runUnderLock`) reads the highest-numbered chapter as `rawDraft`, applies `pluginManager.getStripTagPatterns()` to produce `cleanDraft`, and binds it to the Vento variable `draft`. The strip pass deliberately removes prompt envelopes — including `<user_message>` (declared by the `user-message` plugin's `promptStripTags`) — so the LLM never sees them.
2. The LLM rewrites only the prose (the `draft`) and returns tagless content.
3. `writer/lib/chat-chapter-finalize.ts` (`finalizeReplaceLastChapter`) atomically overwrites the **entire** chapter file with `aiContent.trimEnd() + "\n"` via `atomicWriteChapter`.

Because `replace` mode never dispatches the `pre-write` hook (that hook, in `chat-chapter-io.ts`, is the ONLY writer of `<user_message>` and only runs for `write-new-chapter`), nothing re-emits the block. Net effect: the player's `<user_message>` — the durable record of what they typed to open the chapter — is permanently deleted from disk on every polish run.

Normal chat, by contrast, writes `<user_message>` at the top of a freshly created chapter via the `pre-write` hook fed by the real user message (`chat-chapter-io.ts:127-149` → `user-message/handler.ts:35`). The block is conventionally the leading content of the chapter file: `<user_message>\n{msg}\n</user_message>\n\n{prose}`.

Constraints:
- Pre-release project, zero users — no migration/back-compat concerns.
- The fix must not feed `<user_message>` bytes to the LLM (the whole point of stripping is to keep prompt envelopes out of the rewrite input).
- Replace mode's atomicity / abort safety (original file byte-for-byte preserved on abort/error) must be retained.
- Scope is limited (per the chosen approach) to the `<user_message>` envelope, NOT all `promptStripTags` envelopes.

## Goals / Non-Goals

**Goals:**
- EVERY `replace: true` run — for ANY plugin, not only `polish` — preserves a leading `<user_message>…</user_message>` block byte-for-byte, re-prepending it ahead of the rewritten prose. Preservation is a property of `replace-last-chapter` mode itself.
- The LLM still never receives the `<user_message>` bytes (it stays out of `draft`).
- Chapters without a leading `<user_message>` block are written exactly as today (no behavioural drift).
- The fix lives entirely in the backend run-prompt pipeline, so any plugin using `replace` mode benefits automatically — no change to the `polish` plugin's frontend, manifest, or prompt template.
- Abort/error paths still leave the original chapter untouched.

**Non-Goals:**
- Preserving other `promptStripTags` envelopes (e.g. `<chapter_summary>`, state/status tags) — explicitly out of scope; they remain stripped and are NOT re-prepended.
- Preserving a `<user_message>` block that is not at the leading position of the chapter (treated as ordinary stripped content).
- Re-dispatching the `pre-write` hook in replace mode (would change hook semantics broadly and re-wrap from `message`, which is empty for plugin actions — wrong source of truth).
- Any change to append/insert/discard modes or to the normal chat path.

## Decisions

### Decision 1: Capture-and-re-prepend an opaque preserved prefix (chosen)

Capture the leading `<user_message>…</user_message>` block (plus its trailing whitespace separator) from `rawDraft` BEFORE the strip pass, carry it through the `WriteMode` as `preservedPrefix`, and in `finalizeReplaceLastChapter` prepend it ahead of the trimmed LLM output before `atomicWriteChapter`.

Rationale:
- The capture happens at the exact spot the raw chapter is already read under the lock (`runUnderLock`'s `replace-last-chapter` branch), so no extra disk read and no TOCTOU window — the captured bytes match the bytes the finaliser overwrites.
- Treating the prefix as opaque bytes (no re-parse, no re-wrap from `message`) means the player's exact text — including any internal newlines or characters — round-trips losslessly.
- The LLM input (`draft`) is unaffected: the same `getStripTagPatterns()` scrub still removes `<user_message>` from what the model sees.

Alternatives considered:
- **Re-dispatch `pre-write` in replace mode** — rejected: `pre-write`'s `message` is the empty string for plugin actions (the prompt is the user's intent), so the hook would emit nothing; and re-wrapping from `message` would lose the *original* text. It would also broaden hook semantics for a narrow bug.
- **Stop stripping `<user_message>` from `draft`** (feed full chapter, rely on prompt to preserve tags) — rejected by the chosen scope and risky: the LLM could rewrite, move, or drop the tag, and the polish prompt is literary-rewrite-oriented.
- **Generic: preserve ALL `promptStripTags` envelopes** — rejected per the explicit scope decision (preserve only `<user_message>`). A generic preserved-segments mechanism is more invasive (ordering, interleaving, which segments are "metadata" vs "content") and not needed for the reported bug.

### Decision 2: Anchor the capture to the chapter's leading position

Capture only a `<user_message>` block anchored at the start of the chapter, matching where the `pre-write` hook writes it. The regex is `^<user_message\b[^>]*>[\s\S]*?<\/user_message>(?:\r?\n){0,2}` — anchored at byte 0 (NO leading `^\s*`), case-sensitive, non-greedy body, and a **bounded** trailing-separator capture of at most two line breaks (exactly the `\n\n` the `user-message` hook emits, tolerant of a single `\n` or CRLF). The captured substring (block + that separator) is exactly what gets re-prepended.

Rationale:
- **Why byte-0 anchor (no `^\s*`):** The `pre-write` hook writes `<user_message>` as the very first bytes of a `write-new-chapter` file (`chat-chapter-io.ts` writes `preContent` before anything else). Anchoring at byte 0 means we only ever preserve the engine's own leading envelope and never accidentally absorb pre-tag whitespace/BOM into the prefix.
- **Why bounded trailing capture (`(?:\r?\n){0,2}`) instead of `\s*`:** A greedy `\s*` would swallow blank lines / indentation that legitimately belong to the prose body, silently moving that whitespace out of the LLM-controlled region. Bounding to ≤2 line breaks captures precisely the separator the hook emits and leaves any further leading whitespace of the prose under the rewrite. With `aiContent.trimEnd()` (no `trimStart`) the prose's own leading whitespace is otherwise the model's responsibility; we deliberately do not reintroduce it from the original draft.
- **Why hard-code the `user_message` tag name** (rather than deriving from `promptStripTags`): consistent with the narrow scope and the fact that `<user_message>` is the engine's own envelope, owned by a built-in plugin that emits lowercase tags. Capture is case-sensitive to match the engine's emitted casing; this is intentionally asymmetric with the `gi` strip regex (a hand-edited uppercase `<USER_MESSAGE>` is still stripped from `draft` but is NOT preserved — see Risks).

**Leading-position invariant (current plugin set):** The ONLY plugin that registers a `pre-write` hook / writes `preContent` is the built-in `user-message` plugin (verified across `plugins/`); no built-in plugin (incl. `context-compaction`) prepends content above `<user_message>`. Therefore, for the shipped plugin set, `<user_message>` is always the leading block. A third-party `PLUGIN_DIR` plugin could in principle register an earlier-priority `pre-write` that prepends bytes ahead of `<user_message>`; in that (unsupported, out-of-scope) configuration the leading anchor would not match and the block would still be lost on polish. This is an explicit, documented limitation of the narrow scope (see Risks), not a regression of current behaviour.

### Decision 3: Carry the prefix on the `WriteMode`, prepend in the finaliser

Add a **required** `preservedPrefix: string` to the `replace-last-chapter` `WriteMode` variant in `writer/lib/chat-types.ts` (always set — `""` when no block found — to avoid two representations of "nothing to preserve"). `runUnderLock` sets it. `finalizeReplaceLastChapter` computes `newContent = preservedPrefix + aiContent.trimEnd() + "\n"` instead of `aiContent.trimEnd() + "\n"`.

The extraction logic lives in a small, separately unit-tested helper in a shared lib module (e.g. `writer/lib/user-message-prefix.ts` exporting `extractLeadingUserMessage(raw: string): string`), not inline in the route, so it gets direct coverage and is reusable.

Rationale:
- The `WriteMode` discriminated union is already the channel for replace-mode metadata (`pluginName`), so this is the natural carrier and keeps `streamLlmAndPersist`'s signature unchanged.
- The prefix already ends in the `\n\n` separator emitted by `pre-write`, so concatenation needs no extra glue; the existing single trailing `"\n"` after the prose is preserved. (The trimmed prose makes the result deterministic regardless of trailing whitespace in the model output.)

**Empty / whitespace-only model output:** when `aiContent.trimEnd()` is empty and a prefix is present, the written file is `preservedPrefix + "\n"` (i.e. `<user_message>…</user_message>\n\n\n` — the two-break separator plus the finaliser's single trailing newline). This degenerate case is specified and tested rather than left implicit; it preserves the user's message even when the model returns nothing, which is the desired safety property.

**Newline format:** the preserved prefix is written verbatim, so a CRLF-authored chapter keeps CRLF in the prefix while the finaliser appends LF for the body's trailing newline (unchanged from today's `+ "\n"`). The engine itself only ever writes LF, so this only surfaces for hand-edited/imported CRLF chapters; mixed endings in that edge case are accepted (documented in Risks) rather than force-normalised, to keep the prefix byte-for-byte.

## Risks / Trade-offs

- **[A non-leading `<user_message>` is silently dropped]** → Acceptable and specified: only the engine-written leading block is preserved; mid-body occurrences are ordinary content and remain stripped, matching the narrow scope. Documented as an explicit scenario.
- **[A third-party `pre-write` plugin prepends content above `<user_message>`]** → Then `<user_message>` is no longer the byte-0 leading block, the anchor does not match, and the message is still lost on polish. For the shipped built-in plugin set this cannot happen (only `user-message` registers `pre-write`). Treated as a documented limitation of the narrow scope, NOT addressed here. Mitigation if it ever matters: widen the anchor to an engine-defined prefix-metadata zone, or move to a generic preserved-segments mechanism. A test exercising "another `pre-write` prefix contributor" pins the current (lost) behaviour so the limitation is explicit rather than surprising.
- **[Malformed/partial `<user_message>` in the chapter (e.g. missing close tag)]** → The anchored regex requires a matching `</user_message>`; an unterminated block does not match, so the preserved prefix is empty and the run behaves like the no-block case (the partial tag is stripped/lost just as today). No crash, no partial-prefix write. This is a known limitation: a corrupted/hand-edited unterminated block still loses the message — documented and tested, not silently assumed fixed.
- **[Trailing-whitespace over-capture]** → Mitigated by bounding the trailing separator to `(?:\r?\n){0,2}` (≤2 line breaks) instead of `\s*`, so blank lines / indentation that belong to the prose body are NOT pulled into the prefix.
- **[Case mismatch with strip regex]** → Capture is case-sensitive (engine emits lowercase) while `getStripTagPatterns()` is `gi`. A hand-edited uppercase `<USER_MESSAGE>` is therefore stripped from `draft` but NOT preserved. Intentional, documented; covered by a negative test.
- **[CRLF chapters produce mixed line endings]** → Accepted edge case for hand-edited/imported chapters (engine always writes LF). Prefix is preserved verbatim to keep byte-for-byte fidelity; the body's trailing newline stays LF. Covered by a test that documents the resulting bytes.
- **[Other prompt envelopes still lost on polish]** → Out of scope by decision; only `<user_message>` is reported as user-facing data loss. If future demand arises, a generic preserved-segments mechanism can supersede this.
- **[Double-stripping concern]** → The preserved prefix is captured BEFORE the strip pass and never fed back through `getStripTagPatterns()`, so it is not re-stripped on write. The finaliser writes it verbatim. Capture also does not depend on `getStripTagPatterns()` returning a non-null regex — it runs on `rawDraft` directly — so a plugin-light deployment (no `promptStripTags`) still captures correctly; covered by a test.
- **[Model emits its own `<user_message>` block → duplicate blocks]** → The LLM never sees `<user_message>` (stripped from `draft`) so it should not emit one, but a misbehaving prompt/model could. Mitigated by a de-duplication guard in `finalizeReplaceLastChapter`: when a non-empty `preservedPrefix` is being re-prepended and the trimmed model output ITSELF begins with a leading `<user_message>` block (same anchored capture), the model's emitted block is dropped before prepending, so the chapter never contains two leading blocks. When `preservedPrefix` is empty, a model-emitted leading block is left untouched (matches the no-block-unchanged behaviour). Covered by a test.
- **[Abort/error safety]** → Unchanged: the prefix is computed in memory before streaming; `finalizeReplaceLastChapter` (and thus `atomicWriteChapter`) only runs on successful completion, so aborts/errors still leave the original file byte-for-byte intact.

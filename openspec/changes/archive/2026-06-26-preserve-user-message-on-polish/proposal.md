## Why

Any `replace-last-chapter` run silently destroys the reader's own words. The reported trigger is the **✨ 潤飾** action button, but the data loss is a property of `replace` mode itself — it (1) scrubs every `promptStripTags` envelope — including the `<user_message>` block that records what the player typed to open the chapter — out of the draft before the LLM sees it, then (2) atomically overwrites the *entire* chapter file with the LLM's tagless rewrite. Because `replace` mode never dispatches the `pre-write` hook, nothing re-emits the `<user_message>` block, so the player's original message is permanently lost from disk. This is data loss of user-authored content, not a cosmetic regression, and it affects EVERY plugin that uses replace mode, not only `polish`.

## What Changes

- For EVERY `replace-last-chapter` run (any plugin, not only `polish`), the run-prompt route SHALL capture the **leading `<user_message>…</user_message>` block** (the canonical position written by the `user-message` plugin's `pre-write` hook) from the on-disk chapter *before* it strips envelopes for the `draft` variable. Preservation is implemented once in the shared replace-mode pipeline, so it applies uniformly to all current and future replace-mode plugins.
- When the replace finalisation atomically rewrites the chapter, the captured `<user_message>` block SHALL be re-prepended verbatim (block + the original separator) ahead of the LLM's rewritten prose, so the player's message survives a replace round byte-for-byte.
- When the original chapter has no leading `<user_message>` block, behaviour is unchanged: the rewritten prose is written exactly as today.
- The captured block is preserved as opaque bytes; it is NOT shown to the LLM (it stays stripped out of `draft`) and is NOT re-stripped or re-wrapped on write.
- Scope is deliberately limited to the `<user_message>` envelope (the reported, user-facing data-loss case). Other `promptStripTags` envelopes (e.g. state/status tags) remain out of scope for this change.

No backward-compatibility or migration handling is in scope — the project is pre-release with zero users.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities

- `plugin-action-buttons`: Extend the **Plugin run-prompt backend route** requirement so that `replace-last-chapter` mode preserves a leading `<user_message>` block across the rewrite. The route already loads the last chapter and strips envelopes to build `draft`; this adds a requirement to capture the leading `<user_message>` block at that point and re-prepend it when atomically writing the replacement, plus the `post-response` `content` and the returned `content` SHALL reflect the re-prepended block.

## Impact

- **Backend (`writer/`)**:
  - `writer/lib/user-message-prefix.ts` (new) — `extractLeadingUserMessage(raw)` helper (anchored, bounded-separator regex), separately unit-tested.
  - `writer/routes/plugin-actions-execute.ts` — in the `replace-last-chapter` branch, call the helper on `rawDraft` and carry the result on the `WriteMode` (alongside the existing replace metadata) so the finaliser can re-prepend it.
  - `writer/lib/chat-types.ts` — add a required `preservedPrefix: string` field to the `replace-last-chapter` `WriteMode` variant (`""` when no block).
  - `writer/lib/chat-chapter-finalize.ts` — `finalizeReplaceLastChapter` prepends the carried prefix before `atomicWriteChapter`.
- **No frontend, manifest, or prompt-template change**: the polish plugin's `frontend.js`, `plugin.json`, and `polish-instruction.md` are untouched; the fix lives entirely in the backend run-prompt pipeline, so any `replace`-mode plugin run preserves a leading engine-written `<user_message>` block (not just polish). The guarantee is scoped to a `<user_message>` block at the chapter's leading position; see `design.md` for the leading-position invariant and its limitations.
- **Tests**: backend route/lib tests asserting (a) a chapter with a leading `<user_message>` block retains it byte-for-byte after a replace run, (b) the LLM never receives the `<user_message>` bytes in `draft`, (c) a chapter without the block is written exactly as the trimmed rewrite, and (d) `post-response.content` / the run-prompt response `content` include the re-prepended block.

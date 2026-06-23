## Why

The `runPluginPrompt` engine surface only supports three write modes — `append-to-existing-chapter` (end of chapter), `replace-last-chapter` (whole chapter), and `discard` (no write). None can place plugin-generated content **between** existing paragraphs of a chapter. The `sd-webui-image-gen` plugin's "設計新圖片" button wants to insert image blocks at the precise narrative beats they illustrate, rather than dumping them all at the chapter tail. To do that, a plugin needs (a) a way to ground the LLM in a paragraph-addressable view of the latest chapter and (b) an atomic, lock-safe engine mechanism to splice content in after a chosen paragraph. This change adds both as generic engine capabilities so any future plugin can build paragraph-anchored insertions.

## What Changes

- Add a fourth `runPluginPrompt` write mode: **`insert: true`** (`{ kind: "insert-into-chapter" }`), mutually exclusive with `append`/`replace`. In this mode the engine resolves the **insertion envelope** of the shape `{ "insertions": [ { "insertAfterParagraph": <int>, "text": <string> } ... ] }`, validates it, and atomically splices each `text` into the highest-numbered chapter file after the addressed paragraph — all under the per-story generation lock.
- Add an OPTIONAL **`insert-transform` backend hook stage** dispatched inside the insert finalizer (under the lock, before envelope parsing). It carries the raw accumulated LLM response, the owning `pluginName`, and the rendered `numberedParagraphs`, plus a mutable `envelope` output slot. A plugin's origin-filtered backend handler may parse a domain-specific LLM response shape and assemble the canonical envelope string itself, writing it to `ctx.envelope`. When no handler sets `envelope`, the engine parses the raw response directly as the canonical envelope (so direct-envelope plugins still work). This keeps the engine generic while letting the LLM emit a simple flat schema and the plugin do the markup/JSON assembly deterministically in code.
- Add a reserved Vento variable **`numbered_paragraphs`** available to plugin-action prompt rendering: the engine splits the highest-numbered chapter's stripped content into paragraphs (blank-line-delimited), assigns each a 1-based sequence number, and exposes both a rendered text block and a structured list so prompts can show the LLM exactly which paragraph index to target. Provided only for `insert` mode (empty otherwise), analogous to how `draft` is provided only for `replace` mode.
- Define the **paragraph model** (how chapter text is segmented and numbered) as the single source of truth shared by `numbered_paragraphs` rendering and `insertAfterParagraph` resolution, so the index the LLM sees maps deterministically to the splice point.
- Add validation + RFC 9457 problem slugs for the new mode: `plugin-action:invalid-insert-combo` (insert combined with append/replace/appendTag), `plugin-action:no-chapter` reuse (insert against a chapterless story), `plugin-action:invalid-insert-payload` (response is not the expected JSON envelope), and `plugin-action:insert-paragraph-out-of-range` (an `insertAfterParagraph` outside `0..N`).
- Extend the WebSocket / HTTP result envelope with a `chapterInserted` boolean and an `insertedCount` integer; dispatch `post-response` after a successful insert with the full post-insert chapter content (`source: "plugin-action"`).
- Extend the frontend `runPluginPrompt` helper and `usePluginActions` to accept and forward `insert: true` and to surface `chapterInserted` / the new problem slugs.

This is **not** backward-compatibility-constrained (project is pre-release, zero external users).

## Capabilities

### New Capabilities
- `chapter-paragraph-insertion`: The engine-level `insert` write mode for `runPluginPrompt` — JSON insertion-envelope contract, the optional `insert-transform` backend hook that lets a plugin produce that envelope from a domain-specific LLM response, atomic lock-held mid-chapter splice, `post-response` dispatch, result envelope fields, and error slugs.
- `numbered-paragraph-variable`: The reserved `numbered_paragraphs` Vento variable and the canonical chapter-paragraph segmentation/numbering model shared with `insertAfterParagraph` resolution.

### Modified Capabilities
- `plugin-action-buttons`: Adds the `insert` request flag, its mutual-exclusion rules with `append`/`replace`, the new write-mode dispatch branch, the `numbered_paragraphs` reserved-variable injection, the new result fields, and the frontend `runPluginPrompt` helper option.

## Impact

- **Backend**: `writer/routes/plugin-actions*.ts` (validation, preflight, execute), `writer/lib/chat-shared.ts` (`WriteMode` discriminator + persist branch), `writer/lib/story-chapter-io.ts` / a new paragraph-segmentation helper, `writer/routes/ws-plugin-action.ts` (envelope), `writer/lib/errors.ts` (problem slugs), `writer/types.ts` (response + WS types).
- **Frontend**: `reader-src/src/composables/usePluginActions.ts` and the `runPluginPrompt` helper in `useChatApi.ts` (or `lib/api.ts`).
- **Generation lock**: reuses the existing `tryMarkGenerationActive` / `generation-registry` path — insert acquires and releases the per-story lock exactly like append/replace.
- **Docs**: `docs/plugin-system.md` action-button section gains the insert mode.
- **Consumers**: `HeartReverie_Plugins/sd-webui-image-gen` (separate change) is the first consumer.

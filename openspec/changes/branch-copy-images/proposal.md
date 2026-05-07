## Why

When clicking "從此分支" (branch from here), the system copies chapters, state files, lore, and usage records to a new story — but omits `_config.json` (LLM settings) and the `_images/` directory (metadata + image files). Branched stories lose their LLM configuration and all generated images, breaking visual continuity and requiring manual reconfiguration.

## What Changes

- Copy `_config.json` to the branched story (best-effort, NotFound-safe).
- Copy and filter `_images/_metadata.json` to include only entries with `chapter ≤ fromChapter`.
- Copy image files whose filename-prefix chapter number is `≤ fromChapter`.
- Create `_images/` directory in the destination only when at least one image or metadata entry qualifies.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `chapter-editing`: The "Branch a story at a chosen chapter" requirement gains additional copied artifacts (`_config.json`, filtered image metadata, and image files for chapters ≤ fromChapter).

## Impact

- **Code**: `writer/routes/branch.ts` — new copy logic appended to existing branch handler.
- **APIs**: No new endpoints; existing `POST /api/stories/:series/:name/branch` response unchanged.
- **Dependencies**: None — uses only Deno FS APIs already imported.
- **Risk**: Low — all new operations are best-effort with NotFound suppression; failures log warnings but do not fail the branch.

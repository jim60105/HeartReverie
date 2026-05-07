## Context

The branch handler in `writer/routes/branch.ts` (lines ~147-183) copies chapter `.md` files, state YAML files, the `_lore/` directory, and filtered usage records. It does not yet copy the per-story LLM config (`_config.json`) or the `_images/` directory, which stores generated image files and a `_metadata.json` manifest. Image filenames follow the pattern `{chapter:03d}-{index:03d}.{ext}` and metadata entries carry a `chapter` field for filtering.

## Goals / Non-Goals

**Goals:**
- Preserve image data and LLM config when branching, so branched stories retain visual and configuration continuity.
- Filter images and metadata to only include chapters ≤ `fromChapter` with a terminal status (`ready` or `failed`), matching the existing filtering behavior of usage records.
- Keep all new operations best-effort (NotFound-safe) so missing images never fail the branch.

**Non-Goals:**
- Symlink or deduplicate images across branches (copies are acceptable for correctness and simplicity).
- Modify the branch API response shape or add new endpoints.
- Handle plugin-specific image state beyond `_metadata.json` (plugins own their own state files).

## Decisions

1. **Append after existing copy logic, before cleanup.** New code runs after `copyUsage()` and before the success response. This preserves the existing rollback guarantee (best-effort `Deno.remove` of destDir on failure).

2. **Best-effort with NotFound suppression.** Each new copy block uses `try/catch`; `Deno.errors.NotFound` is silently ignored (images/config may not exist). Other errors are logged at `warn` level with the `[branch]` tag matching existing log patterns.

3. **Filter metadata in memory, write once.** Read `_metadata.json`, filter entries by `entry.chapter <= fromChapter && entry.status !== "generating"`, write the filtered result. Entries with `status: "generating"` are excluded because no generation worker will exist in the branched story — copying them would leave permanent stuck spinners in the UI. Only `ready` and `failed` entries are preserved.

4. **Copy image files by metadata reference, not directory scan.** Rather than scanning `_images/` and parsing filenames, use the `filename` field from each filtered metadata entry to determine which image files to copy. This is both safer (no filename-parsing ambiguity) and consistent (only files with metadata are copied). Files that don't exist on disk are silently skipped (best-effort).

5. **Single rule for `_images/` creation.** Create `_images/` in the destination if and only if at least one metadata entry is written OR at least one image file is successfully copied. Never create an empty `_images/` directory.

6. **Single `Deno.mkdir` with `recursive: true`** for `_images/` ensures idempotent directory creation when either metadata or files need to be written.

7. **Copy `_config.json` as a simple file copy.** No filtering needed — the config is story-wide.

8. **Safe snapshot semantics without generation guard.** The branch handler does NOT consult `generationRegistry` (branching is a read-only copy operation that doesn't conflict with generation). Instead, safety is achieved by: (a) excluding `status: "generating"` metadata entries, and (b) copying only files referenced by filtered metadata entries — so in-flight generation artifacts are naturally excluded.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Large image directories may slow branching | Acceptable — branch is a rare user action; file copies are sequential but IO-bound, not CPU-bound |
| Metadata format change in plugins | We read the well-known `images` array with `chapter`/`status`/`filename` fields; any structural change would break serving too, so it's safe to depend on |
| Concurrent image generation during branch | No generation guard is needed; `status: "generating"` entries are excluded from the copy, so in-progress artifacts never appear in the branch |
| Image file missing despite metadata entry | Best-effort copy; if a `ready` entry's file is missing on disk, skip silently — the branch UI will show a broken image same as the source would |

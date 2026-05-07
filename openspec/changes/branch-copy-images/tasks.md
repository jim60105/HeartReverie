## 1. Copy `_config.json` on branch

- [x] 1.1 In `writer/routes/branch.ts`, after the existing `copyUsage()` call, add a best-effort `Deno.copyFile` for `_config.json` from source to destination. Suppress `Deno.errors.NotFound`; log other errors at warn level with the `[branch]` tag.

## 2. Copy and filter image metadata on branch

- [x] 2.1 In `writer/routes/branch.ts`, read `_images/_metadata.json` from the source directory, parse it, and filter the `images` array to entries where `entry.chapter <= fromChapter && entry.status !== "generating"`. Only `ready` and `failed` entries are preserved; `generating` entries are excluded because no generation worker exists in the branch.
- [x] 2.2 If at least one entry passes the filter, create `_images/` in the destination with `Deno.mkdir(..., { recursive: true })` and write the filtered JSON to `_images/_metadata.json`.
- [x] 2.3 Wrap in try/catch: suppress `Deno.errors.NotFound`, warn-log other errors.

## 3. Copy image files referenced by filtered metadata

- [x] 3.1 For each entry in the filtered metadata (from step 2), use `entry.filename` to copy the corresponding file from `srcDir/_images/` to `destDir/_images/`. This avoids directory scanning and filename-parsing ambiguity.
- [x] 3.2 Before copying, ensure `_images/` directory exists (idempotent `Deno.mkdir` with `recursive: true`).
- [x] 3.3 Wrap each file copy in try/catch: suppress `Deno.errors.NotFound` (file may not exist on disk despite metadata), warn-log other errors.
- [x] 3.4 Rule: create `_images/` if and only if at least one metadata entry is written OR at least one image file is successfully copied. Never create an empty `_images/` directory.

## 4. Verification

- [x] 4.1 Run existing backend tests (`deno task test:back`) to confirm no regressions.
- [x] 4.2 Run container build (`docker build`) to verify no import or compilation errors.

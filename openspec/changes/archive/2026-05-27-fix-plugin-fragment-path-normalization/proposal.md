## Why

In the template editor (`/settings/template-editor`), clicking any plugin promptFragment leaf — e.g. `./chapter-summary-instruction.md`, `./T-task.md`, `./create_image.md` — surfaces the toast **「載入模板失敗：Plugin path contains dotfile segment」** and fails to load. All **11 plugin fragments are currently un-viewable in the editor — 9 from `HeartReverie_Plugins` plus 2 built-in fragments under `HeartReverie/plugins/` (`context-compaction`, `start-hints`)**.

The root cause is in `writer/routes/templates-path.ts:204`: the resolver splits the plugin-relative path on `/` and rejects any segment starting with `.`. Plugin manifests legitimately reference fragments as `"./T-task.md"` (the `./` prefix is documented in `docs/plugin-system.md:167, 1324, 1351` and `docs/prompt-template.md:188`), so the leading `.` segment — the Node-style current-directory marker, **not** a dotfile — triggers a false-positive rejection. The sibling validator `writer/lib/plugin-validators-frontend-imports.ts:58-65` already normalizes leading `./` and then runs the dotfile-segment check; `plugin-validators-frontend-styles.ts` performs the same leading-`./` normalization pattern (though without a dotfile-segment check). The template-path resolver was not aligned with that pattern.

## What Changes

- Normalize `parsed.relativeFile` by stripping any leading `./` segments before the dotfile-segment check inside the `plugin-fragment` branch of `resolveTemplatePath()`, mirroring the dotfile-segment-check prior art in `plugin-validators-frontend-imports.ts:58-65` (and the leading-`./` normalization pattern shared with `plugin-validators-frontend-styles.ts`).
- After normalization, if the resulting path is **empty** (e.g. the input was `./` or `././`), reject with HTTP `400` and `detail: "Plugin path is empty"` before any further checks, so that `resolve(dir, "")` cannot fall through to a directory read.
- Tighten the `..` parent-traversal check to a segment-equals comparison (`s === ".."`) instead of substring `includes("..")`, again matching the frontend-imports/styles validators (substring rejects legitimate file names like `foo..bar.md`, an edge case but worth consistency).
- True dotfiles (`.env`, `.git`, `.hidden`) and parent-directory traversal (`..` segments) continue to be rejected, as do the existing forbidden script-y extensions (`.js`, `.mjs`, `.cjs`, `.html`, `.htm`, `.svg`).
- Add backend route tests covering the accepted and rejected cases.

**Out of scope** — no change is proposed in `HeartReverie_Plugins`: plugin manifests already use the documented `./snippet.md` convention correctly; the bug is entirely on the engine side.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `template-editor`: clarify that the plugin-fragment resolver MUST normalize leading `./` segments before applying the dotfile-segment rejection, and that `..` rejection is a segment-equals check.

## Impact

- **Code**: `writer/routes/templates-path.ts` (`resolveTemplatePath()` plugin-fragment branch).
- **Tests**: `tests/writer/routes/templates-coverage.test.ts` (existing plugin-fragment cases live at ~lines 218–286) and `tests/writer/routes/templates_test.ts` — new scenarios for `./foo.md`, `./sub/bar.md`, `./`, `././`, `.\\foo.md`, `sub/./foo.md`, `.env`, `sub/.env`, `foo/.git/bar.md`, `..`, `../escape.md`, `foo/../bar.md`.
- **APIs**: `GET /api/templates/source` for `plugin:<name>:./<rel>` paths starts returning `200` with the fragment source instead of `400`. No request/response shape change.
- **UI**: Plugin Fragments leaves in the template editor become viewable (read-only, as before).
- **Plugins repo**: no change required.
- **Security**: rejection surface for true dotfiles, forbidden extensions, and parent traversal is preserved; the change strictly removes a false-positive without weakening defense-in-depth.

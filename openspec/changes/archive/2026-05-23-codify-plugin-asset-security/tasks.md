# Implementation Tasks

> **Status:** All implementation tasks completed in engine commit `6f765c0` and plugin commit `7ec0fb3` before this proposal was authored. Boxes are pre-checked to reflect the as-shipped state; this proposal serves as retroactive codification of the security model.

## 1. Manifest schema

- [x] 1.1 Add `frontendImports?: readonly string[]` to `PluginManifest` in `writer/types/plugin.ts`
- [x] 1.2 Add `validatedImports: readonly string[]` to the in-memory `PluginEntry` shape in `writer/lib/plugin-loader.ts`

## 2. Manifest import validator

- [x] 2.1 Create `writer/lib/plugin-validators-frontend-imports.ts` exporting `validateFrontendImports(manifest, pluginDir): readonly string[]`
- [x] 2.2 Implement syntactic checks (non-empty string, `.js` suffix, not absolute, no `..`, no `\` / `#` / `?` / `%`, no dotfile segment) returning typed reject codes
- [x] 2.3 Implement disk checks (`isFile`, symlink-safe containment via `Deno.realPath` + `isPathContained`)
- [x] 2.4 Deduplicate by resolved absolute path; normalise to forward-slash, no leading `./`
- [x] 2.5 Re-export from `writer/lib/plugin-validators.ts`
- [x] 2.6 Wire into `scanDir` so each loaded plugin's `validatedImports` is populated before route registration

## 3. PluginManager allowlist API

- [x] 3.1 Add `getPluginAllowedJsFiles(name: string): Set<string>` to `PluginManager` returning the normalized union of `frontendModule` + `validatedImports`
- [x] 3.2 Return empty `Set` for unknown plugin names

## 4. Wildcard `.js` route hardening

- [x] 4.1 In `writer/routes/plugins.ts`, replace directory-scan logic with allowlist consultation via `getPluginAllowedJsFiles`
- [x] 4.2 Reject any request path containing literal `\` outright, before normalization
- [x] 4.3 Compute `normReq` from `reqPath` (strip leading `./`) and pass `normReq` (not raw `reqPath`) into `resolve(pluginDir, ...)`
- [x] 4.4 Preserve dotfile-segment rejection, plugin-directory containment check, and `Deno.realPath`-based symlink containment as defense-in-depth after the allowlist gate

## 5. Templates path hardening

- [x] 5.1 In `writer/routes/templates-path.ts` `parseTemplatePath`, enforce `.md`-only on lore paths
- [x] 5.2 Reject lore paths containing empty segments or dotfile segments at any depth
- [x] 5.3 In `resolveTemplatePath`, reject plugin-fragment paths with `.js`/`.mjs`/`.cjs`/`.html`/`.htm`/`.svg` extension or dotfile segment

## 6. Image response hardening

- [x] 6.1 In `writer/routes/images.ts`, add `X-Content-Type-Options: nosniff` to every successful image response (200 path)

## 7. Tests

- [x] 7.1 Add `tests/writer/lib/plugin-validators-frontend-imports_test.ts` with at least 15 cases covering each reject code, dedup, symlink escape, dotfiles, special chars, directories, and happy path
- [x] 7.2 Update `tests/writer/routes/plugins_test.ts` sibling-import sub-step to use the new `frontendImports` manifest field and mock `getPluginAllowedJsFiles`
- [x] 7.3 Add a regression sub-step verifying that an undeclared `.js` file physically present in the plugin directory returns `404`
- [x] 7.4 Update all `PluginManager` route-test mocks to stub `getPluginAllowedJsFiles` returning either an empty `Set` or the appropriate allowlist
- [x] 7.5 Run `cd HeartReverie && deno task test:backend` — expect green (419 passed)

## 8. Verification

- [x] 8.1 Run container integration via `HeartReverie/scripts/podman-build-run.sh`
- [x] 8.2 Confirm `GET /plugins/sd-webui-image-gen/frontend.js` → `200`
- [x] 8.3 Confirm `GET /plugins/sd-webui-image-gen/frontend-lightbox.js` → `200`
- [x] 8.4 Confirm `GET /plugins/sd-webui-image-gen/nonexistent.js` → `404`
- [x] 8.5 Confirm `GET /api/templates/source?templatePath=lore:global:foo.ts` → `400`
- [x] 8.6 Confirm an image response carries `X-Content-Type-Options: nosniff`

## 9. Documentation follow-up (after archive)

- [x] 9.1 Update `heartreverie-create-plugin` SKILL.md to document the `frontendImports` manifest field
- [ ] 9.2 Sync deltas into `openspec/specs/` via `openspec archive`

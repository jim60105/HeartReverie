## 1. Implement resolver fix

- [ ] 1.1 In `writer/routes/templates-path.ts`, inside the `plugin-fragment` branch of `resolveTemplatePath()`, introduce a `normalized` local equal to `parsed.relativeFile` and strip any number of leading `./` segments in a `while` loop, mirroring `writer/lib/plugin-validators-frontend-imports.ts:58-65`.
- [ ] 1.2 Immediately after the strip loop, if `normalized.length === 0`, return `{ status: 400, detail: "Plugin path is empty" }`. This MUST happen BEFORE the dotfile-segment check so that inputs like `./` or `././` cannot fall through to `resolve(dir, "")` and trigger a downstream directory-read 500.
- [ ] 1.3 Replace the existing `parsed.relativeFile.includes("..")` substring check with a segment-equals check against `normalized.split(/[\\/]/)`, rejecting only segments whose value is exactly `..`.
- [ ] 1.4 Update the dotfile-segment check at line 204 to operate on `normalized.split(/[\\/]/)` (still rejecting any segment whose first character is `.`).
- [ ] 1.5 Pass `normalized` (not the original `parsed.relativeFile`) into `resolve(dir, ...)` so logs / error messages reflect the cleaned path. Keep the post-resolve `isPathContained()` check unchanged.
- [ ] 1.6 Leave the forbidden-extension check (`.js`, `.mjs`, `.cjs`, `.html`, `.htm`, `.svg`) unchanged but operate it on `normalized` for consistency.

## 2. Tests

- [ ] 2.1 Add the new scenarios to the existing route test modules — primarily `tests/writer/routes/templates-coverage.test.ts` (the existing plugin-fragment cases live around lines 218–286) and `tests/writer/routes/templates_test.ts` as needed. Do NOT create `tests/writer/routes/templates-path_test.ts` — it does not exist in this codebase.
- [ ] 2.2 Add unit cases against `resolveTemplatePath()` for accepted inputs: `./foo.md`, `./sub/bar.md`, `foo.md`, `sub/bar.md`, `foo..bar.md`, `././foo.md`.
- [ ] 2.3 Add unit cases for rejected inputs: `.env`, `./.env`, `sub/.env`, `foo/.git/bar.md`, `..`, `../escape.md`, `foo/../bar.md`, `sub/./foo.md` (interior `./` rejected), `.\\foo.md` (backslash form remains rejected).
- [ ] 2.4 Add unit cases for the empty-after-normalization rejection: `plugin:test-plugin:./` and `plugin:test-plugin:././` MUST return `400` with `detail: "Plugin path is empty"`.
- [ ] 2.5 Add a regression case asserting `./handler.js` is still rejected by the forbidden-extension rule (not the dotfile rule).
- [ ] 2.6 Where a fixture plugin is available, add an end-to-end test against `GET /api/templates/source?templatePath=plugin:<plugin>:./<fragment>` confirming `200` and non-empty source.

## 3. Container verification (per AGENTS.md mandatory protocol)

- [ ] 3.1 Build the container with `scripts/podman-build-run.sh`.
- [ ] 3.2 Check startup logs are clean: `podman logs heartreverie 2>&1 | grep -i "error\|warn"`.
- [ ] 3.3 With a valid passphrase, call `curl -H "X-Passphrase: ..." 'http://localhost:8080/api/templates/source?templatePath=plugin:<known-plugin>:./<fragment>.md'` for at least one real plugin fragment from `HeartReverie_Plugins` and confirm `200` with non-empty `source`.
- [ ] 3.4 In the browser, open `/settings/template-editor`, click a Plugin Fragments leaf, and confirm the read-only editor renders the fragment contents (no toast error).
- [ ] 3.5 Negative spot-check: confirm a crafted request with `templatePath=plugin:<known-plugin>:./.env` still returns `400`.

## 4. Run repository checks

- [ ] 4.1 Run the project's lint task (`deno task lint` or equivalent — discover the exact command in `deno.json` / `AGENTS.md`).
- [ ] 4.2 Run the project's type-check / test task and confirm the new tests pass alongside the existing suite.
- [ ] 4.3 Run `openspec validate fix-plugin-fragment-path-normalization --strict` and confirm it passes.

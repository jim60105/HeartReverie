# Tasks: Remove FSA + IndexedDB

## 1. Frontend: delete the file-reader composable and related code
- [x] 1.1 Delete `reader-src/src/composables/useFileReader.ts`
- [x] 1.2 Delete the corresponding test file `tests/frontend/composables/useFileReader.test.ts` (if present)
- [x] 1.3 Search `reader-src/src/` for `useFileReader` imports and remove every callsite — components, composables, and `App.vue`
- [x] 1.4 Remove `directoryHandle`, `files`, `openDirectory`, `tryRestoreSession`, `readFile`, and any IndexedDB helper imports/exports surfaced by the composable
- [x] 1.5 Delete the `storyReaderDB` IndexedDB schema/open helper module (if it lives in its own file under `reader-src/src/lib/`)

## 2. Frontend: remove FSA mode from the chapter pipeline
- [x] 2.1 In `reader-src/src/composables/useChapterNav.ts`, drop the `mode: "fsa" | "backend"` branching (the conditionals and the `mode` ref itself), keeping the backend-only code path
- [x] 2.2 Remove FSA-specific scenarios from auto-reload polling logic (no FSA arm; backend polling stays)
- [x] 2.3 Remove "session restoration error handling" code (was FSA-only)

## 3. Frontend: remove FSA branches from UI components
- [x] 3.1 `ContentArea.vue` — remove `pluginsSettled` gate's "applies to FSA mode" annotation if present in code comments; behaviour unchanged
- [x] 3.2 `MainLayout.vue` / `AppHeader.vue` — strip any folder-picker / dual-mode header sizing branch left over from `4f3f91fe`
- [x] 3.3 `StorySelector.vue` — remove the FSA carve-out path in the story-loading code
- [x] 3.4 `ChapterContent.vue` — remove any `mode === "fsa"` clauses in edit/rewind/branch action gating; backend-only is the sole mode

## 4. Frontend: plugin-hooks — drop `mode` from hook contexts
- [x] 4.1 In `reader-src/src/lib/plugin-hooks.ts` (or the dispatcher source), remove the `mode` field from `story:switch` and `chapter:change` context payloads
- [x] 4.2 Tighten `series` and `story` typings on those contexts to non-nullable `string`
- [x] 4.3 Remove FSA-only dispatch sites; backend remains the single dispatch source

## 5. Frontend: plugin-action-buttons visibility filter
- [x] 5.1 Update the visibility filter so `"backend-only"` matches every chapter and `"last-chapter-backend"` matches only the last chapter — neither has an FSA exclusion anymore
- [x] 5.2 Keep the two-value enum (`"last-chapter-backend" | "backend-only"`) for forward-compat
- [x] 5.3 Update any in-code comments that referenced FSA-mode hiding

## 6. Frontend: router cleanup
- [x] 6.1 In `reader-src/src/router/index.ts` and any in-code comments, change "story selector / FSA chooser" wording to just "story selector" if such phrasing exists in comments

## 7. Frontend: tests
- [x] 7.1 Delete `useFileReader` tests
- [x] 7.2 Remove File System Access API mocks (`window.showDirectoryPicker`, `FileSystemDirectoryHandle`, `FileSystemFileHandle`) from any shared test setup
- [x] 7.3 Remove manual IndexedDB stubs (`vi.stubGlobal("indexedDB", …)`) from test setup. **No `package.json` / lockfile change** — `reader-src/` is a Deno project and `fake-indexeddb` is not an installed dependency.
- [x] 7.4 Update remaining composable/component tests that asserted dual-mode behaviour to assert backend-only behaviour
- [x] 7.5 Grep frontend tests for FSA residue and remove/rewrite each occurrence. Search terms: `FSA`, `mode.value`, `mode: "backend"`, `mode: "fsa"`, `loadFromFSA`, `useFileReader`, `directoryHandle`, `showDirectoryPicker`, `indexedDB`. Specific known sites to address:
  - `reader-src/src/router/__tests__/router.test.ts` lines ~92–108 — delete the `"router is NOT called in FSA mode"` test (the inverted invariant becomes vacuous once FSA is gone).
  - `reader-src/src/composables/__tests__/usePluginActions.test.ts` lines ~128–139 — delete the `"visibility: FSA mode hides both enum values"` test and the `modeRef.value = "fsa"` setup; surrounding tests must drop the `modeRef` argument from `useChapterNav` mocks.
  - `reader-src/src/lib/__tests__/plugin-hooks-new-stages.test.ts` lines ~132–150 — drop the `mode: "backend"` field from the `StorySwitchContext` and `ChapterChangeContext` literals (tracking spec narrowing).
- [x] 7.6 Run `deno task test:frontend` and confirm it passes

## 8. Backend: confirm no impact (sanity check)
- [x] 8.1 Grep `writer/` for "FSA", "showDirectoryPicker", "FileSystem", "IndexedDB" — confirm zero matches (no backend changes expected)

## 9. Plugins: scan built-in plugins for FSA references
- [x] 9.1 Grep `plugins/` for `mode === "fsa"`, `useFileReader`, or FSA-related strings in plugin frontend modules and remove any leftover branching

## 10. Documentation
- [x] 10.1 `docs/plugin-system.md` — remove FSA references at lines ~326 (`story:switch` / `chapter:change` rows in the hook table; drop `mode` from the context shape and the FSA-null sentinel) and lines ~509–511 (`visibleWhen` table row claiming `"backend-only"` is hidden in FSA mode + the "兩個值在 FSA 模式下都不會渲染" sentence)
- [x] 10.2 `AGENTS.md` — remove the `useFileReader.ts` line from the composables list under Project Structure, drop the "File System Access API" and "IndexedDB" bullets from "Frontend Technology Stack", and delete the "HTTPS is required for the File System Access API used by the frontend" sentence in "Running the Server"
- [x] 10.3 `README.md` — line ~61 remove the `> [!NOTE]` block stating `前端使用 [File System Access API][fsa-api] 讀取本機 .md 檔案，需要 HTTPS 安全環境`; line ~206 remove the now-unused `[fsa-api]: …` link reference
- [x] 10.4 `helm/heart-reverie/README.md` lines ~100–103 — rewrite the `## TLS` opening paragraph: drop `"HeartReverie's frontend uses the File System Access API + IndexedDB, both of which require a Secure Context."`. Reframe TLS as a recommended hardening default (passphrase + chapter content in transit), not a Secure-Context requirement.
- [x] 10.5 `CHANGELOG.md` lines ~133–135 — under the historical Unreleased / first-release section, soften `"Auto-generated self-signed TLS certificates on first run (HTTPS required for File System Access API)"` to drop the FSA parenthetical, and remove the `"File System Access API support for reading local .md story files; IndexedDB persistence for directory handles across sessions"` bullet (since it is being removed before any release ships). Add a new top-level entry under a new `## [Unreleased]` / `### Removed` section noting the FSA + IndexedDB removal and the HTTPS-no-longer-strictly-required clarification.
- [x] 10.6 `docs/helm-deployment.md` — remove the "Secure Context (HTTPS)" framing and the "瀏覽器顯示「無法存取本機檔案」" troubleshooting entry; reframe HTTPS as TLS hardening, not a feature gate (already enumerated in proposal.md; called out explicitly here so the doc sweep is complete)

## 10b. Scripts
- [x] 10b.1 `scripts/serve.sh` — detect `HTTP_ONLY=true` and emit the appropriate scheme in user-facing output. Affected sites: line ~18 (header comment block describing the URL), line ~33 (the `🚀 Story writer starting on https://localhost:${PORT}` echo), and line ~54 (any other `https://` literal in the help/example text). Keep TLS as the default behaviour; the change is cosmetic / informational only.

## 11. Validation
- [ ] 11.1 Run `deno task lint` and fix any unused-import/dead-code warnings introduced by the deletions
- [x] 11.2 Run `deno task test` (backend + frontend) and confirm green
- [x] 11.3 Run `deno task build:reader` and confirm a clean build
- [x] 11.4 Manual smoke: load a backend story, navigate chapters, edit/rewind/branch a chapter, fire a plugin action button — confirm all behaviours unchanged
- [ ] 11.5 Plain-HTTP smoke test: deploy with `HTTP_ONLY=true` over a non-localhost hostname (e.g. `http://<lan-ip>:8443` or behind a TLS-terminating reverse proxy) and confirm: (a) `crypto.randomUUID()` works (chat + plugin-action correlation IDs are generated; check `reader-src/src/composables/useChatApi.ts` lines 73, 213, 373) on Chrome ≥ 92 / Firefox ≥ 95 / Safari ≥ 15.4 — i.e. all currently supported browser baselines; (b) the WebSocket connection upgrades successfully and is not blocked by the existing CSP `connect-src 'self' ws://localhost:*`. If CSP blocks the WS upgrade on a non-localhost hostname, document the failure in this change's notes — but do NOT preemptively change the CSP in this proposal.

## 12. OpenSpec workflow
- [x] 12.1 Run `openspec validate remove-fsa-and-indexeddb --strict` and resolve any errors
- [ ] 12.2 After implementation lands and validation is green, archive the change via the `openspec-archive-change` skill

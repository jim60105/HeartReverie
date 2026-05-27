## 1. Scaffold the docsify site

- [x] 1.1 Create `HeartReverie/docs/.nojekyll` (empty file) so GitHub Pages serves `_sidebar.md`, `_navbar.md`, and `_coverpage.md` literally.
- [x] 1.2 Create `HeartReverie/docs/index.html` with `<html lang="zh-Hant">`, a viewport meta tag, `<title>HeartReverie Docs</title>`, the docsify `vue.css` theme `<link>`, and a `<script>` block declaring `window.$docsify` per `design.md` Decision 5 (name, repo, loadSidebar, loadNavbar, coverpage, auto2top, subMaxLevel: 3, plus `search`, `pagination`, and `copyCode` configs with the zh-Hant UI strings listed in Decision 5).
- [x] 1.3 In the same `index.html`, add `<script>` tags loading `docsify` core, `docsify`'s bundled `search.min.js`, `docsify-copy-code`, `docsify-pagination`, and `prismjs/components/prism-{markdown,bash,json,typescript,yaml}.min.js` — all from `cdn.jsdelivr.net/npm/...` with **exact `MAJOR.MINOR.PATCH` versions pinned** (e.g. `docsify@4.13.1`; choose the current latest at implementation time). NEVER use `@4` or `@latest` — these are incompatible with SRI per `design.md` Decision 2.
- [x] 1.4 For every external `<script>` and `<link>` tag in `index.html`, compute and add an `integrity="sha384-..."` attribute together with `crossorigin="anonymous"`. Use the recipe `curl -sS <exact-version-url> | openssl dgst -sha384 -binary | openssl base64 -A`. Commit the resulting hashes. Because the URLs use exact-version pins (§1.3), the hashes are stable until someone deliberately bumps a version.
- [x] 1.5 Add a comment at the top of `index.html`: `<!-- Edit with care. SRI hashes below are pinned per design.md Decision 2. Update hashes whenever a CDN URL version is bumped. -->`.
- [x] 1.6 Create `HeartReverie/docs/README.md` as the homepage: project overview (~5 lines, sourced from `HeartReverie/README.md`'s lead), a "本站內容" section that names the eight top-level sidebar sections, and a "→ 開始使用" link to `getting-started/installation.md`.
- [x] 1.7 Create `HeartReverie/docs/_coverpage.md`: title `HeartReverie 浮心夜夢`, tagline (reuse the existing one from `HeartReverie/README.md`), a "開始使用 →" button linking to `getting-started/installation.md`, and a background line referencing `assets/heart.webp` (NO `..` prefix — the file is staged inside `docs/assets/` in §1.7a so it resolves both under local preview and under Pages).
- [x] 1.7a Create `HeartReverie/docs/assets/` and copy `HeartReverie/assets/heart.webp` into it (`cp HeartReverie/assets/heart.webp HeartReverie/docs/assets/heart.webp`). Add a one-line `HeartReverie/docs/assets/README.md` stating "Files here are duplicated from `../../assets/` so docsify-cli serve (which makes `docs/` the web root) and GitHub Pages both resolve them; see `openspec/changes/.../design.md` Decision 8."
- [x] 1.8 Create `HeartReverie/docs/_navbar.md` with three top-bar links: GitHub repo, latest release page, and the LICENSE file.
- [x] 1.9 Create `HeartReverie/docs/_sidebar.md` enumerating every section and every subpage in the exact order from `design.md` Decision 6 and `specs/docs-site/spec.md`. Sidebar order matches the spec's fixed section ordering: 首頁 → 開始使用 → 使用指南 → Plugin 系統 → Prompt 模板 → 典籍系統（Lore Codex）→ 部署 → 遷移指南.
- [x] 1.10 Smoke-test: `cd HeartReverie/ && npx docsify-cli serve docs`. Open `http://localhost:3000/`. Confirm coverpage shows, navbar shows, sidebar shows, and the homepage loads. (Subpages don't exist yet at this point — they're created in §2–§5.)

## 2. Author the "Getting Started" and "Guides" sections (migrated from README/AGENTS.md)

Per `design.md` Decision 12, every page in this section is sourced from content already present in the repo at proposal time (`HeartReverie/README.md`, AGENTS.md files, `themes/default.toml`). The implementer SHALL NOT invent setup steps, env vars, or UI flows that are not already documented; gaps SHALL be flagged with a `TODO: needs content` line on the page and called out in the PR description.

- [x] 2.1 Create `docs/getting-started/installation.md`: container quick-start (source: `HeartReverie/README.md` "🚀 快速開始" → "容器化部署"); link out to `deployment/helm.md` for production.
- [x] 2.2 Create `docs/getting-started/configuration.md`: required env vars `LLM_API_KEY`, `PASSPHRASE`, optional ones (source: `HeartReverie/README.md` and `HeartReverie/.env.example` if present).
- [x] 2.3 Create `docs/getting-started/first-story.md`: how to create a story directory under `playground/`, where to put `system.md`, how to open the reader/writer (source: `HeartReverie/README.md` Quick-Start tail + Tools 選單 section).
- [x] 2.4 Create `docs/guides/writing-stories.md`: end-to-end flow of authoring a chapter (source: README's overview paragraphs and Tools 選單 section).
- [x] 2.5 Create `docs/guides/reader-ui.md` and `docs/guides/writer-ui.md`: brief tours sourced from the README's Tools 選單 + Template Editor sections; cross-link to plugin-system topics where the README already does so.
- [x] 2.6 Create `docs/guides/tools-menu.md` and `docs/guides/template-editor.md`: extract verbatim from `HeartReverie/README.md` "🧰 工具選單" and "✏️ Template Editor" sections respectively, applying the heading-promotion rule (the H2 in README becomes the H1 of the subpage).

## 3. Split `plugin-system.md` into `docs/plugin-system/`

- [x] 3.1 For each H2 in the legacy `docs/plugin-system.md`, create one subpage under `docs/plugin-system/` with the kebab-case slug listed in `proposal.md` "What Changes" §3 (e.g. `overview.md`, `manifest.md`, `discovery-and-loading.md`, `prompt-fragments.md`, `strip-tags.md`, `hooks.md`, `frontend-render.md`, `frontend-styles.md`, `action-buttons.md`, `settings.md`, `custom-api-routes.md`, `api-endpoints.md`, `security.md`, `external-plugins.md`, `authoring-guide.md`, `builtin-catalog.md`, `hook-inspector.md`).
- [x] 3.2 For each subpage: promote the original H2 to H1, shift all child headings up by one level (H3 → H2, H4 → H3), preserve all body content verbatim, preserve all code blocks unchanged.
- [x] 3.3 **Build the anchor-rewrite map first.** Before editing any links, create `openspec/changes/introduce-docsify-documentation-2026-05-27/anchor-rewrite-map.md` (see `design.md` Decision 11) listing every distinct `#anchor` target referenced anywhere in `docs/plugin-system.md` against its new location: either `<file>.md` (if the target H2 became its own subpage) or `<file>.md#<heading-slug>` (if the target H3 stays inside one subpage). Generate the candidate list with `grep -oE '\]\(#[^)]+\)' docs/plugin-system.md | sort -u`. Fill in the right-hand side by inspection.
- [x] 3.4 Apply the anchor-rewrite map: for every link of the form `[…](#xxx)` in the migrated body, rewrite it to the right-hand side from the map (cross-file `xxx.md`, or intra-page `xxx.md#anchor` becoming just `#anchor` if the link is already on that page).
- [x] 3.5 For each migrated subpage, run `grep -cE '^# ' docs/plugin-system/<page>.md` — MUST report exactly `1`. Run `grep -nE '^#{1,6} ' docs/plugin-system/<page>.md` to spot any orphaned heading levels and fix.
- [x] 3.6 In each subpage, audit code-fence languages. If a fenced block was unlabeled in the original, label it (`json`, `bash`, `typescript`, `markdown`, `yaml`) so Prism highlights correctly — one of the SRI-pinned Prism components must cover it; if a different language is needed, add the corresponding Prism component `<script>` to `index.html` along with its SRI hash.

## 4. Split `prompt-template.md` into `docs/prompt-template/`

- [x] 4.1 For each H2 in the legacy `docs/prompt-template.md`, create one subpage under `docs/prompt-template/`: `overview.md`, `variables.md`, `vento-syntax.md`, `editing-in-ui.md`, `build-pipeline.md`, `lore-rendering.md`, `template-editor.md`, `lore-in-template-editor.md`.
- [x] 4.2 Extend the anchor-rewrite map (§3.3) with the prompt-template anchors. Apply the same heading-promotion, anchor rewrite, single-H1 audit, and code-fence language audit rules as §3.2 and §3.4–§3.6.

## 5. Migrate the remaining four loose docs

- [x] 5.1 Move `docs/lore-codex.md` into `docs/lore-codex/` split per H2: `overview.md`, `directory-structure.md`, `chapter-format.md`, `tagging.md`, `template-variables.md`, `api.md`. Apply §3.2–§3.5 rules.
- [x] 5.2 Move `docs/helm-deployment.md` to `docs/deployment/helm.md` as a single page (keep all current H2s under it; the file is short enough to stay one page). Apply the heading audit (§3.4) and code-fence audit (§3.5).
- [x] 5.3 Move `docs/ci-cross-repo-trigger.md` to `docs/deployment/ci-cross-repo-trigger.md` as a single page. Apply audits.
- [x] 5.4 Move `docs/migration-hook-inspector.md` to `docs/migrations/hook-inspector.md` as a single page. Apply audits.

## 6. Delete the legacy loose files and update internal references

- [x] 6.1 `git rm HeartReverie/docs/plugin-system.md HeartReverie/docs/prompt-template.md HeartReverie/docs/lore-codex.md HeartReverie/docs/helm-deployment.md HeartReverie/docs/ci-cross-repo-trigger.md HeartReverie/docs/migration-hook-inspector.md`.
- [x] 6.2 Run `git grep -nE 'docs/(plugin-system|prompt-template|lore-codex|helm-deployment|ci-cross-repo-trigger|migration-hook-inspector)\.md' -- ':!openspec/changes/archive/' ':!openspec/changes/introduce-docsify-documentation-2026-05-27/' ':!CHANGELOG.md'`. For every hit, update the path to its new location under `docs/<section>/<page>.md`. Re-run the grep — MUST return zero matches. (The `archive/` subtree is excluded as historical record per `design.md` Decision 9; the change's own folder is excluded because the proposal and design docs naturally name the legacy files; `CHANGELOG.md` is excluded because past-release entries describe historical state and rewriting them would falsify the release record.)
- [x] 6.3 Update `HeartReverie/AGENTS.md` if any of its doc-pointer paragraphs reference the old paths, replacing them with pointers to the new layout (and to `docs/README.md` as the entry point).
- [x] 6.4 Update the repo-root `AGENTS.md` doc-pointer table in the same way.
- [x] 6.5 Update `HeartReverie/README.md`: add a new `## 📚 Documentation` section right before the existing `## 📄 授權` section, containing (a) the local-preview command `npx docsify-cli serve docs` (run from inside `HeartReverie/`), and (b) the published GitHub Pages URL (e.g. `https://jim60105.github.io/HeartReverie/`).

## 7. Add the GitHub Pages publishing workflow

Note: the `HeartReverie/` directory of this workspace is itself a standalone git repo (`jim60105/HeartReverie`); paths below are repo-relative to that repo, NOT to the workspace root. The workflow file therefore lives at `HeartReverie/.github/workflows/docs-pages.yaml` from the workspace POV, equivalent to `.github/workflows/docs-pages.yaml` from the HeartReverie repo's POV.

- [x] 7.1 Create `.github/workflows/docs-pages.yaml` (inside the `HeartReverie/` repo). Triggers: `push` to `master` with `paths: ['docs/**', '.github/workflows/docs-pages.yaml']`, plus `workflow_dispatch`.
- [x] 7.2 Set top-level `permissions: { pages: write, id-token: write, contents: read }`. Set `concurrency: { group: pages, cancel-in-progress: false }`.
- [x] 7.3 Define a `build` job that checks out the repo and uploads `docs/` as the Pages artifact via `actions/upload-pages-artifact@v3` (`path: docs`). NO separate asset staging is needed because the cover image now lives at `docs/assets/heart.webp` after §1.7a.
- [x] 7.4 Define a `deploy` job that depends on `build`, uses `actions/deploy-pages@v4`, and runs in the `github-pages` environment.
- [x] 7.5 The repo owner must enable Pages once: in the `jim60105/HeartReverie` repo settings → Pages → Source = "GitHub Actions". This is called out in the PR description and verified in §9.7.
- [x] 7.6 Add a workflow step that, after `actions/upload-pages-artifact`, downloads the artifact to a scratch dir and runs `python3 -m http.server 8000 --directory <scratch>` in the background, then `curl -fsSL http://localhost:8000/ | grep -q 'HeartReverie'` and `curl -fsSL http://localhost:8000/assets/heart.webp -o /dev/null` to verify the artifact contains both the homepage and the cover image at the right paths. (This catches asset-path regressions before deploy.)

## 8. Tooling exclusions

- [x] 8.1 Add `docs/index.html` to `HeartReverie/deno.json`'s `fmt.exclude` array. Verify `deno task fmt:check` still exits 0 on a clean tree.
- [x] 8.2 Confirm `lint.exclude` needs no change (no `.js` files were introduced under `docs/`; configuration lives inline in `index.html`).

## 9. End-to-end verification

- [x] 9.1 Local preview: `cd HeartReverie/ && npx docsify-cli serve docs`. Click through every link in the sidebar. Confirm every link resolves (no 404, no "page not found" docsify default). Confirm the coverpage shows its background image.
- [x] 9.2 Search: type a string known to appear in a deep subpage (e.g. "actionButtons" or "Vento"). Confirm the search hit appears and clicking it navigates to the right subpage with the term highlighted.
- [x] 9.3 Heading audit: `for f in docs/**/*.md; do [ "$(grep -cE '^# ' "$f")" = "1" ] || echo "BAD H1 COUNT: $f"; done` — MUST print nothing.
- [x] 9.4 Broken-anchor audit: `git grep -nE '\]\(#[^)]+\)' HeartReverie/docs/` — for every result, manually confirm the anchor target exists *in the same file*. Any anchor that no longer matches is a leftover from the split and MUST be rewritten to a cross-file link.
- [x] 9.5 Stale-path audit: `git grep -nE 'docs/(plugin-system|prompt-template|lore-codex|helm-deployment|ci-cross-repo-trigger|migration-hook-inspector)\.md' -- ':!openspec/changes/archive/' ':!openspec/changes/introduce-docsify-documentation-2026-05-27/' ':!CHANGELOG.md'` — MUST return zero results.
- [x] 9.6 SRI sanity check: for each pinned CDN URL in `index.html`, run `curl -sS <url> | openssl dgst -sha384 -binary | openssl base64 -A` and confirm the result matches the committed `integrity` value byte-for-byte. Any mismatch means the CDN file changed under us; investigate before merging.
- [ ] 9.7 Repo-owner step (one-time, called out in PR description): in GitHub repo settings, Pages → Source = "GitHub Actions". Then trigger the workflow via `workflow_dispatch` and confirm the first deploy succeeds.
- [ ] 9.8 Published-site smoke test: open `https://jim60105.github.io/HeartReverie/` (or the configured Pages URL). Confirm coverpage, navbar, sidebar, search, and at least one deep subpage all render.

> 維護者備註，9.7 與 9.8 是需要倉庫管理員實際在 GitHub UI 操作的前置步驟，自動化流程沒辦法代勞，所以在人類管理員完成 Pages 來源切換並驗證線上版本之前，這兩項刻意保持未勾選狀態。- [x] 9.9 `openspec validate introduce-docsify-documentation-2026-05-27 --strict` — MUST pass before archiving the change.

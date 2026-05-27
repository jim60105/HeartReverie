## Context

`HeartReverie/docs/` today is six loose Markdown files. Two of them (`plugin-system.md` at 1474 lines and `prompt-template.md` at 446 lines) carry most of the documentation weight and are read directly on GitHub. There is no index, no navigation, no cross-page search, and intra-document anchor links inside the longest file are themselves hard to scan. The project is a Deno + Hono backend + Vue 3 SPA, fully containerized, with `playground/` for user data and `themes/` for content templates — the doc tooling MUST NOT add a Node dependency to the runtime image, MUST NOT introduce a build step that contributors are required to run, and MUST NOT touch `playground/` or `themes/`.

The project is pre-release with zero external users (confirmed in the user's brief). No backward-compat, no redirects, no migration shims are required. This is the right window to do a clean restructure.

The sibling `HeartReverie_Plugins` repo currently has no docs site; this proposal stays scoped to the core repo, but the conventions chosen here SHOULD be reusable if the plugins repo adopts docsify later.

## Goals / Non-Goals

**Goals:**

- Ship a navigable, searchable docs site rooted at `HeartReverie/docs/` with a clear sidebar, a landing/cover page, and a topical folder hierarchy.
- Split the two oversized docs (`plugin-system.md`, `prompt-template.md`) into focused subpages so each section of the existing content lives at one stable URL.
- Preserve all current doc content faithfully — restructure and re-link only, no rewriting of technical substance in this change.
- Zero new runtime dependencies. Zero build step in the contributor critical path. Local preview via a single `npx` command.
- A single, automated production hosting model (GitHub Pages via Actions) with no manual deploy.
- Configure the site so it can be opened directly with `npx docsify-cli serve docs` from `HeartReverie/` and also work as a static drop-in for GitHub Pages.

**Non-Goals:**

- Rewriting or expanding the technical content of the existing docs (a follow-up change can update content; this change is structure + tooling).
- Translating the docs into English (current content is zh-TW; that stays).
- Serving the docs from the Hono backend in the application container.
- Adding a Node.js dependency to the production runtime image.
- Adding pre-commit / lint-on-docs / link-checking automation (out of scope; can be a follow-up).
- Migrating `HeartReverie_Plugins/` docs.
- Authoring a new "tutorial" or "API reference" beyond the existing material.
- Setting up i18n, versioned docs, or custom themes.

## Decisions

### Decision 1 — Docsify over MkDocs / VitePress / Docusaurus

**Choice:** docsify, loaded from a pinned CDN URL.

**Rationale:**

- **No build step.** docsify reads `.md` files at request time in the browser. Contributors only need an editor; reviewers can preview by opening `index.html` (with a static server) or running `npx docsify-cli serve docs`.
- **No Node dep added to the runtime container.** The site is plain HTML/JS/MD on disk; the only Node touch is the optional contributor-side `npx docsify-cli serve` (zero install).
- **Plain Markdown stays the source of truth.** Authors edit `.md` files exactly as today — friendly for VSCode users, Git diffs stay tiny, and AI agents can grep/edit directly.

**Alternatives considered:**

- *MkDocs (Python)*: requires a Python build step and a Python runtime in CI; mature search and themes, but the build step is a contributor tax for a small docs set.
- *VitePress / Docusaurus*: best-in-class SPA docs, but each adds a Node/npm build pipeline and a `package.json` to maintain — exactly what this codebase tries to avoid at the application layer.
- *Plain GitHub-rendered Markdown (status quo)*: no navigation, no split-page authoring, the 1474-line `plugin-system.md` is the proof this no longer scales.

**Trade-off:** Because docsify renders client-side, the published site requires JavaScript to display. GitHub itself still renders the underlying `.md` files for read-only browsing, so JS-less fallback is acceptable (readers can still navigate the folder tree on github.com).

### Decision 2 — Pin docsify and its plugins to exact CDN versions with SRI

**Choice:** Load `docsify` and its plugin scripts from `https://cdn.jsdelivr.net/npm/...` URLs pinned to **exact `MAJOR.MINOR.PATCH` versions** (e.g. `docsify@4.13.1`, not `docsify@4`), plus Subresource Integrity (SRI) hashes on every external `<script>` and `<link>` tag.

**Why exact pins, not `@4`:** jsDelivr resolves a `@4` range to whatever the current minor/patch is, which means the same URL serves different bytes over time. SRI is the inverse contract — the browser refuses to execute the file unless its hash matches the committed value. Combining a moving range with a fixed hash is self-contradictory: the day jsDelivr advances `@4` to a new patch the site goes blank for every visitor. We MUST pin exact versions and treat any version bump as a deliberate change that re-computes and re-commits the SRI hash.

**Plugins included (exact versions to be chosen at implementation time, recorded in `index.html` and reflected in this design's git history if anyone bumps them):**

- `docsify` core (sidebar, navbar, coverpage)
- `docsify/lib/plugins/search.min.js` — full-text client-side search (shipped inside the docsify npm package, same exact-version pin as core)
- `docsify-copy-code` — copy buttons on code blocks
- `docsify-pagination` — prev/next at page bottom
- `prismjs` language components for `markdown`, `bash`, `json`, `typescript`, `yaml` (the languages used in the existing docs)

**Rationale:** Exact-version pins + SRI gives us cryptographic integrity against a CDN compromise *and* deterministic loads. Bugfix uptake becomes a manual, reviewable bump — desirable for a docs site that nobody is paged to fix.

**Alternatives considered:**

- *Major-version range (`@4`) + SRI*: rejected — internally contradictory (see above).
- *Vendor docsify locally* (commit `docsify.min.js` into the repo): removes the CDN as a runtime dependency, but adds maintenance toil and ~100KB of minified JS into the source tree. Acceptable fallback if jsDelivr reliability becomes a concern; called out in `tasks.md` §9 as the documented mitigation if SRI breakage recurs.
- *Use `@latest`*: rejected — silent breaking changes would surprise readers and would be incompatible with SRI.

### Decision 3 — Folder hierarchy and file split rules

**Choice:** One subdirectory per top-level sidebar section. Each `.md` file owns exactly one H1 (its page title), and subsections become H2/H3.

**Split rules applied to `plugin-system.md` (1474 lines → ~17 subpages):**

Each existing `## ` heading in the source file becomes its own subpage under `docs/plugin-system/`. The full mapping is enumerated in `proposal.md` ("What Changes" §3) and re-stated as a normative requirement in `specs/docs-site/spec.md` so reviewers and the implementer have a single source of truth for the split.

**Split rules applied to `prompt-template.md` (446 lines → 7 subpages):** same approach — one subpage per `## ` heading.

**Anchor / link rewrite policy:** all intra-file anchor links of the form `[…](#動作按鈕action-buttons)` MUST be rewritten to relative cross-file links of the form `[…](action-buttons.md)`. Anchor links *within* a single subpage (e.g. linking to an H2 in the same page) are preserved as-is.

**Heading-level normalization:** each new subpage starts with a single `#` title. Anything that was `###` under a `##` in the source file shifts up by one level when it moves to its own page so the heading hierarchy stays well-formed.

**Rationale:** matches docsify's expected layout, keeps the sidebar shallow (two levels), and makes each URL a stable target.

### Decision 4 — Production hosting: GitHub Pages via Actions

**Repo target:** the `HeartReverie/` directory of this workspace is itself the root of the standalone `jim60105/HeartReverie` git repository (`git remote -v` confirms `https://github.com/jim60105/HeartReverie.git`). The workspace at `/var/home/jim60105/repos/HeartReverie/` is a separate `jim60105/HeartReverie_Workspace` repo used only for cross-project development. **All paths in this change are relative to the `jim60105/HeartReverie` repo root**, i.e. the directory currently mounted at `HeartReverie/` in the workspace. The Pages site publishes from the `jim60105/HeartReverie` repo at the standard project-pages URL `https://jim60105.github.io/HeartReverie/`.

**Choice:** Publish `docs/` (repo-relative) to GitHub Pages via a new `.github/workflows/docs-pages.yaml` inside the `jim60105/HeartReverie` repo. Source = "GitHub Actions" (not "Deploy from branch"). Triggers: push to `master` with `paths: ['docs/**', '.github/workflows/docs-pages.yaml']` and `workflow_dispatch`.

**Why not serve from the Hono backend?** Two reasons:

1. The application container is a private deployment behind a passphrase gate. Public docs should not require credentials.
2. Bundling docs into the runtime image inflates image size and couples doc updates to backend releases.

**Why not "Deploy from branch"?** The Actions-based deploy lets us stage the artifact (so `docs/` plus any auxiliary assets land at exactly the published-site root) and gives the implementer full control over the workflow YAML (caching, concurrency group, environment).

**One-time admin step:** the repo owner must, once, set "Settings → Pages → Source = GitHub Actions" on the `jim60105/HeartReverie` repo. This is called out in `tasks.md` and noted as the only non-automated piece.

**Local preview:** `npx docsify-cli serve docs` from the `HeartReverie/` repo root. Documented in `HeartReverie/README.md`.

### Decision 5 — `index.html` content and configuration

The `docs/index.html` SHALL:

- Set `<title>HeartReverie Docs</title>`.
- Configure `window.$docsify` with: `name: 'HeartReverie 浮心夜夢'`, `repo: 'https://github.com/jim60105/HeartReverie'`, `loadSidebar: true`, `loadNavbar: true`, `coverpage: true`, `auto2top: true`, `subMaxLevel: 3`, `search: { placeholder: '搜尋文件…', noData: '找不到結果', depth: 3 }`, `pagination: { previousText: '上一頁', nextText: '下一頁', crossChapter: true }`, `copyCode: { buttonText: '複製', errorText: '錯誤', successText: '已複製' }`.
- Use the language-tag `<html lang="zh-Hant">` to match the content language.
- Set `<meta name="viewport" content="width=device-width, initial-scale=1.0">` for mobile.
- Use the `vue.css` theme (docsify's built-in) for visual consistency with the project's Vue stack.

### Decision 6 — `_sidebar.md` structure

```markdown
- [首頁](README.md)
- 開始使用
  - [安裝](getting-started/installation.md)
  - [設定](getting-started/configuration.md)
  - [建立第一個故事](getting-started/first-story.md)
- 使用指南
  - [撰寫故事](guides/writing-stories.md)
  - [Reader UI](guides/reader-ui.md)
  - [Writer UI](guides/writer-ui.md)
  - [Tools 選單](guides/tools-menu.md)
  - [Template Editor](guides/template-editor.md)
- Plugin 系統
  - [概覽](plugin-system/overview.md)
  - [Manifest](plugin-system/manifest.md)
  - …（每個原 `## ` 章節一頁）
- Prompt 模板
  - [概覽](prompt-template/overview.md)
  - …
- 典籍系統（Lore Codex）
  - …
- 部署
  - [Helm](deployment/helm.md)
  - [CI 跨儲存庫觸發](deployment/ci-cross-repo-trigger.md)
- 遷移指南
  - [Hook Inspector](migrations/hook-inspector.md)
```

The full enumerated sidebar is committed in `_sidebar.md` and mirrors the folder tree exactly.

### Decision 7 — `_navbar.md` and `_coverpage.md`

`_navbar.md` carries three top-bar links: GitHub repo, latest release, and license. `_coverpage.md` shows the project title, the existing tagline ("AI 互動小說引擎，把『讀小說』與『寫小說』綁在一起"), and a single "開始使用 →" button linking to `getting-started/installation.md`. The cover background references `assets/heart.webp` (relative to the docs site root, no `..` prefix) — that exact path is the docsify-served root under both local preview and Pages; see Decision 8.

### Decision 8 — Shared assets live INSIDE docs/

**Choice:** copy `assets/heart.webp` (and any future shared visual assets used by the docs site) from `HeartReverie/assets/` into `HeartReverie/docs/assets/` and commit the duplicate. The docs site references it as `assets/heart.webp` (relative to the docs root).

**Why not `../assets/heart.webp`?** `docsify-cli serve` makes `docs/` the web root, and `..` cannot escape a web root — the file would 404 under local preview. On GitHub Project Pages the path `/HeartReverie/../assets/...` also escapes the project subpath and resolves outside the site, breaking in production too. The `..` strategy was specified in an earlier draft and is rejected by this decision.

**Why duplicate the file rather than symlink or workflow-copy?** Symlinks in git are fragile across OSes and are explicitly discouraged for binary assets. A workflow-time copy (e.g. `cp HeartReverie/assets/heart.webp HeartReverie/docs/assets/`) works for the Pages deploy but does NOT help local preview, where there is no workflow to run. Committing the duplicate is the simplest path that works under both modes; the file is ~tens of KB, the duplication cost is negligible, and the source of truth for any **runtime** image use remains `HeartReverie/assets/heart.webp` — the copy under `docs/assets/` is purely for the docs site. A short comment in `docs/assets/README.md` (or a sibling note) SHOULD record this so a future contributor doesn't "DRY" it away.

**Alternative considered:** referencing a GitHub raw URL (`https://raw.githubusercontent.com/.../assets/heart.webp`). Rejected — couples the docs site to a specific branch name, breaks on forks, and CDNs the asset through GitHub's user-content host with unpredictable caching headers.

### Decision 9 — Deletion of the original loose files

Once content is migrated, the six original `.md` files in `docs/` (`plugin-system.md`, `prompt-template.md`, `lore-codex.md`, `helm-deployment.md`, `ci-cross-repo-trigger.md`, `migration-hook-inspector.md`) are deleted in the same commit that adds the new layout. No redirect stubs. **References to the old paths from *active* repository content** — current AGENTS.md files, the current `HeartReverie/README.md`, current source comments, and the *current* (non-archived) main specs under `openspec/specs/` — MUST be updated in the same commit. References inside `openspec/changes/archive/` are deliberately left untouched as historical records of past changes; the audit greps in `tasks.md` exclude that subtree.

The grep policy is therefore: `git grep -nE 'docs/(plugin-system|prompt-template|lore-codex|helm-deployment|ci-cross-repo-trigger|migration-hook-inspector)\.md' -- ':!openspec/changes/archive/' ':!openspec/changes/introduce-docsify-documentation-2026-05-27/' ':!CHANGELOG.md'` MUST return zero matches after the change. (The change's own folder is excluded because this design doc and the proposal naturally name the legacy files. `CHANGELOG.md` is excluded because its entries describe past-release state — rewriting them would falsify the release record, identical in nature to the `archive/` subtree.)

### Decision 10 — Tooling exclusions

- `deno.json` `fmt.exclude` adds `docs/index.html` (defensive — HTML is not in `fmt.include` today, but the new file is the only HTML in the repo aside from `reader-dist/`, so an explicit exclusion documents intent).
- `deno.json` `lint.exclude` needs no change — there is no JS inside `docs/` (docsify and plugins are CDN-loaded; configuration lives inline in `index.html` as a `<script>` block, which is HTML, not a `.js` file).
- `.gitignore` needs no change.

### Decision 11 — Explicit anchor-rewrite map

Because the long legacy files contain cross-references both at the H2 level (which become *different files* after the split) and at the H3 level (which become *intra-page anchors*), a mechanical "rewrite every `#anchor` to `anchor.md`" is insufficient. The implementer MUST build a flat lookup table, committed inside the change folder as `anchor-rewrite-map.md` (referenced from tasks.md §3.3 and §4.2), of the form:

```
# legacy plugin-system.md anchor  →  new path (file [+ #anchor])
#架構概覽                          →  plugin-system/overview.md
#plugin-manifest-規格              →  plugin-system/manifest.md
#動作按鈕action-buttons            →  plugin-system/action-buttons.md
#hook-系統                          →  plugin-system/hooks.md
#前端-render-生命週期               →  plugin-system/frontend-render.md
…
# H3-level anchors that survive INSIDE a single subpage:
#註冊路由                          →  plugin-system/custom-api-routes.md#註冊路由
…
```

Every old anchor link found in the migrated body text MUST be looked up in this map and rewritten according to it (file-link if the target moved to a different page; intra-page `#…` anchor if the target stayed on the same page). The map itself doubles as the implementer's checklist and as input to the §9 broken-anchor audit (every map entry MUST resolve to a real file or a real heading slug after migration). The map is **only required for the two oversized splits** (`plugin-system.md` and `prompt-template.md`); the four smaller files have few enough cross-references that they can be audited by direct grep alone (still required by tasks.md §5).

### Decision 12 — Getting Started and Guides content sources

`docs/getting-started/*.md` and `docs/guides/*.md` are NEW pages (not migrated from any existing doc). To stay within the "no rewriting of technical substance" goal, each new page is restricted to **content already present** in the repo at proposal time: `HeartReverie/README.md` (the Quick-Start, plugin-system overview, lore-codex overview, tools-menu, template-editor, Helm sections), the existing AGENTS.md files, and `themes/default.toml` for theme references. The implementer SHALL source verbatim where possible and SHALL NOT invent setup steps, env vars, or UI flows that are not already documented somewhere in the repo. If a Getting Started or Guides page would need information that is genuinely new (i.e. not in any current repo document), the implementer SHALL note "TODO: needs content" in the page and surface it in the PR description rather than improvise.

## Risks / Trade-offs

- **CDN availability** → If `cdn.jsdelivr.net` is down, the published site renders a blank page. *Mitigation:* the underlying `.md` files remain readable on github.com (graceful degradation). If CDN reliability becomes a concern post-launch, the follow-up is to vendor docsify locally (Decision 2 alternative).
- **No JS = no docs** → Readers with JS disabled see an empty page on Pages. *Mitigation:* same as above — github.com renders the raw `.md` files perfectly. We document this on the homepage.
- **Search is client-side** → docsify's search builds its index in the browser on first visit; with ~30–50 subpages the index is small (well under 1MB). Not a real risk at this scale.
- **Heading-level normalization risk** → Mechanically shifting `###` to `##` when content moves to its own page could miss edge cases (e.g. fenced code blocks that contain `###` as a literal). *Mitigation:* the split is reviewed file-by-file; the tasks list requires a `grep -nE '^#{1,6} '` audit per migrated subpage to confirm exactly one H1 per file and no orphaned heading levels.
- **Anchor rewrites can break links** → Rewriting intra-file `#…` anchors to cross-file `*.md` links is mechanical, but typos slip in. *Mitigation:* the implementer runs a link audit (`npx docsify-cli serve docs` + manual click-through of the sidebar) before merging; a follow-up change can add CI link-checking.
- **GitHub Pages one-time admin step** → If the repo owner forgets to flip "Settings → Pages → Source = GitHub Actions", the workflow runs but nothing is published. *Mitigation:* called out as a checklist item in `tasks.md` §6; the workflow's first run will surface a clear error in Actions logs if Pages is not enabled.
- **`docs/index.html` is the one binary-ish file in `docs/`** that contributors might accidentally reformat. *Mitigation:* explicit `fmt.exclude` entry (Decision 10) plus a comment at the top of `index.html` saying "edit with care; pinned SRI hashes below".
- **CDN script integrity** → Loading from `cdn.jsdelivr.net` means a CDN compromise could inject JS into every reader's browser. *Mitigation:* SRI `integrity="sha384-..."` attributes on every external `<script>` tag (Decision 2) make the browser refuse a tampered file. The hashes are committed to the repo and updated whenever the pinned version is bumped.

## Migration Plan

Not applicable in the traditional sense (no users to migrate). The "migration" is just:

1. Land the new layout in one PR (docsify scaffolding + split subpages + workflow + README updates + deletions of old files).
2. Repo owner enables GitHub Pages (Source = GitHub Actions) once.
3. First workflow run publishes the site.
4. Update internal grep-hits to point to the new paths in the same PR.

Rollback: revert the PR. The deleted files come back, the workflow goes away, GitHub Pages serves the previous (empty) state or 404 until the next push.

## Open Questions

- **Should the docs site live at `https://jim60105.github.io/HeartReverie/` (project pages, the default) or a custom domain?** This change assumes the default project-pages URL. Custom domain is a follow-up.
- **Do we want a "what's new" / changelog page surfaced in the sidebar?** Out of scope here; the repo already has `CHANGELOG.md` at the root and we can link to it from the navbar in a follow-up if useful.
- **Future: should the plugin-creation skill emit docs alongside plugin code?** Out of scope here; once the site exists, a follow-up can teach the skill to add a stub page under `docs/plugin-system/builtin-catalog.md` per new plugin.

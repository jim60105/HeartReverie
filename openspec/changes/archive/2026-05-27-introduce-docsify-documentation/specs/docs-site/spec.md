## ADDED Requirements

### Requirement: docs/ SHALL be a self-contained docsify site

The `HeartReverie/docs/` directory SHALL contain a runnable docsify site composed of, at minimum, the following files at its root: `index.html`, `.nojekyll`, `README.md`, `_sidebar.md`, `_navbar.md`, and `_coverpage.md`. The site SHALL be openable for local preview by running `npx docsify-cli serve docs` from inside the `HeartReverie/` directory without any prior install step.

#### Scenario: Local preview works out of the box
- **WHEN** a contributor with `npx` available runs `npx docsify-cli serve docs` from `HeartReverie/`
- **THEN** docsify-cli SHALL start a local HTTP server, serve `docs/index.html`, and the homepage (rendered from `docs/README.md`) SHALL load with the sidebar, navbar, and coverpage visible

#### Scenario: .nojekyll is present
- **WHEN** the `HeartReverie/docs/` directory is published to GitHub Pages
- **THEN** the `.nojekyll` file SHALL be present at the published site root, ensuring files whose names start with an underscore (e.g. `_sidebar.md`, `_navbar.md`, `_coverpage.md`) are served as-is

#### Scenario: docs/README.md is the homepage
- **WHEN** a reader opens the site root (either via local preview or GitHub Pages)
- **THEN** docsify SHALL render `docs/README.md` as the homepage, and the homepage SHALL contain a project overview, a "what's in this site" section, and a "Get Started" link to `getting-started/installation.md`

### Requirement: index.html SHALL load docsify and its plugins from a CDN with exact-version pins and subresource integrity

The `docs/index.html` file SHALL load `docsify` (version range `4.x`, pinned to an **exact `MAJOR.MINOR.PATCH` version**) and the plugins `search`, `docsify-copy-code`, and `docsify-pagination`, plus the Prism language components for `markdown`, `bash`, `json`, `typescript`, and `yaml`, from `https://cdn.jsdelivr.net/npm/...` URLs that contain a `@MAJOR.MINOR.PATCH` version specifier. URLs SHALL NOT use a partial range (`@4`) or `@latest`. Every external `<script>` and `<link>` tag SHALL carry an `integrity="sha384-..."` Subresource Integrity attribute and `crossorigin="anonymous"`.

#### Scenario: All external resources carry SRI hashes
- **WHEN** an auditor inspects every `<script src="https://...">` and `<link href="https://...">` tag in `docs/index.html`
- **THEN** each such tag SHALL carry both `integrity="sha384-..."` and `crossorigin="anonymous"` attributes

#### Scenario: Exact-version pin (not a range)
- **WHEN** an auditor inspects every CDN URL in `docs/index.html`
- **THEN** each URL SHALL match the regex `@\d+\.\d+\.\d+(/|$)` (an exact `MAJOR.MINOR.PATCH` version), and SHALL NOT contain `@latest`, nor a bare major like `@4/` without minor and patch components

### Requirement: index.html SHALL configure docsify with the project-specific options

The `docs/index.html` SHALL declare a global `window.$docsify` configuration with at least the following keys and values: `name: 'HeartReverie 浮心夜夢'`, `repo: 'https://github.com/jim60105/HeartReverie'`, `loadSidebar: true`, `loadNavbar: true`, `coverpage: true`, `auto2top: true`, `subMaxLevel: 3`. The configuration SHALL also enable the `search`, `pagination`, and `copyCode` plugins with zh-Hant UI strings ("搜尋文件…", "找不到結果", "上一頁", "下一頁", "複製", "已複製"). The `<html>` tag SHALL declare `lang="zh-Hant"`.

#### Scenario: Sidebar, navbar, and coverpage are enabled
- **WHEN** a reader opens the site
- **THEN** docsify SHALL fetch and render `_sidebar.md`, `_navbar.md`, and `_coverpage.md` from the site root

#### Scenario: Search box uses Chinese placeholder
- **WHEN** a reader opens the site
- **THEN** the search input SHALL display the placeholder text `搜尋文件…`

### Requirement: The sidebar SHALL mirror the on-disk folder hierarchy

The `docs/_sidebar.md` file SHALL declare exactly the following top-level sections in this order: `首頁` (root README), `開始使用` (getting-started/), `使用指南` (guides/), `Plugin 系統` (plugin-system/), `Prompt 模板` (prompt-template/), `典籍系統（Lore Codex）` (lore-codex/), `部署` (deployment/), `遷移指南` (migrations/). Every `.md` file under those subdirectories SHALL appear as a leaf link under the corresponding section.

#### Scenario: Every subpage is linked from the sidebar
- **WHEN** an auditor enumerates every `.md` file under `docs/` other than `README.md`, `_sidebar.md`, `_navbar.md`, and `_coverpage.md`
- **THEN** each enumerated file SHALL appear at least once as a relative link in `docs/_sidebar.md`

#### Scenario: Sidebar order matches the documented section order
- **WHEN** an auditor reads `docs/_sidebar.md` top-to-bottom
- **THEN** the top-level section headings SHALL appear in exactly the order `首頁`, `開始使用`, `使用指南`, `Plugin 系統`, `Prompt 模板`, `典籍系統（Lore Codex）`, `部署`, `遷移指南`

### Requirement: The original loose docs SHALL be split into focused subpages with content preserved

The pre-existing files `docs/plugin-system.md` and `docs/prompt-template.md` SHALL be deleted and their content migrated, without rewriting technical substance, into subpages under `docs/plugin-system/` and `docs/prompt-template/` respectively. Each `## ` heading in the original file SHALL become its own subpage with that heading promoted to an H1 title; `###` headings under it SHALL be promoted to `##`, and so on. The pre-existing files `docs/lore-codex.md`, `docs/helm-deployment.md`, `docs/ci-cross-repo-trigger.md`, and `docs/migration-hook-inspector.md` SHALL likewise be migrated into `docs/lore-codex/`, `docs/deployment/helm.md`, `docs/deployment/ci-cross-repo-trigger.md`, and `docs/migrations/hook-inspector.md` respectively, and the originals SHALL be deleted in the same change.

#### Scenario: plugin-system.md is split per top-level heading
- **WHEN** an auditor compares the H2 headings of the legacy `docs/plugin-system.md` (e.g. `## 架構概覽`, `## Plugin Manifest 規格`, `## 提示詞片段`, `## Hook 系統`, …) against the file set under `docs/plugin-system/`
- **THEN** there SHALL exist exactly one subpage under `docs/plugin-system/` for each legacy H2 heading, named with a stable kebab-case slug (e.g. `overview.md`, `manifest.md`, `prompt-fragments.md`, `hooks.md`, …)

#### Scenario: Each subpage has exactly one H1
- **WHEN** an auditor runs `grep -cE '^# ' docs/<section>/<page>.md` against every `.md` file under any `docs/<section>/` subdirectory
- **THEN** every such file SHALL report exactly `1` H1 heading

#### Scenario: Legacy loose files are deleted
- **WHEN** an auditor runs `git ls-files HeartReverie/docs/` after the change is merged
- **THEN** the output SHALL NOT contain any of `docs/plugin-system.md`, `docs/prompt-template.md`, `docs/lore-codex.md`, `docs/helm-deployment.md`, `docs/ci-cross-repo-trigger.md`, or `docs/migration-hook-inspector.md`

#### Scenario: No intra-file anchor links to the legacy files remain
- **WHEN** an auditor greps the migrated docs for links of the form `](#...)` that referenced anchors only valid in the legacy single-file layout
- **THEN** every such link SHALL have been rewritten to a relative cross-file link (e.g. `](action-buttons.md)` or `](../plugin-system/action-buttons.md)`), and no broken intra-file anchors SHALL remain

### Requirement: Internal repo references to the legacy doc paths SHALL be updated

Every reference in *active* repository content (READMEs, AGENTS.md files, source comments, openspec main specs under `openspec/specs/`, skill documents) to the legacy paths `docs/plugin-system.md`, `docs/prompt-template.md`, `docs/lore-codex.md`, `docs/helm-deployment.md`, `docs/ci-cross-repo-trigger.md`, or `docs/migration-hook-inspector.md` SHALL be updated, in the same change, to point at the corresponding new path under `docs/<section>/<page>.md`. References inside `openspec/changes/archive/` are deliberately preserved as historical records of past changes and SHALL NOT be modified. References inside `CHANGELOG.md` describe past-release state and SHALL likewise be preserved as historical record.

#### Scenario: grep confirms no stale references remain outside archives

- **WHEN** an auditor runs `git grep -nE 'docs/(plugin-system|prompt-template|lore-codex|helm-deployment|ci-cross-repo-trigger|migration-hook-inspector)\.md' -- ':!openspec/changes/archive/' ':!openspec/changes/introduce-docsify-documentation-2026-05-27/' ':!CHANGELOG.md'` from the repo root
- **THEN** the command SHALL return zero matches

### Requirement: HeartReverie/README.md SHALL document how to view the docs

The `HeartReverie/README.md` file SHALL contain a `## 📚 Documentation` section that names the local preview command (`npx docsify-cli serve docs`, run from inside `HeartReverie/`) and links to the published GitHub Pages site URL.

#### Scenario: README mentions both local and published docs
- **WHEN** a reader opens `HeartReverie/README.md`
- **THEN** they SHALL find a `## 📚 Documentation` section that contains the literal string `npx docsify-cli serve docs` and a link to the GitHub Pages site (a URL of the form `https://jim60105.github.io/HeartReverie/` or equivalent)

### Requirement: GitHub Pages SHALL be published automatically via GitHub Actions

The `jim60105/HeartReverie` repository (i.e. the standalone repo rooted at `HeartReverie/` in this workspace) SHALL contain a workflow file at `.github/workflows/docs-pages.yaml` that, on push to `master` with paths matching `docs/**` (repo-relative) and on `workflow_dispatch`, uploads the contents of `docs/` as a GitHub Pages artifact and deploys it. The workflow SHALL use a concurrency group keyed by `pages` with `cancel-in-progress: false` so concurrent deploys do not abort each other. The workflow SHALL grant the minimum permissions required (`pages: write`, `id-token: write`, `contents: read`).

#### Scenario: Workflow exists and is path-scoped
- **WHEN** an auditor inspects `.github/workflows/docs-pages.yaml` (inside the `HeartReverie/` repo)
- **THEN** the workflow SHALL declare `on.push.paths` including `docs/**` and SHALL declare `on.workflow_dispatch`

#### Scenario: Cover image asset is present in the Pages artifact
- **WHEN** the workflow uploads the Pages artifact
- **THEN** the artifact SHALL contain `assets/heart.webp` at the docs-root-relative path the cover page references, because `docs/assets/heart.webp` is committed inside the `docs/` tree (see also the asset-co-location requirement below)

#### Scenario: Minimum permissions
- **WHEN** an auditor inspects the workflow's top-level `permissions:` block
- **THEN** it SHALL grant exactly `pages: write`, `id-token: write`, and `contents: read`, and SHALL NOT grant `write` to any other scope

### Requirement: Shared visual assets used by the docs site SHALL live inside docs/

Any visual asset referenced by `_coverpage.md`, `_navbar.md`, `_sidebar.md`, or any subpage of the docs site SHALL be present at a path *inside* `HeartReverie/docs/` (e.g. `HeartReverie/docs/assets/heart.webp`). Assets SHALL NOT be referenced via a `../` parent-directory escape, because `docsify-cli serve docs` makes `docs/` the web root and cannot resolve paths above it.

#### Scenario: Cover image resolves under local preview
- **WHEN** a contributor runs `npx docsify-cli serve docs` from the `HeartReverie/` repo root and opens the homepage
- **THEN** the cover page background image SHALL load (HTTP 200), because the referenced path resolves inside the docs root

#### Scenario: No parent-escape paths in docs site
- **WHEN** an auditor greps the docs site for asset references that escape the web root
- **THEN** `grep -REn '(src|href|background-image)[^>]*\.\./' HeartReverie/docs/` SHALL return zero matches for paths that escape `docs/` (any matches MUST resolve to a sibling subdirectory of `docs/`, not to a parent)

### Requirement: deno.json SHALL keep docs/ out of fmt scope explicitly

`HeartReverie/deno.json` `fmt.exclude` SHALL list `docs/index.html` (in addition to the existing `**/*.md` global exclusion, which already covers every other file under `docs/`).

#### Scenario: deno fmt does not modify the docs site bootstrap
- **WHEN** a contributor runs `deno task fmt` at the repository root
- **THEN** `docs/index.html` SHALL NOT be modified

### Requirement: Docs tooling SHALL add zero runtime dependencies

The change SHALL NOT add any entry to `deno.json`'s `imports` map, SHALL NOT introduce a `package.json` at any layer, and SHALL NOT add any build step that is required to view the documentation. The contributor-side `npx docsify-cli serve docs` invocation is explicitly opt-in and does not count as a required dependency.

#### Scenario: No package.json is added
- **WHEN** an auditor runs `find HeartReverie -name package.json -not -path '*/node_modules/*'` after the change is merged
- **THEN** the output SHALL be identical to the same command's output before the change

#### Scenario: No new entries in deno.json imports
- **WHEN** an auditor diffs the `imports` block of `deno.json` before and after the change
- **THEN** the diff SHALL be empty

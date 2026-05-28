# docs-site Specification

## Purpose
Defines the structure, tooling, and publishing pipeline of the HeartReverie documentation site (`HeartReverie/docs/`). The site is a self-contained docsify single-page app that runs locally via `npx docsify-cli serve docs` with zero install steps, and is published to GitHub Pages via a dedicated Actions workflow. All external assets are loaded from `cdn.jsdelivr.net` with exact-version pins and Subresource Integrity hashes; no build step, package manager, or runtime dependency is added to the repository.
## Requirements
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

- **WHEN** an auditor runs `git grep -nE 'docs/(plugin-system|prompt-template|lore-codex|helm-deployment|ci-cross-repo-trigger|migration-hook-inspector)\.md' -- ':!openspec/changes/archive/' ':!CHANGELOG.md'` from the repo root
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

### Requirement: docs/assets/screenshots/ SHALL host all UI screenshots

文件站所有 UI 截圖 SHALL 儲存於 `HeartReverie/docs/assets/screenshots/` 之下；該目錄為新增子目錄，與既有 `docs/assets/heart.webp` 並列。封面與裝飾性圖片可繼續使用 `docs/assets/` 根目錄，UI 擷取畫面 SHALL NOT 放在 `docs/assets/` 根目錄或其他子路徑。

#### Scenario: 截圖位於專屬子目錄
- **WHEN** 稽核者執行 `git ls-files HeartReverie/docs/assets/screenshots/`
- **THEN** 輸出 SHALL 包含至少一個 `.png` 檔，且 `git ls-files HeartReverie/docs/assets/*.png` 在 `screenshots/` 目錄之外 SHALL NOT 增加新檔（既有 `heart.webp` 不受影響）

#### Scenario: 子目錄被 Pages 工作流納入
- **WHEN** `.github/workflows/docs-pages.yaml` 上傳 Pages 構件
- **THEN** 構件 SHALL 包含 `assets/screenshots/` 目錄及其全部檔案

### Requirement: 每張截圖 SHALL 配備可解析的截圖配方註解

文件站中每個 `![alt](assets/screenshots/...)` 圖片連結之前 SHALL 緊鄰一段以 `<!-- screenshot-recipe` 起始、`-->` 結尾的 docsify HTML 註解區塊。註解內容 SHALL 採 YAML-like 縮排鍵值對，並 SHALL 至少包含下列必填欄位：`schema`、`url`、`viewport`、`theme`、`preconditions`、`capture`、`output`、`captured_at`、`app_commit`；`steps`、`notes` 為選填，但凡需要任何互動（含切換主題、關閉 modal、滾動、輸入、登入、設定 localStorage）的截圖 SHALL 提供 `steps`。`schema` 欄位的值 SHALL 為固定字串 `v1`。`output` 欄位的值 SHALL 以 `docs/assets/screenshots/` 為前綴並與緊鄰的 `![alt](...)` 路徑一致。`captured_at` SHALL 為 ISO 8601 日期，`app_commit` SHALL 為有效的 git SHA（短或長），兩者 SHALL NOT 為 `TBD` 或空字串。

#### Scenario: 每張截圖都有對應配方
- **WHEN** 稽核者對任一含 `assets/screenshots/` 圖片連結的 `.md` 檔執行 `grep -B 20 'assets/screenshots/' <file>`
- **THEN** 圖片連結上方 SHALL 出現一段以 `<!-- screenshot-recipe` 起始、以 `-->` 結尾的註解，且該註解 SHALL 包含 `schema:`、`url:`、`viewport:`、`theme:`、`preconditions:`、`capture:`、`output:`、`captured_at:`、`app_commit:` 九個必填鍵

#### Scenario: captured_at 與 app_commit 已填值
- **WHEN** 稽核者對任一配方提取 `captured_at` 與 `app_commit` 欄位
- **THEN** 兩欄位值 SHALL 為非空、SHALL NOT 等於 `TBD`，且 `captured_at` SHALL 比對 `^\d{4}-\d{2}-\d{2}$`

#### Scenario: 配方 output 與圖片路徑一致
- **WHEN** 稽核者比對任一配方註解中 `output:` 欄位的值與其下方 `![alt](...)` 連結的路徑
- **THEN** 兩者 SHALL 指向同一檔案（容許 `output:` 以 `docs/` 前綴、Markdown 連結以 `assets/` 為相對前綴的差異）

### Requirement: viewport 與 capture 欄位 SHALL 採用受限字串格式

`viewport` 欄位的值 SHALL 比對正規式 `^\d{3,4}x\d{3,4}$`（如 `1440x900`、`390x844`）。`capture` 欄位的值 SHALL 為下列三者之一：`viewport`、`full_page`、`selector:<CSS 選擇器>`。`theme` 欄位的值 SHALL 為 `default`、`light`、`dark` 之一。

#### Scenario: 欄位格式合規
- **WHEN** 稽核者解析任一配方的 `viewport`、`capture`、`theme` 欄位
- **THEN** 三個欄位 SHALL 各自比對上述格式約束，否則視為配方無效

### Requirement: in-app 截圖 SHALL 僅取自指定 SFW 來源

凡涉及 Reader、Writer、章節內容、Tools 選單、Plugin 設定、Template Editor 之 UI 截圖，其配方 `url` 欄位的值 SHALL 比對下列 allow-list 之一作為前綴（容許其後接續 query 與 anchor）：

1. `http://localhost:8080/悠奈悠花姊妹大冒險/放學後/`
2. `http://localhost:8080/tools`、`http://localhost:8080/tools/new-series`、`http://localhost:8080/tools/import-character-card`
3. `http://localhost:8080/settings/`
4. `http://localhost:8080/`（僅限不顯示其他故事資訊的首頁）

文件站 SHALL NOT 出現引用其他 playground 故事（含其他系列、其他章節名稱）的截圖；同時，畫面中側邊欄、最近開啟清單、章節下拉、列表縮圖等元素 SHALL NOT 顯示「悠奈悠花姊妹大冒險／放學後」以外的故事或章節名稱（必要時於 `preconditions` 或 `steps` 中明文清除最近紀錄）。

#### Scenario: SFW 故事 URL 為唯一許可來源
- **WHEN** 稽核者執行 `grep -REn '^\s*url:\s*http://localhost:8080/' HeartReverie/docs/`
- **THEN** 每筆比對結果的 URL SHALL 以下列前綴之一開頭：`http://localhost:8080/悠奈悠花姊妹大冒險/放學後/`、`http://localhost:8080/tools`、`http://localhost:8080/settings/`、`http://localhost:8080/`（結尾為 `/` 且不含後續路徑）

#### Scenario: 截圖畫面不顯示其他故事名稱
- **WHEN** 稽核者開啟任一截圖檔
- **THEN** 畫面中 SHALL NOT 出現「悠奈悠花姊妹大冒險／放學後」以外的故事或章節文字

### Requirement: 每張截圖周邊 SHALL 有散文說明

文件中每個指向 `assets/screenshots/` 的 Markdown 圖片連結，其前後 5 行之內 SHALL 至少有一段非配方、非圖片連結的散文（或 `>` 引言）說明該畫面對應之功能、狀態或操作意義。文件 SHALL NOT 以截圖獨立替代散文敘述。

#### Scenario: 圖片周邊有散文
- **WHEN** 稽核者擷取任一截圖連結前後 5 行
- **THEN** 該範圍內 SHALL 至少存在一行非 HTML 註解、非圖片連結、非空白的 Markdown 文字

### Requirement: docs/contributing/screenshot-recipes.md SHALL 定義配方撰寫指南

`HeartReverie/docs/contributing/screenshot-recipes.md` SHALL 為新增頁面，內容 SHALL 涵蓋：配方欄位定義（每個必填與選填欄位的語意與範例）、檔名規則（kebab-case、以 UI 區域開頭）、檔案格式與寬度上限（PNG ≤ 2048px、WebP 僅限裝飾用途）、替代文字撰寫守則（中文描述、句長 ≤ 30 字、敘述畫面內容、避免以「截圖」「畫面」結尾）、無障礙建議（純文字介面避免以截圖替代散文敘述）、容器啟動指令 `scripts/podman-build-run.sh`、SFW 故事限制與唯一許可 URL、`agent-browser` 工具的使用提示。此頁是寫給貢獻者用的擷取規範，SHALL NOT 與面向終端使用者的 `guides/*` 並列；該頁 SHALL 被 `docs/_sidebar.md` 在「貢獻者文件」獨立區段以連結 `[截圖配方](contributing/screenshot-recipes.md)` 收錄。

#### Scenario: 指南頁存在且涵蓋必要章節
- **WHEN** 稽核者開啟 `HeartReverie/docs/contributing/screenshot-recipes.md`
- **THEN** 頁面 SHALL 至少包含以「配方欄位」「檔名規則」「圖片格式」「替代文字」「無障礙」「SFW 故事限制」「容器啟動」為主題的章節

#### Scenario: 側邊欄於貢獻者區段收錄指南頁
- **WHEN** 稽核者讀取 `HeartReverie/docs/_sidebar.md`
- **THEN** 「貢獻者文件」區段 SHALL 包含一行指向 `contributing/screenshot-recipes.md` 的連結；「使用指南」區段 SHALL NOT 包含指向該頁的連結

### Requirement: 指定頁面 SHALL 嵌入對應截圖

下列文件頁面 SHALL 各自至少嵌入一張對應截圖（含配方註解）：`guides/reader-ui.md`、`guides/writer-ui.md`、`guides/tools-menu.md`、`guides/template-editor.md`、`prompt-template/template-editor.md`、`plugin-system/settings.md`、`plugin-system/hook-inspector.md`、`plugin-system/action-buttons.md`、`plugin-system/builtin-catalog.md`。三種內建主題（default、light、dark）SHALL 於 `getting-started/configuration.md` 以同一場景之三張截圖呈現，SHALL NOT 為了主題比較另建獨立頁面。`lore-codex/overview.md` 因 `/settings/lore` 標籤聯集會跨 scope 暴露其他 NSFW 系列資料而暫不擷取畫面，SHALL NOT 列為必須嵌入截圖的頁面。

#### Scenario: 列舉的頁面都已嵌入截圖
- **WHEN** 稽核者對上列每個 `.md` 檔執行 `grep -c 'assets/screenshots/' <file>`
- **THEN** 每個檔案的計數 SHALL ≥ 1

#### Scenario: 三主題以同一場景呈現
- **WHEN** 稽核者檢視 `getting-started/configuration.md`
- **THEN** 該頁 SHALL 包含三段截圖配方，三者的 `url`、`viewport` 與 `capture` 欄位 SHALL 相同，僅 `theme` 與 `output` 欄位不同（值分別為 `default`、`light`、`dark`）

### Requirement: 文件 SHALL NOT 出現缺圖致歉散文

面向終端使用者的文件頁面（即 `docs/` 下，排除 `docs/contributing/`）SHALL NOT 出現解釋「為何此頁沒有截圖」「此頁暫無截圖」「screenshot-skip-rationale」或同義內容的可見散文、標題或 HTML 註解。內部擷取限制（例如 SFW playground 缺漏、CodeMirror 互動序列不穩定）若需追蹤，SHALL 記錄在本提案、Issue 追蹤系統或 `docs/contributing/screenshot-recipes.md` 的工作流章節，而非塞回面向讀者的頁面內。

#### Scenario: 不出現缺圖致歉內容
- **WHEN** 稽核者執行 `grep -rn "screenshot-skip-rationale\|為何此頁無截圖\|此頁暫無截圖\|無截圖" HeartReverie/docs/ | grep -v "^HeartReverie/docs/contributing/"`
- **THEN** 輸出 SHALL 為空

### Requirement: 截圖檔案格式與大小 SHALL 受限

`docs/assets/screenshots/` 下的圖片 SHALL 為 PNG 格式，像素寬度 SHALL ≤ 2048。WebP 僅允許用於非 `screenshots/` 目錄的裝飾性圖片（如 hero、coverpage）。任何 `assets/screenshots/` 下的 `.webp`、`.jpg`、`.jpeg`、`.gif` SHALL 視為違反規格。

#### Scenario: 僅 PNG 出現在截圖目錄
- **WHEN** 稽核者執行 `find HeartReverie/docs/assets/screenshots -type f -not -name '*.png'`
- **THEN** 輸出 SHALL 為空

### Requirement: 替代文字 SHALL 以中文描述畫面內容

文件中每個指向 `assets/screenshots/` 的 Markdown 圖片連結 `![alt](path)`，其 alt 文字 SHALL 為非空中文敘述、字元數 SHALL ≤ 30（半形與全形皆以 1 字元計），SHALL NOT 為空白，SHALL NOT 等於「截圖」「畫面」「圖片」之一，亦 SHALL NOT 以「截圖」「畫面」「圖片」單字結尾。

#### Scenario: alt 文字非空且具描述性
- **WHEN** 稽核者對任一截圖連結提取 `![...](assets/screenshots/...)` 中的 alt 部分
- **THEN** 該 alt 文字 SHALL 為非空字串，字元數 SHALL ≤ 30，SHALL NOT 等於「截圖」「畫面」「圖片」之一，亦 SHALL NOT 以該三詞之一結尾


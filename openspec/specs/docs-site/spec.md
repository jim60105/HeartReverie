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

`docs/_sidebar.md` 之高階分組 SHALL 依序為 `首頁`、`入門`、`自架站`、`作者`、`外掛開發者`、`參考`、`貢獻者`，對應子目錄為（依序）`docs/`（README）、`docs/getting-started/`、`docs/self-host/`、`docs/author/`、`docs/plugin-dev/`、`docs/reference/`、`docs/contributing/`。每個位於上述子目錄底下的 `.md` 檔 SHALL 至少於 `_sidebar.md` 出現一次為相對連結。

#### Scenario: Every subpage is linked from the sidebar

- **WHEN** 稽核者列舉 `docs/getting-started/`、`docs/self-host/`、`docs/author/`、`docs/plugin-dev/`、`docs/reference/`、`docs/contributing/` 之下所有 `.md` 檔（不含 `README.md`、`_sidebar.md`、`_navbar.md`、`_coverpage.md`）
- **THEN** 每個被列舉的檔 SHALL 至少一次以相對連結形式出現於 `docs/_sidebar.md`

#### Scenario: Sidebar order matches the persona-based section order

- **WHEN** 稽核者由上而下讀取 `docs/_sidebar.md` 的高階分組標題
- **THEN** 順序 SHALL 為 `首頁`、`入門`、`自架站`、`作者`、`外掛開發者`、`參考`、`貢獻者`

### Requirement: Internal repo references to the legacy doc paths SHALL be updated

每個出現在 *活躍* 倉庫內容（README、`AGENTS.md`、原始碼註解、`openspec/specs/` 下的主規格、skill 文件）內、指向以下舊路徑或舊 docsify 雜湊連結之引用 SHALL 於本變更內更新為對應新路徑：(a) 倉庫內檔案路徑 `docs/guides/*.md`、`docs/plugin-system/*.md`、`docs/prompt-template/*.md`、`docs/lore-codex/*.md`、`docs/deployment/*.md`、`docs/getting-started/installation.md`、`docs/getting-started/first-story.md`；(b) docsify 雜湊連結 `#/guides/...`、`#/plugin-system/...`、`#/prompt-template/...`、`#/lore-codex/...`、`#/deployment/...`、`#/getting-started/installation`、`#/getting-started/first-story`。`openspec/changes/archive/` 與 `CHANGELOG.md` 之歷史引用 SHALL 保留不動。

#### Scenario: grep 無殘留的舊路徑引用

- **WHEN** 稽核者於倉庫根執行 `git grep -nE '(docs/(guides|plugin-system|prompt-template|lore-codex|deployment)/|#/(guides|plugin-system|prompt-template|lore-codex|deployment)/|#/getting-started/(installation|first-story))' -- ':!openspec/changes/archive/' ':!CHANGELOG.md' ':!openspec/specs/docs-site/spec.md'`
- **THEN** 輸出 SHALL 為空

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

下列文件頁面 SHALL 各自至少嵌入一張對應截圖（含配方註解）：`author/reader-ui.md`、`author/writer-ui.md`、`author/tools-menu.md`、`author/prompt-template.md`、`author/plugin-settings.md`、`author/builtin-plugins.md`、`plugin-dev/hook-inspector.md`、`plugin-dev/action-buttons.md`。`author/builtin-plugins.md` 因須逐一介紹每個內建外掛，SHALL 至少嵌入 4 張截圖。三種內建主題（default、light、dark）SHALL 於 `getting-started/configuration.md` 以同一場景之三張截圖呈現，SHALL NOT 為了主題比較另建獨立頁面。`author/lore-codex.md`（或同等檔名）因 `/settings/lore` 標籤聯集會跨 scope 暴露其他 NSFW 系列資料而暫不擷取畫面，SHALL NOT 列為必須嵌入截圖的頁面。

#### Scenario: 列舉的頁面都已嵌入截圖

- **WHEN** 稽核者對上列每個 `.md` 檔執行 `grep -c 'assets/screenshots/' <file>`
- **THEN** 每個檔案的計數 SHALL ≥ 1，其中 `author/builtin-plugins.md` SHALL ≥ 4

#### Scenario: 三主題以同一場景呈現

- **WHEN** 稽核者檢視 `docs/getting-started/configuration.md`
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


### Requirement: Sidebar SHALL group top-level sections by reader persona

`docs/_sidebar.md` 的高階分組 SHALL 以讀者身份切分，依序為：`首頁`、`入門`、`自架站`、`作者`、`外掛開發者`、`參考`、`貢獻者`。Diátaxis 軸（Tutorial / How-to / Reference / Explanation）SHALL 僅作為各分組內部的次要分軸，SHALL NOT 出現於高階分組層。`docs/_sidebar.md` SHALL NOT 包含名為「使用指南」「Plugin 系統」「Prompt 模板」「典籍系統（Lore Codex）」「部署」「遷移指南」之高階分組。

#### Scenario: Sidebar top-level groups follow persona order

- **WHEN** 稽核者由上而下讀取 `docs/_sidebar.md` 的非縮排（即「高階」）行
- **THEN** 該順序 SHALL 為 `首頁` → `入門` → `自架站` → `作者` → `外掛開發者` → `參考` → `貢獻者`，且 SHALL NOT 出現主題式分組標籤（「使用指南」「Plugin 系統」「Prompt 模板」「典籍系統（Lore Codex）」「部署」「遷移指南」）

#### Scenario: Each persona group has its own folder

- **WHEN** 稽核者列舉 `docs/` 一級子目錄
- **THEN** SHALL 至少存在 `getting-started/`、`self-host/`、`author/`、`plugin-dev/`、`reference/`、`contributing/` 六個目錄；舊有的 `guides/`、`plugin-system/`、`prompt-template/`、`lore-codex/`、`deployment/` 目錄 SHALL NOT 存在

### Requirement: 外掛開發指南 SHALL 於入口導向 Agent Skill

`docs/plugin-dev/overview.md` 在 H1 之後 SHALL 出現一個文字為 `Agent Skill` 之二級標題（`## Agent Skill`），其下段落 SHALL 同時滿足：(a) 包含字串 `heartreverie-create-plugin`；(b) 包含字串「Agent Skill」或 `agent skill`（不區分大小寫）；(c) 包含一行可執行的安裝指令 `npx skills add https://github.com/jim60105/HeartReverie -s heartreverie-create-plugin`；(d) 包含至少兩句說明 `heartreverie-create-plugin` 產出範圍（涵蓋 manifest、hook 樣板、prompt fragment 任一以上）；(e) 包含一條 Markdown 連結，目標為 `../../README.md#撰寫自訂外掛` 或等義 HTTPS URL（`https://github.com/jim60105/HeartReverie#撰寫自訂外掛`、`https://github.com/jim60105/HeartReverie/blob/main/README.md#撰寫自訂外掛`）。

`README.md` SHALL 新增一個文字為「撰寫自訂外掛」之二級標題（`## 撰寫自訂外掛`），其下段落 SHALL 同時滿足：(a) 提及 `heartreverie-create-plugin`；(b) 提供一行安裝指令；(c) 包含一條連結至 `https://jim60105.github.io/HeartReverie/#/plugin-dev/overview`（或 `#/plugin-dev/overview#agent-skill`）。此段落建立 README 端穩定錨點 `#撰寫自訂外掛`，供 HRP 倉庫等外部來源引用。

`docs/plugin-dev/manifest.md` 與 `docs/plugin-dev/hooks.md` 兩頁 H1 之後 SHALL 各自至少出現一行指向 `plugin-dev/overview.md#agent-skill` 或等義連結之短句，提醒讀者可直接以 Agent Skill 產生樣板。

#### Scenario: plugin-dev/overview 含 `## Agent Skill` 段落且引導完整

- **WHEN** 稽核者讀取 `docs/plugin-dev/overview.md`
- **THEN** 該檔 SHALL 出現一行 `## Agent Skill`，且該標題之後至下一個同級或更高級標題之前的內容 SHALL 同時包含字串 `heartreverie-create-plugin`、字串「Agent Skill」或 `agent skill`（不區分大小寫）、一行安裝指令，以及一條指向 `README.md#撰寫自訂外掛`（或對應 HTTPS URL）之連結

#### Scenario: README 含「撰寫自訂外掛」段落

- **WHEN** 稽核者讀取 `README.md`
- **THEN** 該檔 SHALL 出現一行 `## 撰寫自訂外掛`，且該標題之後至下一個同級或更高級標題之前的內容 SHALL 包含字串 `heartreverie-create-plugin`、一行安裝指令，以及一條指向 `https://jim60105.github.io/HeartReverie/#/plugin-dev/overview`（容許含 `#agent-skill` 子錨點）之連結

#### Scenario: manifest 與 hooks 頁亦引導至 skill

- **WHEN** 稽核者對 `docs/plugin-dev/manifest.md` 與 `docs/plugin-dev/hooks.md` 各取 H1 之後前 10 行
- **THEN** 兩份檔案的該範圍內 SHALL 至少各出現一次字串 `plugin-dev/overview` 或 `heartreverie-create-plugin`

### Requirement: 文件 SHALL 採用「外掛」為唯一譯名

文件站及 `HeartReverie/README.md` 中描述 plugin 概念 SHALL 一律使用「外掛」一詞，SHALL NOT 出現「插件」。例外限縮於：(a) 引用第三方軟體既有名稱中含「插件」者，(b) `openspec/changes/archive/` 之歷史記錄，(c) `CHANGELOG.md` 中描述過往版本的條目。

#### Scenario: docs 與 README 不出現「插件」

- **WHEN** 稽核者執行 `git grep -nE '插件' -- 'docs/' 'README.md'`
- **THEN** 輸出 SHALL 為空

### Requirement: `_coverpage.md` SHALL 採 hero 截圖與四角色入口

`docs/_coverpage.md` SHALL 由下列元素組成且僅由下列元素組成：(a) 一張 hero 圖片，路徑指向 `assets/screenshots/reader-home.png`；(b) 一個 H1 標題 `HeartReverie 浮心夜夢`；(c) 一句以 `>` 開頭的 tagline；(d) 四條 Markdown 連結項目，文字依序為「自架站」「故事作者」「外掛開發者」「貢獻者」，分別指向 `self-host/installation.md`、`author/reader-ui.md`、`plugin-dev/overview.md`、`contributing/overview.md`。`_coverpage.md` SHALL NOT 包含其他內容、SHALL NOT 重述 README 介紹段落、SHALL NOT 指向舊路徑 `getting-started/installation.md`。

#### Scenario: Coverpage 結構符合規範

- **WHEN** 稽核者讀取 `docs/_coverpage.md`
- **THEN** 該檔 SHALL 含有 `![...](assets/screenshots/reader-home.png)`、`# HeartReverie 浮心夜夢`、一行 `> ` 開頭的 tagline、以及四條依序為「自架站」「故事作者」「外掛開發者」「貢獻者」之 Markdown 連結

#### Scenario: 四個入口連結指向正確新路徑

- **WHEN** 稽核者擷取 `docs/_coverpage.md` 的四條連結 URL
- **THEN** SHALL 分別為 `self-host/installation.md`、`author/reader-ui.md`、`plugin-dev/overview.md`、`contributing/overview.md`

### Requirement: `/getting-started/first-deploy` SHALL 提供首次部署 quick-start

`docs/getting-started/first-deploy.md` SHALL 為新增頁面，內容 SHALL 包含一條以編號清單呈現的 quick-start 流程，涵蓋下列里程碑且依序排列：(1) 取得容器鏡像；(2) 執行容器並設定 `PASSPHRASE`；(3) 以密語登入 Reader 首頁；(4) 於 Tools 選單建立第一個系列／故事；(5) 描述故事發展的方向（於 Reader 首頁底部的故事指令輸入框寫下接續發展意圖）；(6) 觸發一次 AI 生成；(7) 可選步驟：載入一個外掛展示擴充性。每個步驟 SHALL 至少包含一段散文說明；步驟 (3)–(5) SHALL 各嵌入至少一張對應截圖（含配方註解）。本頁 SHALL 出現於 `docs/_sidebar.md` 的「入門」分組下且位於 `overview` 與 `configuration` 之間。

#### Scenario: first-deploy 頁面存在並涵蓋七里程碑

- **WHEN** 稽核者開啟 `docs/getting-started/first-deploy.md`
- **THEN** 該檔 SHALL 包含一個編號清單，且其項目依序涵蓋「取得鏡像」「執行容器並設定 PASSPHRASE」「登入 Reader 首頁」「Tools 建立系列／故事」「描述故事發展的方向」「觸發 AI 生成」「載入外掛」七個主題

#### Scenario: first-deploy 已嵌入必要截圖

- **WHEN** 稽核者對 `docs/getting-started/first-deploy.md` 執行 `grep -c 'assets/screenshots/' <file>`
- **THEN** 計數 SHALL ≥ 3

### Requirement: 設計哲學 SHALL 限於 overview 一段散文

文件站 SHALL NOT 設立 `docs/concepts/` 目錄或任何以「概念」「Explanation」「設計哲學」為高階分組的章節。HeartReverie 的設計哲學（RPG 隨興式冒險、不以使用者意圖驅動敘事等）SHALL 僅出現在 `docs/getting-started/overview.md` 內，且 SHALL 限於不超過一段散文。

#### Scenario: 不存在 concepts 目錄

- **WHEN** 稽核者執行 `test -d docs/concepts`
- **THEN** 結果 SHALL 為非零退出碼（目錄不存在）

#### Scenario: 哲學段落只出現於 overview

- **WHEN** 稽核者於 `docs/getting-started/overview.md` 之外的 `docs/**/*.md` 中搜尋字串「設計哲學」「RPG 隨興」之一
- **THEN** 輸出 SHALL 為空

### Requirement: docs/README.md is the homepage

`docs/README.md` SHALL 由 docsify 渲染為站台首頁，內容 SHALL 含專案總覽、「文件站涵蓋什麼」一節，以及一條「開始使用」連結指向 `getting-started/overview.md`（取代舊有指向 `getting-started/installation.md` 之連結）。

#### Scenario: README 指向新的入門入口

- **WHEN** 讀者開啟站根 `docs/README.md`
- **THEN** 該頁 SHALL 含一條 Markdown 連結，文字含「開始使用」字樣，目標 SHALL 為 `getting-started/overview.md`

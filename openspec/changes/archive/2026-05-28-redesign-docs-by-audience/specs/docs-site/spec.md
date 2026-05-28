## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: The sidebar SHALL mirror the on-disk folder hierarchy

`docs/_sidebar.md` 之高階分組 SHALL 依序為 `首頁`、`入門`、`自架站`、`作者`、`外掛開發者`、`參考`、`貢獻者`，對應子目錄為（依序）`docs/`（README）、`docs/getting-started/`、`docs/self-host/`、`docs/author/`、`docs/plugin-dev/`、`docs/reference/`、`docs/contributing/`。每個位於上述子目錄底下的 `.md` 檔 SHALL 至少於 `_sidebar.md` 出現一次為相對連結。

#### Scenario: Every subpage is linked from the sidebar

- **WHEN** 稽核者列舉 `docs/getting-started/`、`docs/self-host/`、`docs/author/`、`docs/plugin-dev/`、`docs/reference/`、`docs/contributing/` 之下所有 `.md` 檔（不含 `README.md`、`_sidebar.md`、`_navbar.md`、`_coverpage.md`）
- **THEN** 每個被列舉的檔 SHALL 至少一次以相對連結形式出現於 `docs/_sidebar.md`

#### Scenario: Sidebar order matches the persona-based section order

- **WHEN** 稽核者由上而下讀取 `docs/_sidebar.md` 的高階分組標題
- **THEN** 順序 SHALL 為 `首頁`、`入門`、`自架站`、`作者`、`外掛開發者`、`參考`、`貢獻者`

### Requirement: 指定頁面 SHALL 嵌入對應截圖

下列文件頁面 SHALL 各自至少嵌入一張對應截圖（含配方註解）：`author/reader-ui.md`、`author/writer-ui.md`、`author/tools-menu.md`、`author/prompt-template.md`、`author/plugin-settings.md`、`author/builtin-plugins.md`、`plugin-dev/hook-inspector.md`、`plugin-dev/action-buttons.md`。`author/builtin-plugins.md` 因須逐一介紹每個內建外掛，SHALL 至少嵌入 4 張截圖。三種內建主題（default、light、dark）SHALL 於 `getting-started/configuration.md` 以同一場景之三張截圖呈現，SHALL NOT 為了主題比較另建獨立頁面。`author/lore-codex.md`（或同等檔名）因 `/settings/lore` 標籤聯集會跨 scope 暴露其他 NSFW 系列資料而暫不擷取畫面，SHALL NOT 列為必須嵌入截圖的頁面。

#### Scenario: 列舉的頁面都已嵌入截圖

- **WHEN** 稽核者對上列每個 `.md` 檔執行 `grep -c 'assets/screenshots/' <file>`
- **THEN** 每個檔案的計數 SHALL ≥ 1，其中 `author/builtin-plugins.md` SHALL ≥ 4

#### Scenario: 三主題以同一場景呈現

- **WHEN** 稽核者檢視 `docs/getting-started/configuration.md`
- **THEN** 該頁 SHALL 包含三段截圖配方，三者的 `url`、`viewport` 與 `capture` 欄位 SHALL 相同，僅 `theme` 與 `output` 欄位不同（值分別為 `default`、`light`、`dark`）

### Requirement: docs/README.md is the homepage

`docs/README.md` SHALL 由 docsify 渲染為站台首頁，內容 SHALL 含專案總覽、「文件站涵蓋什麼」一節，以及一條「開始使用」連結指向 `getting-started/overview.md`（取代舊有指向 `getting-started/installation.md` 之連結）。

#### Scenario: README 指向新的入門入口

- **WHEN** 讀者開啟站根 `docs/README.md`
- **THEN** 該頁 SHALL 含一條 Markdown 連結，文字含「開始使用」字樣，目標 SHALL 為 `getting-started/overview.md`

### Requirement: Internal repo references to the legacy doc paths SHALL be updated

每個出現在 *活躍* 倉庫內容（README、`AGENTS.md`、原始碼註解、`openspec/specs/` 下的主規格、skill 文件）內、指向以下舊路徑或舊 docsify 雜湊連結之引用 SHALL 於本變更內更新為對應新路徑：(a) 倉庫內檔案路徑 `docs/guides/*.md`、`docs/plugin-system/*.md`、`docs/prompt-template/*.md`、`docs/lore-codex/*.md`、`docs/deployment/*.md`、`docs/getting-started/installation.md`、`docs/getting-started/first-story.md`；(b) docsify 雜湊連結 `#/guides/...`、`#/plugin-system/...`、`#/prompt-template/...`、`#/lore-codex/...`、`#/deployment/...`、`#/getting-started/installation`、`#/getting-started/first-story`。`openspec/changes/archive/` 與 `CHANGELOG.md` 之歷史引用 SHALL 保留不動。

#### Scenario: grep 無殘留的舊路徑引用

- **WHEN** 稽核者於倉庫根執行 `git grep -nE '(docs/(guides|plugin-system|prompt-template|lore-codex|deployment)/|#/(guides|plugin-system|prompt-template|lore-codex|deployment)/|#/getting-started/(installation|first-story))' -- ':!openspec/changes/archive/' ':!CHANGELOG.md' ':!openspec/specs/docs-site/spec.md'`
- **THEN** 輸出 SHALL 為空

## REMOVED Requirements

### Requirement: The original loose docs SHALL be split into focused subpages with content preserved

**Reason**: 此條約束的舊路徑（`docs/plugin-system.md`、`docs/prompt-template.md`、`docs/lore-codex.md`、`docs/helm-deployment.md`、`docs/ci-cross-repo-trigger.md`、`docs/migration-hook-inspector.md`）早於前一次拆分變更時已被遷移至 `docs/<section>/<page>.md`；本次身份分組重整將再次重組路徑，繼續持有此條歷史拆分規則沒有實質效用。
**Migration**: 本變更引入新的「Sidebar SHALL group top-level sections by reader persona」與更新後的「Internal repo references to the legacy doc paths SHALL be updated」涵蓋所有遷移要求。

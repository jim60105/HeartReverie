## ADDED Requirements

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

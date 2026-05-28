## Context

`docs-site` 規格已建立 docsify 文件站、側邊欄結構與 GitHub Pages 部署流程，但既有頁面幾乎沒有截圖；目前 `docs/assets/` 只存放封面 `heart.webp`。讀者翻閱 Reader、Writer、Tools、Template Editor 等章節時，必須自行想像介面樣貌；貢獻者改版時也沒有視覺基準。

專案已在 `tmp/propose.md` 中採用 `agent-browser` 技能驅動 Playwright 風格的瀏覽器互動，並具備可重複的指令稿能力。Playground 目錄下大多數故事為 NSFW，唯一可公開於文件的 SFW 故事是 `悠奈悠花姊妹大冒險/放學後`。文件站採純 docsify（無 build step），所有 HTML 註解會被忽略，因此可以把「截圖配方」直接嵌入 Markdown 而不影響輸出。

## Goals / Non-Goals

**Goals:**

- 為文件站建立可重現的截圖管線：每張截圖都附帶可被自動化解析的配方註解。
- 涵蓋 Reader、Writer、Tools、Template Editor、Plugin 設定、典籍系統、三種內建主題等關鍵 UI 表面。
- 把截圖規範（配方欄位、檔名、格式、無障礙、SFW 來源）集中在一份 `docs/contributing/screenshot-recipes.md`，並置於側邊欄獨立的「貢獻者文件」區段。此頁是寫給貢獻者用的擷取規範，而非面向終端使用者的使用指南，因此 SHALL NOT 與 `guides/*` 並列。
- 維持 `docs-site` 現有原則：零執行期依賴、不破壞 Pages 部署、不引入 build step。

**Non-Goals:**

- 不在本提案內擷取任何畫面；只交付規格與任務清單。
- 不引入新的圖片壓縮工具或 CI 自動截圖管線（留待後續提案）。
- 不調整 docsify 主題或 `index.html`。
- 不涵蓋 `HeartReverie_Plugins/` 倉庫的截圖。

## Decisions

### 採用 `agent-browser` 而非自行寫 Playwright 腳本

`agent-browser` 已是專案內既有工具，使用者技能列表已收錄，且能以單一 CLI 完成導覽、等待、擷取。重寫一份 Playwright 腳本會新增 Node.js 工具鏈依賴，違反 docsify「零執行期依賴」原則。配方欄位刻意對齊 `agent-browser` 能直接消化的 selector / wait_for / capture region 語意，未來若要切換到其他工具，配方 schema 仍能轉譯。

### 配方以 docsify HTML 註解嵌入，而非獨立 YAML 檔

docsify 渲染時會忽略 HTML 註解，配方放在 Markdown 中與圖片緊鄰，使「文件—配方—圖片」三者不會走散；改版時改一處即可。獨立 YAML 索引檔的替代方案需要額外維護對應關係，並引入解析步驟。配方內容以 YAML-like 鍵值對撰寫，方便未來以 `grep` 配合 `yaml.parse` 抽取批次重跑。

### 配方欄位（schema v1）

每段配方為 `<!-- screenshot-recipe ... -->` 區塊，鍵值對以縮排表達巢狀；欄位定義：

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `schema` | 是 | 固定值 `v1`，未來欄位新增時遞增。 |
| `url` | 是 | 完整 URL（含 query 與 anchor），in-app 截圖固定以 `http://localhost:8080/` 為前綴。 |
| `viewport` | 是 | `寬x高`，桌面建議 `1440x900`，行動建議 `390x844`。 |
| `theme` | 是 | `default` / `light` / `dark` 其一。 |
| `preconditions` | 是 | 條列前置條件（容器啟動、需登入、需建立章節、需切換主題等）。 |
| `steps` | 視情況 | 條列互動步驟；除「單純載入 URL 即可呈現」之頁面外皆為必填。動詞集合：`wait_for: <selector>`、`click: <selector>`、`scroll_to: <selector>`、`type: { selector: <s>, text: <t> }`、`dismiss_modal: <selector>`、`hover: <selector>`、`set_local_storage: { key: <k>, value: <v> }`、`set_theme: <default\|light\|dark>`、`set_passphrase: <env_var_name>`（值由執行環境注入，禁止寫死）。 |
| `capture` | 是 | `viewport` / `full_page` / `selector:<CSS>` 其一。若 selector 含 `:`、`#`、`[`、`]`、`,` 或空白，SHALL 以雙引號包覆，例如 `capture: 'selector:[data-test="hook-inspector"]'`。 |
| `output` | 是 | 圖檔路徑，限定 `docs/assets/screenshots/` 之下。 |
| `captured_at` | 是 | ISO 8601 日期（例如 `2026-05-27`），SHALL NOT 為 `TBD` 或空值。 |
| `app_commit` | 是 | 擷取當下的 git commit SHA（短或長皆可），SHALL NOT 為 `TBD` 或空值。 |
| `notes` | 否 | 自由文字註記（例如「需先開啟 Hook Inspector」）。 |

未知欄位 SHALL 被解析器忽略，方便未來相容擴充。

### SFW 故事來源限制

`preconditions` 與 `contributing/screenshot-recipes.md` 都必須明文聲明：in-app 截圖 `url` 欄位 SHALL 符合下列 allow-list 之一（前綴比對，可帶 query 與 anchor）：

1. `http://localhost:8080/悠奈悠花姊妹大冒險/放學後/`（唯一許可的故事頁）
2. `http://localhost:8080/tools`、`http://localhost:8080/tools/new-series`、`http://localhost:8080/tools/import-character-card`
3. `http://localhost:8080/settings/`（含子路徑，例如 `settings/template-editor`、`settings/plugins`）
4. `http://localhost:8080/`（首頁，僅在沒有顯示其他故事縮圖時）

凡 URL 不在上列前綴內、或畫面（含側邊欄、最近開啟清單、章節下拉、列表縮圖）會出現除「悠奈悠花姊妹大冒險／放學後」以外的故事或章節名稱者，皆 SHALL NOT 用於文件。實作時 SHALL 透過 `preconditions` 顯式設定 `set_local_storage` 或 UI 操作，清除非 SFW 故事的最近紀錄。

### 頁面 → 截圖對應

下表同時列出「需要截圖」與「明確不截圖」的頁面，避免後續貢獻者重複討論：

**需要截圖：**

| 文件頁面 | 截圖檔（`docs/assets/screenshots/` 下） | 主題 |
| --- | --- | --- |
| `guides/reader-ui.md` | `reader-home.png`、`reader-chapter-view.png` | default |
| `guides/writer-ui.md` | `writer-editor.png`、`writer-generate-flow.png`、`writer-action-buttons.png` | default |
| `guides/tools-menu.md` | `tools-menu.png`、`tools-new-series.png`、`tools-import-character-card.png` | default |
| `guides/template-editor.md`、`prompt-template/template-editor.md` | `template-editor-overview.png` | default |
| `plugin-system/settings.md` | `plugin-settings-list.png`、`plugin-settings-detail.png` | default |
| `plugin-system/hook-inspector.md` | `hook-inspector.png` | default |
| `plugin-system/action-buttons.md` | `plugin-action-buttons.png` | default |
| `plugin-system/builtin-catalog.md` | `plugin-dialogue-colorize.png`、`plugin-reading-progress.png` | default |
| `getting-started/configuration.md` | `theme-default.png`、`theme-light.png`、`theme-dark.png`（同一場景三主題） | 三主題各一 |
| `README.md`（首頁） | 不新增（封面 `heart.webp` 已涵蓋 hero） | — |

**明確不截圖：**

| 頁面 | 理由 |
| --- | --- |
| `getting-started/installation.md`、`getting-started/first-story.md` | 內容以指令與檔案結構為主，散文已足夠表達。 |
| `prompt-template/*`（除 `template-editor.md`、`lore-in-template-editor.md` 外） | 概念說明，無對應 UI 表面。 |
| `lore-codex/*`（含 `overview.md`） | 目前 `/settings/lore` 介面的標籤聯集會跨 scope 顯示其他 NSFW 系列資料，違反 SFW 來源限制；在隔離的 SFW-only playground 完成前，這個區段不擷取畫面。直接以散文說明即可。 |
| `plugin-system/*`（除上表列舉者外） | 介紹規格、流程與架構，無 UI。 |
| `deployment/*`、`migrations/*` | 部署與遷移文件，畫面截圖無助於理解。 |
| `prompt-template/lore-in-template-editor.md`、`prompt-template/editing-in-ui.md` | 重複截圖會與 `template-editor.md` 衝突；改以連結指向該頁。 |

> **本提案 SHALL NOT 在文件中保留「為何此頁無截圖」之類的可見散文或 HTML 註解**：終端使用者不需要知道為什麼某頁缺圖。內部擷取限制（例如 SFW playground 缺漏、CodeMirror 互動序列不穩定）若需追蹤，應記錄在本提案、Issue 或 `contributing/screenshot-recipes.md` 的工作流章節，而非塞回面向讀者的頁面內。

### 檔案格式與大小

UI 截圖一律 PNG，寬度上限 2048px，採用 docsify 標準 `![alt](path)` 嵌入。docsify 不支援屬性語法，因此本提案 SHALL NOT 承諾 `loading="lazy"`；以「寬度上限」與「每頁圖數控管」作為載入時間的主要約束。WebP 僅允許用於裝飾性 hero / coverpage（不在 `screenshots/` 目錄下）。

### 替代文字與隨圖散文

替代文字（alt）為中文描述性文字，字元數 SHALL ≤ 30 字（半形與全形皆以 1 字元計），敘述畫面內容而非畫面用途；例如 `Reader 章節閱讀畫面，顯示左側目錄與右側內文`。整段 alt SHALL NOT 等於、SHALL NOT 以「截圖」「畫面」「圖片」結尾，亦 SHALL NOT 為空。

每張截圖周邊 SHALL 有散文段落或 `> caption` 引言說明該畫面對應的功能與操作意義；文件 SHALL NOT 以「貼圖代替說明」。配方撰寫指南頁列出範例與反例（至少三組好的 alt 與三組該避免的 alt）。

## Risks / Trade-offs

- **截圖過時**：UI 改版後配方仍可重跑，但若沒有 CI 觸發機制，仍需仰賴 PR 流程提醒。→ 在 `contributing/screenshot-recipes.md` 明列「修改 UI 元件時須一併重跑相關配方」並列在 `AGENTS.md` 預期工作流（後續提案再導入 CI）。
- **資產體積膨脹**：大量 PNG 會增加 repo 大小與 Pages 部署時間。→ 限制寬度 ≤ 2048px、嚴格列出截圖清單（不開放隨意新增）、hero 改 WebP。
- **配方 schema 演進**：日後若要新增欄位（例如 `device_scale_factor`），舊配方需相容。→ 採「未知欄位忽略」策略，並在指南頁標註 `schema: v1`。
- **SFW 限制被違反**：貢獻者誤用其他 playground 故事擷取。→ 指南頁與配方欄位 `url` 的範例都鎖在指定 URL；PR 審查時以 `grep` 檢查 `localhost:8080/` 後是否為允許前綴。
- **agent-browser 與實際瀏覽器渲染差異**：字型、emoji 可能不同。→ 在指南頁建議使用容器內預設字型，並要求擷取時關閉系統字型替換。

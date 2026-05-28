## Why

目前 `docs/` 以主題分區（使用指南、Plugin 系統、Prompt 模板、典籍系統……），把讀者、自架站管理員、外掛開發者的內容混在同一區塊；自架管理員找不到部署資訊、作者翻不到內建外掛說明、外掛開發者得從一堆使用者頁面之間挖出 API。再加上 `guides/template-editor.md` 對入門者太進階卻擺在「使用指南」、`prompt-template/template-editor.md` 與其內容重複、`plugin-system/builtin-catalog.md` 對 8 個內建外掛只給一行清單，弱頁面拖累整站可信度。文件也缺一條從拉鏡像到寫完第一章的 quick-start，新使用者必須自行串起部署、登入、建立故事三段內容。此外名詞「插件／外掛」混用，與 README 已定調的「外掛」不一致。

## What Changes

- **BREAKING**：以讀者身份重組 sidebar 高階分組為「入門 / 自架站 / 作者 / 外掛開發者 / 參考 / 貢獻者」六區，取代既有以主題為高階分組的結構；Diátaxis 改作每區內部的次要分軸。
- 新增 `/getting-started/first-deploy` 一條龍 quick-start：拉鏡像 → 跑容器 → 設密語 → 登入 → Tools 選單建立第一個故事 → Writer UI 寫第一章 → 可選啟用一個 HRP 外掛展示擴充性。
- 將 `guides/template-editor.md` 與 `prompt-template/template-editor.md` 合併進 `author/prompt-template`；移除兩份重複頁面。
- 將 `plugin-system/builtin-catalog.md` 大幅展開為 `author/builtin-plugins`，逐一介紹 8 個內建外掛的用途、設定欄位與截圖。
- 將 `plugin-system/*` 拆解：使用者面向章節（settings、action-buttons UI、builtin-catalog、hook-inspector 入口）移到 `author/`；開發者面向章節（manifest、hooks、frontend-render、API 路由、authoring-guide、安全機制）移到 `plugin-dev/`。
- `plugin-dev/overview` 開頭以一段明確指引帶讀者安裝 `heartreverie-create-plugin` Agent Skill，把該 skill 定位為撰寫外掛的起點。
- 新增 `self-host/` 區塊整理安裝、環境變數、`PLUGIN_DIR`、外接 OpenAI 相容 LLM、`playground/` 備份等自架管理員主題。
- 新增 `reference/` 區塊收容 API 端點、環境變數字典、`scripts/` CLI 一覽。
- 重寫 `_coverpage.md`：hero 截圖（沿用 `assets/screenshots/reader-home.png`）+ 一句話 tagline + 四角色入口連結（自架站、作者、外掛開發者、貢獻者）。README 維持現行篇幅與結構。
- 名詞統一以「外掛」取代任何殘留的「插件」。
- 不開設 `/concepts/` 區塊；設計哲學以一段次口帶過放在 `getting-started/overview`。

## Capabilities

### New Capabilities

（無；本變更只調整既有 `docs-site` 規格。）

### Modified Capabilities

- `docs-site`：sidebar 分組改以讀者身份為高階分軸；新增首次部署 tutorial、coverpage、外掛開發 skill 引導、名詞統一等要求；移除以 `guides/template-editor.md` 與 `plugin-system/builtin-catalog.md` 為旗艦頁的舊規範。

## Impact

- 影響檔案：`docs/_sidebar.md`、`docs/_coverpage.md`、`docs/README.md`（小幅調整 Get Started 連結指向）、`docs/getting-started/`（新增 `first-deploy.md`、整理 `overview.md`）、新增 `docs/self-host/`、`docs/author/`、`docs/plugin-dev/`、`docs/reference/`、`docs/contributing/`（新增 `openspec.md`），原 `docs/guides/`、`docs/plugin-system/`、`docs/prompt-template/`、`docs/lore-codex/`、`docs/deployment/`、`docs/migrations/` 內容遷移後刪除。
- 影響 spec：`openspec/specs/docs-site/spec.md` 之 sidebar 順序、旗艦頁清單、截圖嵌入清單等多條既有要求。
- 影響 README：`HeartReverie/README.md` 中指向 `#/plugin-system/overview` 的連結需改指新路徑（細節列入 apply phase tasks）。
- 不影響：後端、前端、外掛執行階段；HRP 倉庫（HRP 將另開平行提案）；既有 GitHub Actions Pages workflow。
- 不提供向後相容轉址，因尚無公開使用者依賴舊路徑。

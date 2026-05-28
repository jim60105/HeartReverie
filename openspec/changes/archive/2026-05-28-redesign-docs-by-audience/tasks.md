# Tasks — redesign-docs-by-audience

## 1. 骨架與目錄

- [x] 1.1 建立新目錄：`docs/self-host/`、`docs/author/`、`docs/plugin-dev/`、`docs/reference/`
- [x] 1.2 確認 `docs/getting-started/`、`docs/contributing/`、`docs/migrations/` 仍存在；不再保留 `docs/guides/`、`docs/plugin-system/`、`docs/prompt-template/`、`docs/lore-codex/`、`docs/deployment/`（檔案搬完後刪空目錄）

## 2. 入門（getting-started）

- [x] 2.1 整理 `getting-started/overview.md`：保留總覽，加入一段（≤ 1 段）次口帶過的設計哲學（RPG 隨興式冒險、不以使用者意圖驅動敘事）
- [x] 2.2 新增 `getting-started/first-deploy.md`，七步 quick-start：(1) 取得鏡像 (2) 執行容器並設定 `PASSPHRASE` (3) 登入 Reader 首頁 (4) Tools 建立系列／故事 (5) Writer UI 寫第一章 (6) 觸發 AI 生成 (7) 選用：載入外掛
- [x] 2.3 嵌入 `reader-home.png`、`tools-menu.png`、`writer-editor.png` 等既有截圖至 `first-deploy.md`；補拍 `first-deploy-terminal.png`、`first-deploy-login.png`
- [x] 2.4 整理 `getting-started/configuration.md`：保留現有三主題截圖區段

## 3. 自架站（self-host）

- [x] 3.1 將 `getting-started/installation.md` 搬至 `self-host/installation.md`，並更新內部連結
- [x] 3.2 新增 `self-host/configuration.md`：收錄環境變數與 `PLUGIN_DIR` 說明
- [x] 3.3 新增 `self-host/external-llm.md`：OpenAI 相容代理設定
- [x] 3.4 新增 `self-host/backup-and-data.md`：`playground/` 結構、備份回復
- [x] 3.5 搬遷 `deployment/helm.md` → `self-host/helm.md`
- [x] 3.6 搬遷 `deployment/ci-cross-repo-trigger.md` → `self-host/ci-cross-repo-trigger.md`

## 4. 作者（author）

- [x] 4.1 搬遷 `guides/reader-ui.md` → `author/reader-ui.md`
- [x] 4.2 搬遷 `guides/writer-ui.md` → `author/writer-ui.md`
- [x] 4.3 搬遷 `guides/writing-stories.md` → `author/writing-stories.md`
- [x] 4.4 搬遷 `guides/tools-menu.md` → `author/tools-menu.md`
- [x] 4.5 整併 `lore-codex/*.md` → `author/lore-codex.md` 主頁＋必要技術子頁；於主頁加入「為何要 Lore Codex」一段引導
- [x] 4.6 合併 `guides/template-editor.md` 與 `prompt-template/*.md`（含 `template-editor.md`、`overview.md`、`variables.md`、`vento-syntax.md`、`editing-in-ui.md`、`build-pipeline.md`、`lore-rendering.md`、`lore-in-template-editor.md`）→ `author/prompt-template.md`（單頁或主頁＋子頁皆可）；嵌入 `template-editor-overview.png`
- [x] 4.7 大幅展開 `plugin-system/builtin-catalog.md` → `author/builtin-plugins.md`：每個內建外掛（脈絡壓縮、對話高亮、閱讀進度、潤稿、回應通知、起手提示、思考摺疊、使用者訊息管理）獨立段落，含用途、設定欄位與截圖；既有可重用截圖 `plugin-action-buttons.png`、`plugin-dialogue-colorize.png`、`plugin-reading-progress.png`、`plugin-settings-detail.png`；補拍其餘四個外掛截圖（`author-builtin-plugin-*.png`）
- [x] 4.8 拆分 `plugin-system/settings.md` 使用者面向 → `author/plugin-settings.md`；嵌入 `plugin-settings-list.png`
- [x] 4.9 拆分 `plugin-system/action-buttons.md` 使用者面向 → `author/action-buttons.md`；嵌入 `writer-action-buttons.png`

## 5. 外掛開發者（plugin-dev）

- [x] 5.1 新增 `plugin-dev/overview.md`：H1 後設 `## Agent Skill` 段落，含一句定位、安裝指令 `npx skills add https://github.com/jim60105/HeartReverie -s heartreverie-create-plugin`、以及兩三句描述 `heartreverie-create-plugin` 產出範圍（manifest、hook 樣板、prompt fragment）；段落錨點為 `#agent-skill`，並在結尾連結 `README.md#撰寫自訂外掛`
- [x] 5.2 搬遷 `plugin-system/manifest.md` → `plugin-dev/manifest.md`；頂部加一行短句連回 `plugin-dev/overview.md#agent-skill`
- [x] 5.3 搬遷 `plugin-system/hooks.md` → `plugin-dev/hooks.md`；頂部加一行短句連回 `plugin-dev/overview.md#agent-skill`
- [x] 5.4 合併 `plugin-system/frontend-render.md` 與 `plugin-system/frontend-styles.md` → `plugin-dev/frontend-register.md`
- [x] 5.5 拆分 `plugin-system/action-buttons.md` 開發者面向 → `plugin-dev/action-buttons.md`
- [x] 5.6 搬遷 `plugin-system/hook-inspector.md` → `plugin-dev/hook-inspector.md`；嵌入 `hook-inspector.png`
- [x] 5.7 拆分 `plugin-system/settings.md` 開發者面向 → `plugin-dev/settings.md`
- [x] 5.8 搬遷 `plugin-system/custom-api-routes.md` → `plugin-dev/api-routes.md`
- [x] 5.9 搬遷 `plugin-system/security.md`、`external-plugins.md`、`authoring-guide.md`、`discovery-and-loading.md`、`prompt-fragments.md`、`strip-tags.md` 至 `plugin-dev/` 對應檔名
- [x] 5.10 刪除空的 `docs/plugin-system/` 目錄

## 6. 參考（reference）

- [x] 6.1 將 `plugin-system/api-endpoints.md` 端點清單併入 `reference/api.md`，並補上後端核心端點
- [x] 6.2 新增 `reference/configuration.md`：環境變數字典
- [x] 6.3 新增 `reference/cli-scripts.md`：列出 `scripts/*` 用途

## 7. 貢獻者（contributing）

- [x] 7.1 新增 `contributing/overview.md`：貢獻流程入口
- [x] 7.2 保留 `contributing/screenshot-recipes.md` 原樣
- [x] 7.3 新增 `contributing/openspec.md`：簡介 OpenSpec workflow，連結至 `openspec/AGENTS.md`
- [x] 7.4 將 `migrations/hook-inspector.md` 留在原處；於 `_sidebar.md` 「貢獻者」分組下列入連結

## 8. 名詞統一

- [x] 8.1 `git grep -nE '插件' -- 'docs/' 'README.md'` 逐一改為「外掛」
- [x] 8.2 再次以 `git grep` 確認 `docs/` 與 `README.md` 不再出現「插件」

## 9. Sidebar、Coverpage、README

- [x] 9.1 重寫 `docs/_sidebar.md`：高階分組依序為 `首頁`、`入門`、`自架站`、`作者`、`外掛開發者`、`參考`、`貢獻者`；每個分組下列出對應子目錄之 `.md` 檔
- [x] 9.2 重寫 `docs/_coverpage.md`：hero 圖 `assets/screenshots/reader-home.png` + H1 + tagline + 四角色入口連結（自架站／故事作者／外掛開發者／貢獻者）
- [x] 9.3 修改 `docs/README.md`：將「開始使用」連結指向 `getting-started/overview.md`（取代 `getting-started/installation.md`）
- [x] 9.4 修改 `README.md`：(a) 新增 `## 撰寫自訂外掛` 段落，內含 `heartreverie-create-plugin` 名稱、一句定位（產出 manifest／hook 樣板／prompt fragment）、安裝指令、以及連結 `https://jim60105.github.io/HeartReverie/#/plugin-dev/overview` 之段落，建立穩定錨點 `#撰寫自訂外掛`；(b) 將既有 `#/plugin-system/overview` 改為 `#/plugin-dev/overview`；(c) 把任何指向 `guides/`、`prompt-template/`、`lore-codex/`、`deployment/` 之連結改為新路徑
- [x] 9.5 `git grep` 確認倉庫無殘留舊路徑（排除 `archive/` 與 `CHANGELOG.md`）

## 10. 驗證

- [x] 10.1 `npx docsify-cli serve docs` 於 `HeartReverie/` 啟動；逐一點開新 sidebar 每個連結，無 404
- [x] 10.2 `grep -c 'assets/screenshots/' docs/author/builtin-plugins.md` ≥ 4
- [x] 10.3 `grep -c 'assets/screenshots/' docs/getting-started/first-deploy.md` ≥ 3
- [x] 10.4 `test ! -d docs/concepts`、`test ! -d docs/guides`、`test ! -d docs/plugin-system`、`test ! -d docs/prompt-template`、`test ! -d docs/lore-codex`、`test ! -d docs/deployment`
- [x] 10.5 `openspec validate redesign-docs-by-audience --strict` 通過
- [x] 10.6 `deno task fmt && deno task lint` 通過

## Context

`HeartReverie/docs/` 是 docsify 單頁站，目前以主題分區（使用指南、Plugin 系統、Prompt 模板、典籍系統、部署、遷移）排列。本次重整在腦力激盪階段（`tmp/doc-redesign-brainstorm.md`）由使用者確認以下決策：以讀者身份為高階分組、不開設 `/concepts/` 區塊、名詞統一為「外掛」、coverpage 採 hero 截圖＋四角色入口、外掛開發頁面導向 `heartreverie-create-plugin` Agent Skill、新增 quick-start tutorial。本變更僅調整 `docs-site` 規格與 `docs/` 內部編排，不更動執行階段、後端 API、外掛載入流程，也不觸及 HRP 倉庫（HRP 將另開平行提案）。

現行 `docs-site` 規格已要求 sidebar 順序、強制旗艦頁嵌入截圖、`screenshot-recipes` 配方等。本次需要把以主題為單位的 sidebar 規則與旗艦頁清單一併重寫，並新增本次身份分組相關的要求。

## Goals / Non-Goals

**Goals:**

- 讓四類讀者各自有專屬區塊入口：自架站管理員、故事作者、外掛開發者、引擎貢獻者。
- 入門者能沿一條從拉鏡像到寫完第一章的步驟完成首次部署。
- 外掛撰寫指南把 `heartreverie-create-plugin` Agent Skill 當作起點。
- 「外掛」為唯一譯名，移除「插件」。
- coverpage 以 hero 截圖＋四角色入口呈現，不複製 README 內容。

**Non-Goals:**

- 不提供舊路徑轉址或相容層（尚無公開讀者依賴舊網址）。
- 不重新撰寫個別頁面的技術內容，只搬遷、合併、刪除與導語調整。
- 不開設 `/concepts/` 區塊；設計哲學一段帶過放在 `/getting-started/overview`。
- 不處理 HRP 倉庫的文件結構。

## Decisions

### 決策一：sidebar 高階分組以讀者身份切

採用「入門 / 自架站 / 作者 / 外掛開發者 / 參考 / 貢獻者」六區。Diátaxis 改作每區內部的次要分軸。理由：腦力激盪表上四個讀者群（自架站管理員、作者、外掛開發者、引擎貢獻者）對文件路徑的期望差異最大，主題式高階分組導致每群人都得橫掃多區。替代方案是維持以主題分區、額外加 persona 標籤；被否決的理由是 sidebar 仍會混雜，且 docsify 對標籤過濾支援不足。

### 決策二：新資訊架構

| 舊路徑 | 新路徑 | 動作 |
| --- | --- | --- |
| `getting-started/installation.md` | `self-host/installation.md` | 搬遷 |
| `getting-started/configuration.md` | `getting-started/configuration.md` | 保留 |
| `getting-started/first-story.md` | `getting-started/first-deploy.md`（重寫擴大） | 整併並擴大為 quick-start tutorial |
| （新增） | `getting-started/overview.md` | 新增；含一段次口帶過的設計哲學 |
| `guides/writing-stories.md` | `author/writing-stories.md` | 搬遷 |
| `guides/reader-ui.md` | `author/reader-ui.md` | 搬遷 |
| `guides/writer-ui.md` | `author/writer-ui.md` | 搬遷 |
| `guides/tools-menu.md` | `author/tools-menu.md` | 搬遷 |
| `guides/template-editor.md` | `author/prompt-template.md` | 併入（與 `prompt-template/*` 一同） |
| `lore-codex/overview.md` 等 6 頁 | `author/lore-codex.md`（單頁整併）或維持子目錄 `author/lore-codex/*` | 搬遷；技術子主題保留為子頁 |
| `prompt-template/overview.md`、`variables.md`、`vento-syntax.md`、`editing-in-ui.md`、`build-pipeline.md`、`lore-rendering.md`、`template-editor.md`、`lore-in-template-editor.md` | `author/prompt-template.md` 與 `author/prompt-template/*` 子頁 | 搬遷並合併 template-editor |
| `plugin-system/builtin-catalog.md` | `author/builtin-plugins.md` | 大幅展開；每個內建外掛獨立段落 + 截圖 |
| `plugin-system/settings.md` | `author/plugin-settings.md` | 搬遷（使用者面向） |
| `plugin-system/action-buttons.md` | `author/action-buttons.md` 與 `plugin-dev/action-buttons.md` | 拆分，使用者面向部分入 author、開發者面向部分入 plugin-dev |
| `plugin-system/hook-inspector.md` | `plugin-dev/hook-inspector.md` | 搬遷 |
| `plugin-system/overview.md` | `plugin-dev/overview.md` | 搬遷並於開頭新增 Agent Skill 引導段 |
| `plugin-system/manifest.md` | `plugin-dev/manifest.md` | 搬遷 |
| `plugin-system/hooks.md` | `plugin-dev/hooks.md` | 搬遷 |
| `plugin-system/frontend-render.md`、`frontend-styles.md` | `plugin-dev/frontend-register.md`（合併） | 合併並重新命名 |
| `plugin-system/custom-api-routes.md`、`api-endpoints.md` | `plugin-dev/api-routes.md`、`reference/api.md` | 拆分；端點清單入 reference |
| `plugin-system/security.md`、`external-plugins.md`、`authoring-guide.md`、`discovery-and-loading.md`、`prompt-fragments.md`、`strip-tags.md` | `plugin-dev/*` 對應檔 | 搬遷 |
| `deployment/helm.md`、`deployment/ci-cross-repo-trigger.md` | `self-host/helm.md`、`self-host/ci-cross-repo-trigger.md` | 搬遷 |
| `migrations/hook-inspector.md` | `migrations/hook-inspector.md` | 保留（歷史性質） |
| `contributing/screenshot-recipes.md` | `contributing/screenshot-recipes.md` | 保留 |
| （新增） | `self-host/configuration.md`、`self-host/external-llm.md`、`self-host/backup-and-data.md` | 新增 |
| （新增） | `reference/api.md`、`reference/configuration.md`、`reference/cli-scripts.md` | 新增 |
| （新增） | `contributing/overview.md`、`contributing/openspec.md` | 新增 |
| （新增） | `plugin-dev/settings.md`（開發者面向 settings 規格） | 新增 |

最終 sidebar 順序固定為：`首頁` → `入門` → `自架站` → `作者` → `外掛開發者` → `參考` → `貢獻者`。

### 決策三：Coverpage

`_coverpage.md` 內容限定：

```
![hero](assets/screenshots/reader-home.png)

# HeartReverie 浮心夜夢

> AI 驅動的 RPG 故事冒險引擎

- [自架站 →](self-host/installation.md)
- [故事作者 →](author/reader-ui.md)
- [外掛開發者 →](plugin-dev/overview.md)
- [貢獻者 →](contributing/overview.md)
```

四個入口連結文字固定為「自架站」「故事作者」「外掛開發者」「貢獻者」，順序對應四類讀者優先序。

### 決策四：Quick-start tutorial 流程

`getting-started/first-deploy.md` 採七段：

1. 前置條件（Podman 或 Docker、80MB 鏡像、Open 8080 連接埠）。
2. 拉鏡像並啟動容器（一行 `podman run ...`，含 `PASSPHRASE` 環境變數設定）。
3. 開啟瀏覽器、以密語登入、看到 Reader 首頁（截圖：`reader-home.png`）。
4. 用 Tools 選單建立第一個系列／故事（截圖：`tools-menu.png`、`tools-new-series.png`）。
5. 切換 Writer UI 寫第一章（截圖：`writer-editor.png`）。
6. 觸發一次生成、看 AI 回填章節（截圖：`writer-generate-flow.png`）。
7. 可選：掛上一個 HRP 外掛展示擴充性（連回 self-host/installation 的 PLUGIN_DIR 段落）。

### 決策五：外掛開發引導 Agent Skill

`plugin-dev/overview.md` 在 H1 之後 SHALL 設一個 `## Agent Skill` 二級標題段落，內容涵蓋：(a) 一句話定位該 skill 為撰寫第三方外掛的起點；(b) 安裝指令 `npx skills add https://github.com/jim60105/HeartReverie -s heartreverie-create-plugin`；(c) 對 `heartreverie-create-plugin` 用途的兩三句描述（產出 manifest、hook 樣板、prompt fragment 範例）。該段同時提供穩定錨點 `#agent-skill`，供其他文件與 HRP 倉庫引用。

同時，`README.md` SHALL 新增 `## 撰寫自訂外掛` 段落，內容為一句定位＋skill 名稱＋指向文件站 `#/plugin-dev/overview` 的連結，建立 README 端的穩定錨點 `#撰寫自訂外掛`。HRP 倉庫可擇一引用：HR 文件站錨點 `#/plugin-dev/overview#agent-skill`，或 README 錨點 `#撰寫自訂外掛`。

`plugin-dev/manifest.md` 與 `plugin-dev/hooks.md` 的 H1 之後 SHALL 各自出現一行短句＋連結，指回 `plugin-dev/overview.md#agent-skill`，避免讀者錯過 skill 引導。

### 決策六：名詞統一

全文以「外掛」為唯一譯名，禁止出現「插件」。實作階段以 `git grep -n '插件' docs/ README.md` 驗收。spec 中加一條 grep 場景。

### 決策七：截圖盤點

重用既有截圖（不需要新拍）：

- `reader-home.png`：coverpage hero、`first-deploy` 步驟 3、`author/reader-ui`
- `tools-menu.png`、`tools-new-series.png`、`tools-import-character-card.png`：`first-deploy` 步驟 4、`author/tools-menu`
- `writer-editor.png`、`writer-generate-flow.png`、`writer-action-buttons.png`：`first-deploy` 步驟 5–6、`author/writer-ui`
- `template-editor-overview.png`：`author/prompt-template`
- `plugin-settings-list.png`、`plugin-settings-detail.png`、`plugin-action-buttons.png`、`plugin-dialogue-colorize.png`、`plugin-reading-progress.png`：`author/builtin-plugins`、`author/plugin-settings`
- `hook-inspector.png`：`plugin-dev/hook-inspector`
- `reader-chapter-view.png`：`author/writing-stories`
- `theme-default.png`、`theme-light.png`、`theme-dark.png`：`getting-started/configuration`

新截圖需求（列入 apply phase tasks，配方規範依現行 docs-site spec 既有要求填寫）：

- `first-deploy-terminal.png`：終端機顯示 `podman run` 啟動畫面（步驟 2）。
- `first-deploy-login.png`：登入畫面輸入密語（步驟 3）。
- `author-builtin-plugin-*.png`：補齊 8 個內建外掛尚無截圖者（脈絡壓縮、潤稿、回應通知、起手提示、思考摺疊、使用者訊息管理；對應檔名 kebab-case）。

### 決策八：HRP 不在本提案範圍

HRP 倉庫將開立同名 `redesign-docs-by-audience` 平行提案，獨立進行；兩倉庫之間僅以連結互引，不共用 sidebar 或樣式。本提案不更動任何 `HeartReverie_Plugins/` 檔案。

## Risks / Trade-offs

- [失去舊路徑連結] → 不提供轉址；公告於 CHANGELOG，README 與 GitHub Pages 著陸頁同步更新。已確認無公開讀者倚賴舊路徑。
- [`/concepts/` 缺席導致設計哲學說明散落] → 約束哲學只能出現在 `/getting-started/overview` 一處且不超過一段，避免在其他頁面擴張。
- [Agent Skill 引導與 plugin-dev 散文重複] → 規範僅 `plugin-dev/overview` 必須完整一段，其他頁面只允一句指引＋連結，避免文意贅述。
- [一頁多角色（如 `author/prompt-template` 同時服務作者與外掛開發者）] → 在頁首明示主要對象為作者，外掛開發者向章節以連結指回 `plugin-dev/`。
- [合併 `template-editor` 兩份來源後內容衝突] → apply phase 以「保留 `prompt-template/template-editor.md` 技術細節為主、`guides/template-editor.md` 補入門段」原則合併。

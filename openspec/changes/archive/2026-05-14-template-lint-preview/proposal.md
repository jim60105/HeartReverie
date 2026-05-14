## Why

作者修改 `system.md`、plugin `promptFragments`、或 lore 篇章中的 Vento 模板時，目前必須先存檔再跑一次 chat 才能發現語法錯誤、未知變數、或 `{{ message }}` 配對失誤，迭代成本高且容易破壞既有故事。同時，`writer/lib/template.ts:41-91` 的 `validateTemplate()` 已在主模板強制 SSTI 白名單，但 plugin fragment 在 `renderSystemPrompt()` 內**沒有**經過同一道驗證（`writer/lib/template.ts:180-200`）—— 這是一個現存的安全縫隙。本 change 同時關掉這道縫，並提供瀏覽器內的 lint／preview 工具。

## What Changes

- 新增 writer-mode 模板編輯／lint／preview 工具，元件為 CodeMirror 6 + Vento 自訂 tokenizer。
- 新增後端 endpoints：`GET /api/templates`、`GET /api/templates/variables`、`POST /api/templates/lint`、`POST /api/templates/preview`、`PUT /api/templates`。
- 引入 `writer/lib/template-lint.ts`（lint pipeline、AST walk、變數 catalog）、`writer/lib/template-preview.ts`（純函式 `renderSystemPromptForPreview` 三模式：`default` / `inline` / `current`）、`writer/lib/path-safety.ts`（從 `plugin-manager.ts:61-64` 抽出 `isPathContained`）。
- 擴充 `writer/vendor/ventojs.d.ts` 加上 `compile()` ambient signature；lint pipeline 改採 `compile()` AST 路徑，不再 `runString` dry-run。
- 新增前端 `/settings/template-editor` 頁，三欄佈局（templates ／ editor ／ preview），重用 `PromptPreview.vue` 渲染樣式。
- 新增 helper drift CI 檢查 `scripts/check-vento-helpers.ts`，比對 `VENTO_HELPERS` const 與 ventojs 實際 filter 集合。
- **BREAKING**：`PluginManager.init()` 在登錄 hook 與載入 backend module **之前**，對每個 plugin 的 `promptFragments[].file` source 強制呼叫 `validateTemplate()`；非空即從 `#plugins` 中移除該 plugin（log error，不註冊 hook／settings／fragment）。`renderSystemPrompt()` 在每次組合 fragment 前再驗一次（縱深防禦，攔住載入後檔案被改動或 fragment 字串透過動態手段組裝的情況）。任何 plugin 若 `promptFragments` 含非白名單表達式（`set` / `/set` / `include` / `{{> jsExpression }}`）將無法載入。
- **BREAKING**：`validateTemplate()` 規格收緊，docs（`docs/prompt-template.md`）中所有 `set` + `include` 範例刪除；改寫為以具名變數、plugin fragment、`getDynamicVariables()` 注入的等價寫法。
- **BREAKING**：Plugin fragment 在 Template Editor 中**嚴格 read-only**。`PUT /api/templates` 收到 `plugin:<name>:…` 前綴一律回 403；不提供「另存」或 fork-then-overlay。
- Lore 篇章（`lore:global:<rel>`、`lore:series:<series>:<rel>`、`lore:story:<series>:<story>:<rel>`，三種 scope 對應 `playground/_lore/`、`playground/<series>/_lore/`、`playground/<series>/<story>/_lore/`）納入 lint / preview pipeline，catalog 限制為「第一輪 snapshot」變數集（`lore_*` + `series_name` + `story_name`），對齊引擎實際渲染順序。
- 寫入路徑採 atomic write + backup（`.bak` / `.bak.<ts>`）+ symlink 拒收，與 `writer/lib/story.ts:124-135` 對齊。
- 文件、release notes 同步更新；release notes 必須列出 plugin runtime SSTI 影響的 fragment 路徑與遷移步驟。

## Capabilities

### New Capabilities

- `template-editor`: writer-mode 內的 Vento 模板 lint／preview／編輯工具與其後端 endpoint、UI 路由、變數 catalog API、fixture 系統，以及對主模板與 lore 篇章的寫入 contract。

### Modified Capabilities

- `vento-prompt-template`: 明定 `set` / `/set` / `include` / `{{> jsExpression }}` 為禁用語法（SSTI 白名單）；lint pipeline 採 `compile()` AST 路徑；lore 篇章可用 `lore:global:<rel>`、`lore:series:<series>:<rel>`、`lore:story:<series>:<story>:<rel>` 路徑送進 lint。
- `vento-message-tag`: 把 `multi-message:nested` / `multi-message:invalid-role` Vento parse-time 錯誤對映為 `vento.message-nested` / `vento.message-invalid-role` lint diagnostic；保留 runtime 錯誤標籤名稱。
- `prompt-editor`: 與 `/settings/template-editor` 並列；明定兩個 editor 的責任邊界（prompt-editor 編 chat history 卡片，template-editor 編模板原始碼）。
- `prompt-preview`: 既有 preview endpoint 維持服務 prompt-editor；新增的 `POST /api/templates/preview` 走純函式 fixture 渲染（不接 plugin pipeline / storyDir IO，除非 `mode: "current"`）。
- `file-based-prompt-storage`: 寫入路徑擴展到 lore 篇章；plugin fragment 永遠不可寫；明定 atomic write + backup + symlink 拒收的安全契約。
- `plugin-core`: plugin fragment 在 Template Editor 中 read-only；`PluginManager.init()` 在註冊 hook 前對每個 fragment source 強制 `validateTemplate()`（失敗即不註冊）；`renderSystemPrompt()` 每次組合 fragment 前再驗一次。
- `lore-storage`: lore 篇章可在 Template Editor 中以 `lore:global:<rel>`、`lore:series:<series>:<rel>`、`lore:story:<series>:<story>:<rel>` 路徑進行 lint / preview / 寫入（catalog 為第一輪 snapshot 變數集）。

## Impact

- **後端**：
  - 新增 `writer/routes/templates.ts`、`writer/lib/template-lint.ts`、`writer/lib/template-preview.ts`、`writer/lib/path-safety.ts`、`writer/fixtures/template-preview.json`。
  - 修改 `writer/lib/plugin-manager.ts`（強制 SSTI；抽出 `isPathContained`）、`writer/lib/template.ts`（拆出 `renderSystemPromptForPreview`）、`writer/app.ts`（註冊 templates 路由）、`writer/types.ts`（`AppDeps.templateEngine`）、`writer/vendor/ventojs.d.ts`（`compile()` ambient typing）。
- **前端**：
  - 新增 `reader-src/src/lib/cm-vento.ts`、`cm-vento-complete.ts`、`template-api.ts`、`template.ts`（含 `VENTO_HELPERS` const）、`components/TemplateEditorPage.vue`、`TemplateEditor.vue`、`TemplateFileTree.vue`、router 條目、SettingsLayout 入口。
  - `deno.json` `imports` 加入 `@codemirror/state`、`@codemirror/view`、`@codemirror/language`、`@codemirror/lint`、`@vueuse/core`、`diff`（npm: 規格），跑 `deno cache` 更新 lockfile。
- **CI**：新增 `scripts/check-vento-helpers.ts`，差集非空即失敗；既有 `deno test` 覆蓋新測試。
- **文件**：
  - `docs/prompt-template.md`：新增「Template Editor」與「Lore 篇章在 Template Editor 中編輯」章節；刪除所有 `set` + `include` 範例；新增警語。
  - `docs/plugin-system.md`：plugin fragment read-only 規則 + `getPromptVariables()` 載入時 SSTI 強制 breaking note。
  - Release notes：列出受影響 plugin / fragment 路徑與遷移步驟。
- **依賴**：新增 6 個 npm 套件（CodeMirror 6 家族 + `@vueuse/core` + `diff`），純前端 bundle，container permissions 不變。
- **無 LLM 成本**：lint / preview 全部在 Deno 內 process，不打外部 API。
- **無向下相容**：依專案目前 0 使用者前提，本 change 不提供 plugin migration shim；plugin 作者升級時需自行調整 fragment 內容。

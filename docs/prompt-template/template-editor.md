# Template Editor

`/settings/template-editor` 是 writer 模式內的 Vento 模板 lint／preview／編輯工具，與 `/settings/prompt-editor`（編輯 chat 訊息卡片）職責互補：**Prompt Editor 編 message 卡片，Template Editor 編模板原始碼**。

頁面採用三欄佈局：

1. **左欄 — 檔案樹**：列出可編輯的 `system.md`、所有 plugin 的 `promptFragments[].file`、以及三層 lore 篇章（global／series／story）。Plugin fragment 節點旁顯示 **唯讀** 徽章。
2. **中欄 — CodeMirror 6 編輯器**：內建 Vento tokenizer 與自動完成（從 `VENTO_HELPERS` const 取得 filter 列表）。`set` / `/set` / `include` / `{{> jsExpression }}` token 會被標為紅色錯誤，並顯示「使用 `{{> include }}` 是不允許的；改用主模板具名變數、plugin promptFragments 或 `getDynamicVariables()` 注入內容」提示。
3. **右欄 — 預覽**：對主模板與 plugin 片段以 `PromptPreview.vue` 渲染最終 messages 陣列；對 lore 條目則回退為純 Markdown 區塊。

## Lint diagnostics

每次編輯後，前端會把當前緩衝送到 `POST /api/templates/lint`，後端走 `ventoEnv.compile()` AST 路徑收集：

- `vento.unsafe-expression`：碰到 `set` / `/set` / `include` / `{{> jsExpression }}` 等被白名單拒絕的 token。
- `vento.unknown-variable`：AST walk 發現引用了不在 catalog 內的變數名稱。
- `vento.message-nested` / `vento.message-invalid-role`：`{{ message }}` 多訊息標籤的編譯期錯誤。

`POST /api/templates/lint` 支援兩種請求型態：

1. **Path-form**（Template Editor 頁面用）：`{ templatePath, source, series?, story? }`。後端透過 `parseTemplatePath()` 推導 `kind`、catalog 範圍與 lore scope。
2. **Source-form**（Prompt Editor 卡片、Lore Editor 草稿等虛擬位置用）：`{ kind, source, role?, scope?, series?, story?, pluginName? }`。
   - `kind` 必填，可為 `system` / `plugin-fragment` / `lore` / `prompt-message-body`。
   - `kind: "prompt-message-body"` 必須帶 `role ∈ {system, user, assistant}`。後端會在 lint 前把 source 包進 `{{ message "<role>" }} … {{ /message }}`，讓 nested-message 之類的錯誤能在卡片本體被即時揪出；診斷的 line 會自動翻譯回使用者輸入的座標。
   - `kind: "plugin-fragment"` 必須帶 `pluginName`，用來收斂 catalog 至該 plugin 自己宣告的 `promptFragments[].variables`。
   - `kind: "lore"` 的草稿（尚未存檔）建議由前端跳過 lint 請求；存檔後再啟動 lint。

`GET /api/templates/variables` 同樣支援 `kind` query param（預設為 `system`），讓 Prompt Editor / Lore Editor 各自獲得正確範圍的變數 catalog。每個 host page 只需要在 mount 時抓一次 catalog 並轉發到所有編輯器實例，避免多卡片同時打 API。

## `VentoCodeEditor` — 共用編輯器元件

CodeMirror 6 + Vento 編輯器以 `VentoCodeEditor.vue`（路徑 `reader-src/src/components/`）形式釋出，在三處被消費：

- Template Editor 頁面（`TemplateEditorPage.vue`）— 帶 `templatePath`，啟用 `enableSaveShortcut`（Mod-s → 觸發儲存）。
- Prompt Editor 訊息卡片（`PromptEditorMessageCard.vue`）— `kind: "prompt-message-body"` + `role`，`lazy-lint` 在使用者第一次 focus／edit 之前不發 lint 請求。
- Lore Editor 內文（`lore/LoreEditor.vue`）— `kind: "lore"` + `scope`，新建草稿時設 `disable-lint` 跳過 lint。

公開 props 包含 `source, variables, templatePath?, kind?, role?, scope?, pluginName?, series?, story?, readOnly?, enableSaveShortcut?, enableLineNumbers?, disableLint?, lazyLint?, minLines?, maxLines?`。發射事件 `update:source`、`lint` 與 `save-request`。`defineExpose` 對外暴露 `{ focus, insertAtCursor, jumpTo }`，host 不應直接觸碰 CodeMirror `EditorView`。

## Preview 模式（三種 fixture mode）

`POST /api/templates/preview` 支援三種 fixture mode：

| Mode | 來源 | 用途 |
|------|------|------|
| `default` | `writer/fixtures/template-preview.json` 內建固定 fixture | 純函式渲染，不接 plugin pipeline、不讀 story 目錄。最快、最無副作用，適合通用迭代 |
| `inline` | 前端傳入自訂 fixture 物件 | 想模擬特定變數值（例如 `lore_*` 內容）時使用 |
| `current` | 真實 plugin pipeline + 指定的 series／story 目錄 | 想看「實際上會送到 LLM 的內容」時使用；會跑完整 `buildPromptFromStory()` 流程 |

## 寫入流程（atomic + backup）

`PUT /api/templates` 對 `system.md` 與 lore 篇章採 atomic write：

1. 先呼叫 `validateTemplate()`；含非白名單 token → 回 `422`。
2. `Deno.lstat` 拒收 symlink target；若已存在則先複製到 `<target>.bak`（若 `.bak` 也存在則改用 `.bak.<timestamp>`）。
3. 寫入暫存檔 `<parent>/.<basename>.tmp.<uuid>`。
4. `Deno.rename` 至最終路徑（同 device 內 atomic）。

任何環節失敗都會在 `try/finally` 中清掉暫存檔，原始檔案不會被破壞。

## Plugin fragment 為何 read-only？

Plugin 的 `promptFragments` 一律 read-only，須於 plugin 的 source repository 編輯。`PUT /api/templates` 收到 `templatePath` 以 `plugin:` 起頭時直接回 `403`，且不提供「另存」或 fork-then-overlay。這是為了避免使用者編輯後與 plugin image 內容漂移、引起難以追蹤的行為差異。Plugin 作者應在自家 repo 中修改片段原始檔，並重新打包 plugin image。

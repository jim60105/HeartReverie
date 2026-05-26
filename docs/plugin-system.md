# Plugin 系統

本專案採用以 manifest 驅動的 plugin 架構，將提示詞片段、標籤處理、前端渲染、後處理等功能拆分為獨立的 plugin。每個 plugin 透過 `plugin.json` 宣告自身的能力，由 `PluginManager` 在啟動時自動掃描、載入、初始化。

## 架構概覽

```
writer/
├── server.ts                  ← 主伺服器，初始化 plugin 與 hook
└── lib/
    ├── plugin-manager.ts      ← PluginManager 類別：探索、載入、管理 plugin
    └── hooks.ts               ← HookDispatcher 類別：後端 hook 註冊與分派

plugins/                       ← 內建 plugin 目錄
├── _shared/
│   └── utils.js               ← 前端模組共用工具
├── context-compaction/
│   ├── plugin.json
│   └── handler.js
├── response-notify/
│   ├── plugin.json
│   ├── handler.js
│   └── frontend.js
├── thinking/
│   ├── plugin.json
│   ├── frontend.js
│   └── prompt-fragments/
│       └── think-before-reply.md
└── ...（共 8 個 plugin）
```

Plugin 與伺服器的互動分為六個層面，分別對應 manifest 中的不同欄位：

- **提示詞注入**：透過 `promptFragments` 將 Markdown 片段載入為 Vento 模板變數
- **動態變數**：透過 `backendModule` 匯出 `getDynamicVariables()` 函式，在渲染提示詞時動態提供模板變數
- **提示詞標籤清除**：透過 `promptStripTags` 宣告需要從 previousContext（已儲存章節內容）中移除的 XML 標籤或正規表達式，在組建提示詞時生效
- **顯示標籤清除**：透過 `displayStripTags` 宣告需要從前端顯示中移除的 XML 標籤或正規表達式，在瀏覽器渲染時生效
- **後端 hook**：透過 `backendModule` 註冊伺服器端生命週期事件的處理函式
- **前端模組**：透過 `frontendModule` 提供瀏覽器端的自訂標籤渲染邏輯
- **前端樣式注入**：透過 `frontendStyles` 宣告 CSS 樣式表路徑，系統在前端初始化時自動注入 `<link rel="stylesheet">` 至 `<head>`
- **動作按鈕**：透過 `actionButtons` 宣告閱讀器 UI 上的互動按鈕，搭配前端 `action-button:click` hook 與後端 `POST /api/plugins/:pluginName/run-prompt` 路由，可觸發自訂提示詞並把回應接回章節檔，詳見「[動作按鈕（Action Buttons）](#動作按鈕action-buttons)」章節
- **可設定項目**：透過 `settingsSchema` 宣告 JSON Schema，系統自動提供 `GET/PUT /api/plugins/:name/settings` 端點與閱讀器內的設定頁，詳見「[Plugin Settings](#plugin-settings)」章節
- **自訂 API 路由**：後端模組可額外匯出 `registerRoutes(context)`，將自家路由掛載於 `/api/plugins/:name/*` 命名空間下並共用 passphrase 驗證，詳見「[Plugin 自訂 API 路由](#plugin-自訂-api-路由)」章節

## Plugin Manifest 規格

每個 plugin 目錄下必須包含一個 `plugin.json`，其 `name` 欄位必須與目錄名稱一致。以下是完整的欄位定義：

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `name` | `string` | ✅ | Plugin 的唯一識別名稱，必須與目錄名稱相同 |
| `displayName` | `string` | ✅ | 顯示用名稱（任何 Unicode 字串，非空白），用於閱讀器側邊欄與設定頁標題；UI 應呈現此值而非 slug |
| `version` | `string` | ❌ | 語意化版本號（例如 `"1.0.0"`） |
| `description` | `string` | ❌ | 簡短描述 |
| `type` | `string` | ❌ | Plugin 類型，見下方說明 |
| `promptFragments` | `array` | ❌ | 提示詞片段宣告，見「提示詞片段」章節 |
| `backendModule` | `string` | ❌ | 後端模組路徑（相對於 plugin 目錄） |
| `frontendModule` | `string` | ❌ | 前端模組路徑（相對於 plugin 目錄） |
| `tags` | `array` | ❌ | 此 plugin 管理的 XML 標籤名稱列表 |
| `promptStripTags` | `array` | ❌ | 組建提示詞時從 previousContext 中移除的標籤或正規表達式 |
| `displayStripTags` | `array` | ❌ | 前端顯示時移除的標籤或正規表達式 |
| `frontendStyles` | `array` | ❌ | 前端 CSS 樣式表路徑列表（相對於 plugin 目錄），見「前端樣式注入」章節 |
| `actionButtons` | `array` | ❌ | 動作按鈕宣告，見「[動作按鈕（Action Buttons）](#動作按鈕action-buttons)」章節 |
| `settingsSchema` | `object` | ❌ | JSON Schema（draft-07）描述 plugin 可設定項目，見「[Plugin Settings](#plugin-settings)」章節 |
| `parameters` | `array` | ❌ | 自訂 Vento 模板參數宣告 |
| `hooks` | `array` | ❌ | Plugin 註冊的 hook 階段宣告（用於 Hook Inspector 與啟動期一致性驗證），見「[Hook Inspector](#hook-inspector)」章節 |

### Plugin 類型

`type` 欄位決定 plugin 的功能範圍：

| 類型 | 說明 | 範例 |
|------|------|------|
| `prompt-only` | 僅提供提示詞片段，不包含後端或前端邏輯 | start-hints、writestyle |
| `hook-only` | 僅透過後端 hook 參與生命週期，不提供提示詞 | — |
| `full-stack` | 同時包含提示詞片段、後端模組、前端模組 | context-compaction、thinking |
| `frontend-only` | 僅提供前端模組 | — |

類型宣告目前作為語意標註使用，系統不會依據類型限制 plugin 的實際能力。一個宣告為 `prompt-only` 的 plugin 若同時提供 `frontendModule`，系統仍會正常載入。

## Plugin 探索與載入

### 探索流程

伺服器啟動時，`PluginManager.init()` 依序掃描兩個目錄：

1. **內建 plugin**：專案根目錄下的 `plugins/` 目錄
2. **外部 plugin**：環境變數 `PLUGIN_DIR` 指定的目錄（選填，必須為絕對路徑）

當外部 plugin 的名稱與內建 plugin 相同時，外部 plugin 會覆蓋內建版本。系統會在 console 記錄覆蓋資訊。

### 驗證規則

探索過程中，系統對每個 plugin 執行以下驗證：

- `plugin.json` 必須為合法的 JSON 格式
- `name` 為必填欄位
- `name` 必須與所在目錄名稱完全一致（防止 plugin 冒名）
- `displayName` 為必填欄位，必須為字串，trim 後不得為空字串
- Plugin 名稱不得包含 `..`、`\0`、`/`、`\` 等路徑穿越字元

驗證失敗時，系統記錄警告並跳過該 plugin，不影響其餘 plugin 的載入。

### 後端模組初始化

具有 `backendModule` 的 plugin 會在探索完成後進行模組初始化。系統以 `import()` 動態載入模組（在 Deno 中使用 `file://` URL），並呼叫其匯出的 `register(context)` 函式。context 物件包含 `hooks`（HookDispatcher 實例）、`logger`（已綁定 plugin 名稱的 Logger 實例）和 `getSettings()`（讀取該 plugin 已合併預設值的設定），讓 plugin 向 HookDispatcher 註冊 hook 處理函式、讀取執行期設定並記錄結構化日誌。系統亦支援 `mod.default` 作為 `register` 匯出的備援（即 `const registerFn = mod.register || mod.default;`）。

模組路徑必須通過路徑包含檢查——解析後的絕對路徑必須位於 plugin 目錄內部，否則跳過載入。

若模組同時匯出 `getDynamicVariables(context)` 函式，系統會在渲染提示詞時呼叫該函式，取得動態模板變數（見「動態變數」章節）。

若模組同時匯出 `registerRoutes(context)` 函式，系統會在 `createApp()` 期間呼叫一次，將 plugin 自訂的 HTTP 路由掛載於 `/api/plugins/:name/*` 之下（見「[Plugin 自訂 API 路由](#plugin-自訂-api-路由)」章節）。

### 動態變數

後端模組可匯出 `getDynamicVariables(context)` 函式，在每次渲染提示詞時動態提供模板變數。這適用於需要根據當前故事狀態產生值的情境。

```javascript
// handler.js — 動態變數匯出範例
export async function getDynamicVariables({
  series,
  name,
  storyDir,
  userInput,
  chapterNumber,
  previousContent,
  isFirstRound,
  chapterCount,
}) {
  // 根據故事目錄、目前請求或前一章內容產生鍵值對
  return { my_dynamic_var: await computeSomeValue(storyDir) };
}
```

**`context` 參數包含：**

| 欄位 | 型別 | 說明 |
|------|------|------|
| `series` | `string` | 系列名稱 |
| `name` | `string` | 故事名稱 |
| `storyDir` | `string` | 故事目錄的絕對路徑 |
| `userInput` | `string` | 本次請求的原始使用者訊息；預覽路徑下為空字串。**注意：** 為原文未經清理,外掛若要寫入檔案,請自行過濾敏感內容 |
| `chapterNumber` | `number` | 本次生成將寫入的章節編號（1-based）。規則為「若尾端章節為空則重用,否則 `max(existing) + 1`,皆無則為 `1`」,與實際寫入的檔案一致 |
| `previousContent` | `string` | `chapterNumber` 前一章的原始未清理內容；無前章時為空字串。**注意：** 可能長達數十 KB,不建議直接塞入其他變數,可參考 `context-compaction` 外掛做摘要 |
| `isFirstRound` | `boolean` | 所有既有章節均為空白時為 `true` |
| `chapterCount` | `number` | 磁碟上 `NNN.md` 章節檔案數量（包含尾端空檔案） |

此 context 為純資料物件,不包含函式、檔案控制代碼、API key 或 `AppConfig` 等基礎設施物件;後續欄位新增請透過 `writer-backend` 規格變更提案。

**衝突處理規則：**

- 動態變數不得覆寫核心變數（`previous_context`、`user_input`、`isFirstRound`、`series_name`、`story_name`、`plugin_fragments`、`draft`），否則記錄警告並忽略
- 多個 plugin 提供相同鍵時，先載入的 plugin 優先（first-loaded wins），記錄警告
- 動態變數的優先順序低於核心變數與典籍變數（spread 在最前方）

若 plugin 透過 `getDynamicVariables()` 提供變數，建議同時在 `plugin.json` 的 `parameters` 陣列中宣告該變數，使 API 端點 `GET /api/plugins/parameters` 能正確列出。

## 提示詞片段

提示詞片段是 plugin 向系統提示詞注入內容的主要機制。Plugin 在 manifest 的 `promptFragments` 陣列中宣告片段檔案，系統在渲染提示詞時將檔案內容載入為 Vento 模板變數。

### 片段宣告格式

```json
{
  "promptFragments": [
    { "file": "./instructions.md", "variable": "my_instructions", "priority": 100 }
  ]
}
```

每個片段項目包含三個欄位：

| 欄位 | 說明 |
|------|------|
| `file` | 片段檔案路徑（相對於 plugin 目錄） |
| `variable` | 對應的 Vento 模板變數名稱（選填） |
| `priority` | 排序權重，數字越小越先出現（預設 100） |

指定 `variable` 的片段會載入為具名變數，可在模板中以 `{{ variable_name }}` 引用。未指定 `variable` 的片段則加入 `plugin_fragments` 陣列，依 `priority` 排序後可在模板中以 `{{ for item of plugin_fragments }}` 迭代使用。

### 與 `{{ message }}` 多訊息標籤的互動

自從 `{{ message }}` 多訊息標籤加入後，模板可將不同片段指派到不同對話角色。Plugin 作者撰寫片段時請注意以下規則：

- **片段內容以純文字插值**：Vento 將 `{{ fragment }}` 以 `output += fragment` 的形式輸出，**不會**重新解析片段內容為 Vento 原始碼。也就是說，片段檔案中即使寫入 `{{ message "user" }}…{{ /message }}`，這些字元也會原樣呈現，**不會**產生新的對話訊息。若需要將片段綁定到特定角色，請由模板作者在 `system.md` 中以 `{{ message "<role>" }}{{ for f of plugin_fragments }}{{ f }}{{ /for }}{{ /message }}` 的方式包裹。
- **不可巢狀**：若片段內容會被插入到 `{{ message }}` 區塊之內，片段本體**不得**再寫入 `{{ message }}` 標籤——巢狀的 `{{ message }}` 區塊會在編譯期被 `multi-message:nested` 拒絕。
- **角色變數的型別約束**：若 plugin 透過 `getDynamicVariables()` 提供的變數會在模板中作為 `{{ message <ident> }}` 的角色識別字使用，該變數的執行期值**必須**僅為 `"system"`、`"user"`、`"assistant"` 三者之一，否則會在執行期丟出 `multi-message:invalid-role`。

### 路徑安全

片段檔案路徑經過 `path.resolve()` 後，必須仍在 plugin 目錄內部。嘗試透過 `../` 讀取 plugin 目錄外部的檔案會被攔截並跳過。

### 在 Template Editor 中為唯讀（read-only）

Plugin 的 `promptFragments` 檔案在 `/settings/template-editor` 內**永遠是唯讀**。檔案樹會把這些節點標上「唯讀」徽章，編輯器不顯示存檔按鈕。

後端 `PUT /api/templates` 收到 `templatePath` 以 `plugin:` 起頭時直接回 **403**，不提供「另存」或 fork-then-overlay。Plugin 作者必須在自家 plugin 的 source repository 中修改片段檔，並重新打包 plugin image 才能生效。

> [!IMPORTANT]
> **BREAKING CHANGE — Plugin 載入時的 SSTI 強制驗證。**
>
> `PluginManager.init()` 在**註冊任何 hook、settings、片段之前**，會對每個 plugin 的 `promptFragments[].file` source 呼叫 `validateTemplate()`。若片段內容含有 `{{ set ... }}`、`{{ /set }}`、`{{ include ... }}`，或任何 `{{> jsExpression }}` 等非白名單 token，該 plugin 會載入失敗（log 等級 `error`，不註冊 hook／settings／fragment），但**不影響**其他兄弟 plugin。
>
> 縱深防禦：`renderSystemPrompt()` 在每次組合 fragment 前會再 validate 一次，攔截「載入後檔案被外部編輯」或「runtime 動態組裝出 SSTI 字串」的情況；單一片段驗證失敗只會跳過該片段（log `warn`），不影響其餘片段組合。
>
> **遷移建議**：把片段內的 `set` / `include` 改寫為具名變數注入。
>
> - 若原本以 `include` 把外部 Markdown 拉進來，改為在 manifest `promptFragments` 直接宣告該檔案並指定 `variable`，模板層只剩 `{{ variable_name }}` 插值。
> - 若原本以 `set` 暫存中間結果，改在後端 `getDynamicVariables()` 中組裝好字串後以動態變數回傳。
> - 若需要視條件提供不同片段，仍可在 `getDynamicVariables()` 中以 JavaScript 決定變數值，再用模板的 `{{ if ... }}` 控制是否插值。
>
> 詳細模板層語法限制請見 [Prompt 模板系統][prompt-template]。

### 目前的 plugin 變數

以下是所有內建 plugin 提供的模板變數：

| 變數名稱 | 來源 plugin | Priority | 說明 |
|----------|-------------|----------|------|
| `think_before_reply` | thinking | 100 | 回覆前思考指令（chain-of-thought） |
| `start_hints` | start-hints | 100 | 首輪章節開場引導提示 |
| `context_compaction` | context-compaction | 800 | 長篇脈絡壓縮摘要 |

這些變數之外，系統還提供六個核心變數：`previous_context`、`user_input`、`isFirstRound`、`series_name`、`story_name`、`plugin_fragments`，以及外掛透過 `getDynamicVariables()` 提供的動態變數和典籍系統（Lore Codex）提供的 `lore_all`、`lore_<tag>`、`lore_tags` 等變數。詳細說明參見 [Prompt 模板系統][prompt-template] 及[典籍系統文件][lore-codex]。

## 標籤清除

LLM 回應中包含 plugin 定義的 XML 標籤，這些標籤會隨回應一同寫入章節檔案。系統提供兩種標籤清除機制：

- **`promptStripTags`**：在後端組建提示詞時生效。系統讀取已儲存的章節內容組建 `previousContext` 時，移除符合 pattern 的標籤，避免這些標籤出現在送往 LLM 的提示詞中。
- **`displayStripTags`**：在前端瀏覽器渲染時生效。前端在顯示章節內容時移除符合 pattern 的標籤，讓讀者不會看到這些內部標記。

兩個欄位支援相同的 pattern 格式：純文字標籤名稱和正規表達式。

### 純文字標籤

最簡單的形式是直接寫標籤名稱：

```json
{
  "promptStripTags": ["disclaimer", "user_message"],
  "displayStripTags": ["disclaimer", "scratchpad"]
}
```

系統會自動將每個名稱包裝為正規表達式 `<tagname>[\\s\\S]*?</tagname>`，進行非貪婪比對。

### 正規表達式模式

當標籤可能帶有屬性（例如 `<task type="think">`），純文字模式無法匹配。此時可使用正規表達式語法，以 `/` 開頭標示：

```json
{
  "promptStripTags": ["/<task\\b[^>]+>[\\s\\S]*?<\\/task>/g"],
  "displayStripTags": ["/<task\\b[^>]+>[\\s\\S]*?<\\/task>/g"]
}
```

系統會擷取 `/` 與結尾 `/flags` 之間的 pattern 字串，並建立 `RegExp` 物件。所有 plugin 的 pattern 最終以 `|` 合併為單一正規表達式，以 `g` flag 執行全域替換。

正規表達式模式具有以下防護：

- 空 pattern（例如 `//g`）會被記錄警告並跳過
- 無效的正規表達式語法會被 try-catch 捕獲並跳過，不影響其餘 pattern
- 前端的 `displayStripTags` 會額外執行 ReDoS 安全檢測，自動跳過可能造成效能問題的 pattern

## Hook 系統

### 後端 Hook

HookDispatcher 提供以下生命週期階段，plugin 可在任意階段註冊非同步處理函式：

| 階段 | 觸發時機 | Context 參數 |
|------|---------|-------------|
| `prompt-assembly` | 系統提示詞渲染期間 | `{ previousContext, rawChapters, storyDir, series, name, correlationId }` |
| `pre-llm-fetch` | 上游 LLM `fetch()` 之前（觀察用） | `{ correlationId, messages, model, requestMetadata, storyDir, series, name, writeMode }` |
| `response-stream` | 每次從 LLM SSE 串流解析出非空內容片段時 | `{ correlationId, chunk, series, name, storyDir, chapterPath, chapterNumber }` |
| `pre-write` | 僅 `write-new-chapter` 模式：建立新章節檔案、開始 LLM 串流之**前**（此時 LLM 回應尚未產生） | `{ correlationId, message, chapterPath, storyDir, series, name, preContent }` |
| `post-response` | LLM 回應完成後（typed `PostResponsePayload`，deep-frozen） | `{ correlationId, content, storyDir, series, name, rootDir, chapterNumber, chapterPath, source, pluginName?, appendedTag?, endpoint, usage }` — `source` 為 `"chat" \| "continue" \| "plugin-action"`，`usage: TokenUsageRecord \| null`，詳見 [post-response Payload](#post-response-payloaddeep-frozen) 與 [TokenUsageRecord](#tokenusagerecord) |
| `strip-tags` | 內容標籤清除時（未使用） | `{ content }` |

> [!NOTE]
> `strip-tags` 目前未被任何程式碼路徑分派；在 `plugin.json` 的 `hooks[]` 中宣告 `strip-tags` 會在載入時被 `PluginManager` 拒絕（強制以 `promptStripTags` / `displayStripTags` 替代）。其他非 `PARALLEL_ALLOWED` 的階段（例如 `pre-write` 或任何前端 stage）**可以**出現在 `hooks[]` 中作為「Hook Inspector / 啟動期 mismatch 檢查」的宣告，只是 `parallel`/`readOnly`/`concurrency`/`dependsOn` 對它們沒有平行分派效力。實際分派的 hook 階段為：`prompt-assembly`（story.ts）、`pre-llm-fetch`（chat-shared.ts）、`response-stream`（chat-shared.ts）、`pre-write`（chat-shared.ts）、`post-response`（chat-shared.ts）。

#### `post-response` Payload（deep-frozen）

`post-response` 是 `executeChat()` 四個成功分支共用的終點，dispatch 之前 payload 已經透過遞迴 `Object.freeze` **深度凍結**（型別見 `writer/types.ts` 的 `PostResponsePayload`）。任何嘗試覆寫頂層欄位或巢狀屬性（包含 `usage`）在 Deno ESM strict mode 下會拋出 `TypeError`。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `correlationId` | `string` | 與同次請求所有 hook stage 一致 |
| `content` | `string` | 寫入完成後的內容快照：`write-new-chapter` 為 `preContent + 經 response-stream 處理的串流內容`；`continue-last-chapter`、`append-to-existing-chapter`、`replace-last-chapter` 皆為**該章節檔案在寫入後的完整內容**（重新從磁碟讀取） |
| `storyDir` / `series` / `name` / `rootDir` | `string` | 故事路徑與名稱 |
| `chapterNumber` | `number` | 寫入或附加的章節編號 |
| `chapterPath` | `string` | 章節檔案絕對路徑 |
| `source` | `"chat" \| "continue" \| "plugin-action"` | 觸發來源（見下表） |
| `pluginName?` | `string` | 當 `source === "plugin-action"` 才存在 |
| `appendedTag?` | `string` | 僅 append 分支會設定；replace 分支**不會**有此欄位 |
| `endpoint` | `string` | 實際呼叫的上游 LLM URL（`config.LLM_API_URL`），plugin 可用作每 endpoint 計價的 key |
| `usage` | `TokenUsageRecord \| null` | 上游 token 使用量；上游未回報時為 `null`（明確區分「不可用」與「未回報」） |

WriteMode 與 `source` 的對應：

| WriteMode kind | `source` | 額外欄位 |
|---|---|---|
| `write-new-chapter` | `"chat"` | — |
| `continue-last-chapter` | `"continue"` | — |
| `append-to-existing-chapter` | `"plugin-action"` | `pluginName`、`appendedTag` |
| `replace-last-chapter` | `"plugin-action"` | `pluginName`（無 `appendedTag`） |

> Dispatcher 透過 `Proxy` 在已凍結的 payload 上注入 per-handler `ctx.logger`，本身不修改 payload；plugin 不應、也無法以 `ctx.logger = ...` 取代。

#### `TokenUsageRecord`

`post-response` 的 `ctx.usage` 與 `runPluginPrompt` 回傳的 `usage` 共用此型別（定義於 `writer/types.ts`，spec 為 `token-usage-tracking`）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `chapter` | `number` | 對應章節編號 |
| `promptTokens` | `number` | prompt token 數 |
| `completionTokens` | `number` | completion token 數 |
| `totalTokens` | `number` | 總 token 數 |
| `model` | `string` | 上游回報的模型名稱 |
| `timestamp` | `string` | ISO-8601 |
| `upstreamCostUsd?` | `number \| null` | 上游 LLM 自回報的 billed cost（USD）；僅當 SSE final chunk 帶 `usage.cost` 才會出現 |

- 引擎**永遠不會**從本地價格表合成 `upstreamCostUsd`；缺值時欄位為 `null` 或省略。`NaN`、`Infinity`、負數、字串等非法值一律視為缺值。
- `executeChat()` 在 request body 內**無條件**送出 `usage: { include: true }`（OpenRouter 的 opt-in；其他 OpenAI 相容後端會忽略）。
- 寫入 `_usage.json` 時 `upstreamCostUsd` 會 round-trip 保留。

#### `pre-llm-fetch`（觀察用，預設 serial；可選 `parallel:true + readOnly:true`）

`pre-llm-fetch` 由 `streamLlmAndPersist()` 在 `fetch(config.LLM_API_URL, ...)` **之前、`requestBody` 完全建構之後** 分派一次，提供 plugin 觀察即將送出的請求內容（messages、model、sampler 參數、writeMode 種類等）。

- **此階段為觀察用（observation-only）**：handler 不可影響實際送出的 HTTP 請求。dispatcher 會以 `deepFreeze(structuredClone(...))` **深層複製並深度凍結** `messages` 與 `requestMetadata`，因此即使 plugin 嘗試巢狀寫入（`ctx.messages[0].content = "..."`、`ctx.requestMetadata.temperature = 9.9`）都會在 strict mode 下拋出 `TypeError`，並被既有 per-handler `try/catch` 吸收，不會影響上游 `fetch()`。
- **僅 `messages` 與 `requestMetadata` 被凍結**：外層的 `model`、`writeMode`、`correlationId`、`storyDir`、`series`、`name` 等欄位**未**凍結，是 dispatch 當時的快照值；plugin 應視為唯讀，dispatcher **不**保證 peer-isolation。
- **dispatcher-level rejection 也不阻擋 fetch**：`streamLlmAndPersist()` 以 `try/catch` 包裹 `await hookDispatcher.dispatch("pre-llm-fetch", ...)`；若 dispatcher 本身（而非個別 handler）拒絕，會以 `log.warn("pre-llm-fetch dispatch failed", { correlationId, error })` 記錄並繼續送出請求。
- **此階段現已加入 `PARALLEL_ALLOWED` 白名單**：可宣告 `{ parallel: true, readOnly: true }`（或省略 `parallel`，由 Track B 自動推導）。預設仍為 serial。
- `context.correlationId` 與同一個 chat 請求中先前 `prompt-assembly` 觀察到的 `correlationId` **strict equal**，可用於跨 stage 關聯日誌。
- `writeMode.kind` 取值為 `"write-new-chapter"`、`"append-to-existing-chapter"`、`"continue-last-chapter"` 或 `"replace-last-chapter"`。
- 重試不會重新分派此 hook（每次請求恰好一次）。

```javascript
export function register({ hooks, logger }) {
  hooks.register('pre-llm-fetch', (ctx) => {
    logger.info('about to call LLM', {
      correlationId: ctx.correlationId,
      model: ctx.model,
      messageCount: ctx.messages.length,
      mode: ctx.writeMode.kind,
    });
  });
}
```

#### Per-handler 觀察事件：`ctx.hooks.onHandlerStart` / `onHandlerEnd`

除了註冊 hook handler，plugin 也可以**觀察其他 plugin 的 handler 執行**（用於除錯面板、效能分析、coverage 偵測等）。此 API 預設關閉——只有在至少一個訂閱者存在時，dispatcher 才會建立 snapshot 並 fan-out 事件，否則路徑零成本。

```javascript
export function register({ hooks, logger }) {
  const offStart = hooks.onHandlerStart?.((ev) => {
    logger.debug('handler started', {
      stage: ev.stage,
      plugin: ev.plugin,
      priority: ev.priority,
      correlationId: ev.correlationId,
    });
  });
  const offEnd = hooks.onHandlerEnd?.((ev) => {
    logger.debug('handler ended', {
      stage: ev.stage,
      plugin: ev.plugin,
      durationMs: ev.durationMs,
      reassigned: ev.reassigned, // 陣列：被 handler 透過賦值取代的 allowlist 欄位
      error: ev.error?.message,
    });
  });
  // 回傳的 unsubscribe 為 idempotent（重複呼叫無副作用）。
  // 註冊期間建立的訂閱會在 plugin 載入失敗時自動清除。
}
```

**事件語意**：

- `handler-start` 在 dispatcher 呼叫 handler **之前** 發送；`handler-end` 在 handler 回傳或拋出之後發送。兩者攜帶 `ctxBeforeSnapshot` / `ctxAfterSnapshot`（每個 stage 對應 allowlist 子集的 deep clone）。
- **`correlationId` 為事件物件的頂層欄位**（與 `stage`、`plugin`、`timestamp` 平行），**並非** 巢狀於 `ctxBeforeSnapshot` / `ctxAfterSnapshot` 內。請以 `ev.correlationId` 讀取，切勿寫成 `ev.ctxBeforeSnapshot.correlationId`。
- `ctxBeforeRefs` / `ctxAfterRefs` 為 **identity 比較用**——`reassigned: string[]` 包含「handler 將 `ctx.X` 整段取代而非原地修改」的欄位，依字母序排序。
- snapshot 採每欄位獨立 `structuredClone`：若單一 allowlist 欄位無法被 clone（例如指向 function），該欄位會以哨兵物件 `{ __snapshotError: <message> }` 取代，其餘欄位仍會正常拍照，事件仍會照常發送。
- 訂閱者拋出例外不會影響 dispatcher 正確性；連續兩次例外的訂閱者會被自動取消註冊，且每個 stage 每 60 秒最多輸出一筆 `warn` 訊息。
- 訂閱 API 僅作為觀察介面，**不可** 被用於修改 dispatch context（context 應透過 hook handler 修改）。

#### `response-stream` 範例

`response-stream` 於 `executeChat()` 每次解析出非空內容片段時觸發，且在寫入檔案、累積 `aiContent` 與呼叫 `onDelta` 之前執行。Handler 透過改寫 `context.chunk` 轉換內容；若指派為 `""` 則丟棄該片段。非字串值會被強制視為空字串（drop）。TypeScript 型別 `ResponseStreamPayload` 匯出自 `writer/types.ts`。

```javascript
export function register({ hooks }) {
  hooks.register('response-stream', (context) => {
    // context.chunk 可變：覆寫以轉換，指派 "" 以丟棄
    context.chunk = context.chunk.replaceAll('forbidden', '[redacted]');
  });
}
```

註冊方式為在後端模組中匯出 `register` 函式：

```javascript
export function register({ hooks, logger }) {
  logger.info('Plugin initialized');

  hooks.register('post-response', async (context) => {
    // 在 LLM 回應完成後執行自訂邏輯
    // context.logger 為請求範疇的 logger（含 correlationId）
    const log = context.logger ?? logger;
    const { content, storyDir, rootDir } = context;
    log.debug('Processing post-response', { contentLength: content.length });
    // ...
  }, 100); // priority：數字越小越先執行
}
```

同一階段可有多個處理函式，依 priority 排序後依序執行。單一處理函式拋出的例外會被記錄，但不會阻斷後續處理函式的執行。

#### 並行分派模型（Parallel Dispatch Model）

後端 `HookDispatcher` 支援將同一 stage 中符合條件的 handler **並行執行**，以減少 I/O 密集型 handler 的總 wall-clock 時間。並行分派為 **opt-in**，且僅限後端；前端 `FrontendHookDispatcher` 在 v1 完全不受影響。

##### Manifest `hooks[]` 宣告

在 `plugin.json` 中加入 `hooks` 陣列，為每個要宣告的 stage 提供一個 entry：

| 欄位 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `stage` | `string` | ✅ | 目標階段。枚舉：`prompt-assembly`、`post-response`、`response-stream`、`pre-llm-fetch` |
| `parallel` | `boolean` | ❌ | 是否啟用並行分派。預設 `false`（但見下方 Track B） |
| `readOnly` | `boolean` | ❌ | 宣告 handler 不寫入 context（並行安全契約） |
| `concurrency` | `integer` | ❌ | 並行上限。取同 stage 內所有宣告值的 `Math.min`；未設則無上限。register-time 偵測到異質宣告會 `log.warn`（見下方） |
| `dependsOn` | `string[]` | ❌ | 依賴的 plugin 名稱。同 stage 內做拓樸排序；cycle 或未知名稱會退回 priority 排序 |

範例：

```json
{
  "hooks": [
    { "stage": "post-response", "parallel": true, "readOnly": true },
    { "stage": "prompt-assembly", "readOnly": true, "dependsOn": ["context-compaction"] }
  ]
}
```

> [!NOTE]
> `hooks[]` 的 `stage` 列舉接受 **`PARALLEL_ALLOWED`** 白名單中的四個值：`prompt-assembly`、`post-response`、`response-stream`、`pre-llm-fetch`。`pre-write` 與 `strip-tags` 一律為序列，不可出現在 `hooks[]` 宣告中。所有前端 stage 名稱在 schema 中被排除。

##### Stage 白名單與特殊條件

| Stage | 可並行？ | 備註 |
|-------|:-------:|------|
| `prompt-assembly` | ✅ | `parallel:true` 需搭配 `readOnly:true`（缺少則自動降級為 serial + warn） |
| `post-response` | ✅ | 同上 |
| `response-stream` | ✅（條件式） | `parallel:true` **必須**搭配 `readOnly:true`，否則整條宣告被 **reject**（非降級）。每 chunk 獨立 fan-out、無 back-pressure |
| `pre-llm-fetch` | ✅ | 觀察用；`messages` / `requestMetadata` 深度凍結。`parallel:true` 需搭配 `readOnly:true`（缺少則降級為 serial + warn） |
| `pre-write` | ❌ | 強制序列（fan-in pipeline，單一寫者） |
| `strip-tags` | ❌ | 強制序列（未被 dispatch） |

##### Parallel-safe 判準

handler 可安全宣告 `parallel: true` 的條件：

1. handler **不寫入**任何 `context.*` 欄位（如 `previousContext`、`preContent`、`chunk`）
2. handler **不就地 mutate** context 上的陣列或物件（如 `arr.push()`）
3. handler 的副作用彼此獨立（HTTP 呼叫、寫入各自路徑的檔案等）

> [!WARNING]
> Proxy `set` trap 僅在 `HOOK_DEBUG=1` 環境變數下偵測 **top-level** 屬性寫入。對既存陣列 / 物件的就地 mutate（同一 reference 的 `.push()`、`.splice()` 等）**無法被偵測**。請依據上述判準自行確認。

##### Track B：`readOnly:true` 預設並行

宣告 `readOnly: true` 且 **未**顯式指定 `parallel` 的條目，dispatcher 會自動視為 `parallel: true`。這減少了樣板：plugin 作者既然已承諾不寫 context，不需再額外指定 `parallel`。

- 顯式 `parallel: false` 可 opt out，完全尊重
- 未宣告 `hooks[]` 的 plugin **完全不受影響**（100% 向後相容）

> [!IMPORTANT]
> **BREAKING 行為變化**：既有的 `readOnly:true` entry 將從 priority-strict 序列執行變為預設並行。若你的 handler 依賴與其他 handler 的執行順序，請加上 `"parallel": false`。

##### Priority 語意變化

並行 handler **一律在所有序列 handler 之後執行**，與 priority 數值無關。Priority 僅作為同一 bucket 內的排序鍵：

- **序列 bucket**：依 priority-asc 依序 `await`（與過去完全一致）
- **並行 bucket**：序列 bucket 全部完成後，一次 `Promise.allSettled` 啟動

Manifest validator 在 `parallel:true && priority < 100` 時會 `log.warn` 提醒作者：該 handler 不會搶先任何 serial handler。

##### Concurrency 異質宣告 register-time 警告

同一個 parallel bucket 內 `concurrency` 值不一致時，dispatcher 在 **註冊時** 會 `log.warn`，提示作者：因為 `Math.min` 收斂規則，**一個較低（或單一 finite）concurrency 會 throttle 整個 parallel bucket**——亦即更寬鬆的 peer 也會被同樣限速。

觸發條件（任一即可）：

- 新註冊條目宣告 finite `concurrency`，且 bucket 內已有 peer 宣告 **unbounded**（未設）
- 新註冊條目宣告 finite `concurrency`，且 bucket 內存在 peer 宣告 **更高** finite 值（或反向：peer 較低，新 entry 較高）

警告為 **advisory-only**，不阻擋註冊。每個 `${stage}::${plugin ?? "<anonymous>"}::${concurrency ?? "none"}` 組合僅發出一次（process 內 dedup）；payload 包含 `plugin`、`stage`、`concurrency`、`throttlers`、`unboundedPeers`、`message`（內含 `"throttle the entire '<stage>' parallel bucket"` 字面字串）。

##### `register()` options-object 多載

除了既有的 `register(stage, handler, priority?)` 簽章外，第三參數現在也接受 options object，用於 per-handler 覆蓋 manifest 預設：

```ts
hooks.register("post-response", handler, {
  priority: 50,
  parallel: true,
  readOnly: true,
  dependsOn: ["state"],
});
```

- 傳入 `number` 等同 `{ priority: number }`（零行為差異，舊呼叫不受影響）
- options 仍受 allowlist + `readOnly` 契約校驗；違反者 coerce 並 log warn
- `dependsOn` 與 manifest 宣告取 **union**（不取代）

##### 前端排除

v1 並行分派僅限後端。`FrontendHookDispatcher` 完全不動，所有前端 hook 階段（`frontend-render`、`notification`、`chat:send:before` 等）的行為與過去 100% 一致。

#### Plugin Logger

每個 plugin 在 `register()` 時會收到一個已綁定 plugin 名稱的 Logger 實例（透過 `baseData: { plugin: name }`）。所有使用此 logger 記錄的訊息都會自動附帶 plugin 名稱，方便在日誌中快速辨識來源。

Plugin 收到的 `hooks` 物件是經過包裝的版本——呼叫 `hooks.register(stage, handler, priority?)` 時，系統會自動綁定 plugin 名稱和 baseLogger，因此 plugin 無需手動傳遞這些參數。

在 hook 處理函式被分派時，若 hook context 中帶有 `correlationId`（例如 chat 流程），系統會自動注入 `context.logger`——這是從 plugin 的 baseLogger 衍生的 Logger 實例，同時保留 plugin 名稱和請求 correlationId。建議優先使用 `context.logger`，回退到註冊時取得的 logger：

```javascript
export function register({ hooks, logger }) {
  hooks.register('pre-write', async (context) => {
    const log = context.logger ?? logger;
    log.info('Processing message', { messageLength: context.message.length });
    // ...
  }, 100);
}
```

Logger 提供四個等級方法：`debug`、`info`、`warn`、`error`，每個方法接受一個訊息字串和一個可選的 data 物件：

```javascript
logger.debug('Detail info', { key: 'value' });
logger.info('Operation completed', { duration: 42 });
logger.warn('Potential issue', { reason: 'timeout' });
logger.error('Operation failed', { error: err.message });
```

### 前端 Hook

前端 plugin 以 ES module 形式由瀏覽器載入，透過獨立的 FrontendHookDispatcher 註冊同步處理函式。前端 hook 支援以下階段：

| 階段 | 用途 | Context 參數 |
|------|------|-------------|
| `frontend-render` | 自訂內容渲染（例如將 `<options>` 轉為互動式 UI） | `{ text, placeholderMap, options, series?, story?, chapterNumber? }` — 其中 `options` 為 `{ isLastChapter: boolean, series?, story?, chapterNumber? }`；`series`／`story`／`chapterNumber` 在後端模式下提供，前端模式或尚未載入故事時可能為 `undefined` |
| `chapter:dom:ready` | 章節 DOM 掛載完成、可安全綁定 DOM 觀察邏輯時觸發（在 plugin readiness gate 通過後） | `{ container, tokens, rawMarkdown, chapterIndex, series?, story?, chapterNumber? }` — `container` 為章節容器元素，`tokens` 為已渲染的 token 陣列，`rawMarkdown` 為原始 Markdown 字串 |
| `chapter:dom:dispose` | 目前章節即將被替換或卸載時觸發，plugin 應在此釋放 DOM 觀察器與事件監聽器 | `{ container, chapterIndex }` |
| `notification` | 通知觸發（LLM 回應完成/錯誤時由核心派發） | `{ event, data, notify }` — `event` 為 `'chat:done'` 或 `'chat:error'`，`notify` 為通知函式 |
| `chat:send:before` | 使用者送出訊息前，允許 plugin 改寫將送出的文字 | `{ message, mode }` — `mode` 為 `'send'` 或 `'resend'`；若 handler `return` 一個字串，該字串將覆蓋 `context.message`（pipeline 行為） |
| `chapter:render:after` | 章節 Markdown 渲染完成後，允許 plugin 後處理 token 陣列 | `{ tokens, rawMarkdown, options }` — 可直接變更 `tokens`（push/replace/mutate `.content`）；任何新增或 `.content` 變動的 `html` token 會被系統再次以 DOMPurify 重新消毒 |
| `story:switch` | 使用者切換系列／故事時觸發 | `{ series, story, previousSeries, previousStory }` — 首次載入時 `previousSeries`／`previousStory` 為 `null`；資訊用途，不可取消 |
| `chapter:change` | 目前顯示的章節變動時觸發（包含跳章、翻頁、重新載入至最後一章） | `{ chapter, index, previousIndex }` — `chapter` 為對應 `ChapterData.number`，`previousIndex` 為 `null` 代表首次載入；資訊用途，不可取消 |

前端 plugin 的 `register(hooks, context)` 可透過 `hooks.getSettings(name?)` 或 `context.getSettings(name?)` 同步讀取最近一次解析的設定快照；省略 `name` 時讀取自身 plugin。回傳物件為 frozen snapshot，plugin 不應修改。儲存設定後，`PluginSettingsPage` 會發出 `plugin-settings:changed` 事件，reader 會更新設定快取並在 50 ms debounce 後重新渲染目前章節，讓 `frontend-render` 與 DOM 相關 hook 在不重新整理頁面的情況下看到新設定。
| `action-button:click` | 使用者點擊 `PluginActionBar` 中由 plugin 貢獻的按鈕時觸發；async dispatch 並依 `originPluginName` 過濾 | `{ buttonId, pluginName, series, name, storyDir, lastChapterIndex, runPluginPrompt, notify, reload }`，詳見「[動作按鈕（Action Buttons）](#動作按鈕action-buttons)」 |

前端的標籤清除已改為宣告式設定，透過 `displayStripTags` manifest 欄位處理，不再需要前端模組。

`chat:send:before` 採 **pipeline** 模式：handler 回傳 `string` 時會被寫回 `context.message`，下一個 handler 看到的是改寫後的字串；回傳 `undefined` / `null` / 非字串值則不變更 `message`，plugin 仍可直接變更 `context.message` 屬性。此階段不做取消（no veto）——若要過濾，handler 應回傳空字串。

`chapter:render:after` 是 **後處理** 階段：hook 觸發時 tokens 已經過初次 DOMPurify 消毒，但由於允許 plugin 變更 `tokens` 陣列（新增、取代、就地改寫 `.content`），系統會在 hook 結束後針對新增或 `.content` 有變動的 `html` token 再次執行 DOMPurify；此為 XSS 安全網，plugin 無需自行處理 HTML 消毒。

`story:switch` 與 `chapter:change` 為 **資訊型** hook：僅用於通知狀態變動，不支援取消導覽。它們只在每次真實的狀態轉變發射一次（`story:switch` 會比對 `previousSeries`/`previousStory`；`chapter:change` 會比對 `previousIndex`），no-op 導覽不觸發。

前端模組的結構：

```javascript
// frontend-render 範例
export function register(hooks) {
  hooks.register('frontend-render', (context) => {
    // 自訂渲染邏輯
  }, 100);
}
```

```javascript
// notification 範例
export function register(hooks) {
  hooks.register('notification', (context) => {
    if (context.event !== 'chat:done') return;
    context.notify({
      title: '完成通知',
      level: 'success',
      channel: 'auto',
    });
  }, 100);
}
```

```javascript
// chat:send:before 範例 — 在訊息前加上時間戳記
export function register(hooks) {
  hooks.register('chat:send:before', (context) => {
    const stamp = new Date().toISOString();
    return `[${stamp}] ${context.message}`;
  }, 100);
}
```

```javascript
// chapter:render:after 範例 — 為每個 html token 末尾附上小備註
export function register(hooks) {
  hooks.register('chapter:render:after', (context) => {
    for (const tok of context.tokens) {
      if (tok.type !== 'html') continue;
      tok.content += '<!-- post-processed -->';
    }
  }, 100);
}
```

```javascript
// story:switch / chapter:change 範例 — 資訊型 hook
export function register(hooks) {
  hooks.register('story:switch', (context) => {
    console.log('switched to', context.series, context.story);
  }, 100);
  hooks.register('chapter:change', (context) => {
    console.log('chapter', context.previousIndex, '→', context.index);
  }, 100);
}
```

前端模組透過 `/plugins/:name/:file` 路由由伺服器提供靜態檔案服務，僅允許存取 manifest 中宣告的 `frontendModule` 及 `frontendStyles` 檔案。

此外，伺服器也透過 `/plugins/_shared/:path` 路由提供 `plugins/_shared/` 目錄下的共用工具模組。這些 `.js` 工具檔案可供多個前端模組共用（例如 `escapeHtml`）。

## 前端 Render 生命週期

前端 plugin 的 hook 註冊發生在 `usePlugins.initPlugins()`，需要先完成才能讓 `useMarkdownRenderer.renderChapter()` 對齊外掛的 `frontend-render` 與 `chapter:render:after` handler。為了避免「外掛尚未註冊就先渲染」的競態，閱讀器採用以下契約：

- **Readiness 雙旗標。** `usePlugins()` 暴露兩個 reactive ref：
  - `pluginsReady`：僅在 `initPlugins()` 完整成功後才為 `true`，作為診斷與 sidebar relocation watch 的依賴。
  - `pluginsSettled`：`initPlugins()` 結束後（不論成功或失敗）為 `true`，用於閘控章節渲染。
  - 失敗時透過 `useNotification` 顯示警告 toast 並降級為「無外掛」渲染，而非永久隱藏章節。
- **Idempotent 初始化。** `initPlugins()` 透過模組內的 in-flight `Promise<void>` 共享給並發呼叫，並 `await Promise.resolve(register(...))` 以支援非同步的 `register()`。
- **Readiness gate。** `ContentArea.vue` 以 `v-if="pluginsSettled && currentContent"` 閘控 `<ChapterContent>`；在 settled 之前顯示「載入中…」placeholder。
- **Sidebar relocation 契約。** `ContentArea.vue` 的 `watch([currentContent, isLastChapter, pluginsReady, renderEpoch], …, { flush: "post" })` 會：
  1. 一律先清空 `<Sidebar>`，避免上一章 panel 殘留。
  2. 若尚未 renderable（`!pluginsSettled || !currentContent`），停止後續處理。
  3. 否則把 `.plugin-sidebar` 元素從章節內容搬到 `<Sidebar>` 中。
- **Edit-save 不變式。** `useChapterNav` 暴露 `currentContent: ShallowRef<string>` 與 `renderEpoch: Ref<number>`，所有寫入都經由內部的 `commitContent()` 進行；位元組相同的覆寫也會呼叫 `triggerRef(currentContent)` 並遞增 `renderEpoch`，使下游 computed 與 watch 重新執行。`ChapterContent.vue` 在儲存編輯後呼叫 `refreshAfterEdit(targetChapter)`，停留在使用者剛剛編輯的章節並強制重新渲染。
- **Render 鏈式自我修正。** `ChapterContent.vue` 的 `tokens` computed 讀取 `pluginsReady` 與 `renderEpoch`，作為 readiness gate 的後備，使任何繞過 gate 的渲染都能在後續 invalidation 時自動更新。

## 前端樣式注入

Plugin 可透過 `frontendStyles` manifest 欄位宣告 CSS 樣式表，系統會在前端初始化時自動注入 `<link rel="stylesheet">` 至 `<head>`。

### 宣告格式

```json
{
  "frontendStyles": ["./styles.css", "./components/panel.css"]
}
```

每個路徑項目的規則：

| 規則 | 說明 |
|------|------|
| 相對路徑 | 必須為相對路徑（不允許 `/` 開頭） |
| `.css` 副檔名 | 每個路徑必須以 `.css` 結尾 |
| 無路徑穿越 | 不允許 `..` 段（經 `isPathContained` 驗證） |
| 檔案存在 | 啟動時驗證檔案是否存在，不存在者記錄警告並跳過 |

系統在載入時會自動正規化路徑（去除 `./` 前綴、去除重複項目）。

### 注入行為

- CSS `<link>` 在前端 JS 模組 `import()` **之前**注入，讓元件渲染時樣式已可用
- 注入位置在核心樣式表**之後**（附加至 `<head>` 尾端），plugin CSS 自然覆蓋基礎樣式
- 每個 `<link>` 帶有 `data-plugin="<name>"` 屬性，方便除錯
- 若 CSS 載入失敗，`onerror` 處理器會靜默移除該 `<link>` 元素（優雅降級）
- 相同 `href` 不會重複注入（冪等性保證）

### 檔案配置慣例

建議將 plugin 專屬樣式與 `frontend.js` 放在同一目錄：

```
my-plugin/
├── plugin.json
├── frontend.js
└── styles.css
```

### 串階順序（Cascade Order）

1. 核心應用樣式（Vite 打包的 `base.css`、`theme.css`）
2. Plugin CSS（依 `GET /api/plugins` 回傳順序注入）

Plugin CSS 可引用核心 CSS 變數（如 `--text-main`、`--panel-bg`），因為注入時這些變數已定義在 `:root`。

## 動作按鈕（Action Buttons）

動作按鈕讓 plugin 在閱讀器主版面上貢獻一顆互動按鈕；點擊後可由 plugin 自家的提示詞檔案發起一次 LLM 回合，並（可選）將回應以指定 XML 標籤包裹後接到目前章節檔尾端。對應的失敗復原情境例如「重算 `<UpdateVariable>` JSON patch」、「重新生成 `<options>` 選項面板」均以此機制統一實作，無需各自在核心改動。

按鈕位於 `MainLayout.vue` 中 `UsagePanel` 與 `ChatInput` 之間的 `PluginActionBar`，沒有任何 plugin 貢獻可見按鈕時整條 bar 不渲染任何 DOM。

### Manifest 欄位：`actionButtons`

```json
{
  "actionButtons": [
    {
      "id": "recompute-state",
      "label": "🧮 重算狀態",
      "icon": "🧮",
      "tooltip": "Recompute state diff for the latest chapter",
      "priority": 100,
      "visibleWhen": "last-chapter-backend"
    }
  ]
}
```

每個 `ActionButtonDescriptor` 欄位定義：

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `id` | `string` | ✅ | 按鈕識別碼，須符合 `^[a-z0-9-]+$`（kebab-case），同一 plugin 內必須唯一 |
| `label` | `string` | ✅ | 顯示文字，trim 後長度需介於 1..40 字元 |
| `icon` | `string` | ❌ | 短小符號或 emoji（保留欄位，目前由 `label` 一併呈現） |
| `tooltip` | `string` | ❌ | 滑鼠停留時的說明，長度上限 200 字元 |
| `priority` | `number` | ❌ | 排序權重（finite），預設 `100`；數字小者先渲染 |
| `visibleWhen` | `enum` | ❌ | 可見性條件，預設 `"last-chapter-backend"` |

Loader 會逐項驗證 `actionButtons`；無效項目會被個別丟棄並記錄警告，plugin 其餘部分仍正常載入。同一 plugin 中重複的 `id` 保留先出現者並對後者記警告。`GET /api/plugins` 回傳的每個 plugin 描述都會帶 `actionButtons` 陣列；未宣告者保證為 `[]`。`GET /api/plugins/action-buttons` 會額外套用設定過濾：當 owning plugin 的 resolved `enabled === false` 時，該 plugin 的按鈕不出現在回應中；前端點擊路徑也會再次檢查設定並 no-op，避免 stale cache race。

#### `visibleWhen` 列舉值

v1 版本僅提供兩個值，未來可在不破壞相容的前提下擴充：

| 值 | 何時顯示 |
|----|----------|
| `"last-chapter-backend"`（預設） | 目前顯示的章節為故事最後一章時 |
| `"backend-only"` | 任何章節（包含非最後一章） |

兩個值皆會渲染——保留雙值列舉以維持與未來顯示模式擴充的相容性。可見性會在路由、章節索引變化時自動重新計算。

範例：

```json
// 只在後端模式的最後一章顯示（適合「處理最新章節」類動作）
{ "id": "recompute-state", "label": "🧮 重算狀態", "visibleWhen": "last-chapter-backend" }

// 後端模式的任何章節都顯示（適合不依賴章節位置的動作）
{ "id": "open-tools", "label": "🛠 工具", "visibleWhen": "backend-only" }
```

### 前端 hook：`action-button:click`

使用者點擊按鈕時，前端 `FrontendHookDispatcher` 會以 `async` 方式分派 `action-button:click` 階段。Dispatcher 只會呼叫**擁有該按鈕之 plugin** 所註冊的 handler（依 `originPluginName === context.pluginName` 過濾），並依 `priority` 順序逐一 `await`。在 dispatch promise 結算（resolve 或 reject）前，按鈕會以 `pendingKey = ${pluginName}:${buttonId}` 記錄在 pending 集合中並維持 disabled 狀態，避免重複點擊。

Context 物件：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `buttonId` | `string` | 被點擊按鈕的 `id` |
| `pluginName` | `string` | 擁有該按鈕的 plugin 名稱 |
| `series` | `string` | 目前系列名稱（後端模式保證存在） |
| `name` | `string` | 目前故事名稱（後端模式保證存在） |
| `storyDir` | `string` | 目前故事目錄絕對路徑（後端模式保證存在） |
| `lastChapterIndex` | `number \| null` | 最新章節的 1-based index；尚無章節時為 `null` |
| `runPluginPrompt` | `function` | 已 curry `pluginName` 的 helper，見下節 |
| `notify` | `function` | 通知 helper（同 `notification` hook 中之 `notify`） |
| `reload` | `function` | 觸發章節重新載入的便捷函式（內部呼叫 `useChapterNav.reloadToLast()`） |

> **注意**：v1 **不**提供 `appendToLastChapter` helper。需要把 LLM 回應寫入章節時，請於呼叫 `runPluginPrompt` 時帶 `{ append: true, appendTag: "..." }` 或 `{ replace: true }`，由後端統一在伺服器端執行 atomic append／replace、章節重讀、`post-response` 派發等流程。

任一 handler 拋出或 reject 時，dispatcher 會在 handler 自身**沒有**主動 `notify` 的情況下發出預設錯誤 toast，仍會 resolve 整體 dispatch（不留下 unhandled rejection）。

### `runPluginPrompt(promptFile, opts?)` Helper

這個 helper 由 `useChatApi` 提供，並以 `pluginName` 預先 curry 後注入 `action-button:click` 的 context；plugin 因此無法觸發其他 plugin 的 prompt。簽章：

```typescript
runPluginPrompt(
  pluginName: string,             // 在 context 中已 curry，plugin 端不需自行傳入
  promptFile: string,             // 相對於 plugin 目錄，必須是 .md 檔
  opts?: {
    append?: boolean;             // 預設 false
    appendTag?: string;           // append=true 時必填，須符合 ^[a-zA-Z][a-zA-Z0-9_-]{0,30}$
    replace?: boolean;            // 預設 false；與 append 互斥
    extraVariables?: Record<string, string | number | boolean>; // 僅允許純量
  }
): Promise<{
  content: string;                // append=true 時為 trim 後的「歸一化回應」；replace=true 時為寫入後的完整內容；其餘為原始 LLM 回應
  usage: TokenUsageRecord | null; // 上游回傳的 token 用量（若有）
  chapterUpdated: boolean;        // append=true 並成功寫入時為 true
  chapterReplaced: boolean;       // replace=true 並成功覆寫時為 true
  appendedTag: string | null;     // 實際附加的 tag（append=true 時等於 appendTag，否則為 null）
}>
```

行為要點：

- 與一般 `chat:send` 共用 `isLoading` / `streamingContent` / `errorMessage` / `abortCurrentRequest`，因此使用者按下「⏹ 停止」可以中斷正在跑的 plugin action。
- 當 `isLoading.value === true`（一般 send 或另一個 plugin action 正在進行）時，呼叫會以 reject 回應，避免重疊。
- 當 WebSocket 已連線時走 WS 路徑並把進度餵入 `streamingContent`；HTTP fallback 一次性回傳最終 JSON，不提供逐字串流。
- 後端會以同一 Vento engine、同一 dynamic-variable 管線渲染 `promptFile`；`extraVariables` 必須為純量且不得撞到保留變數名（`previousContext`、任何 `lore_*`、`status_data`、`draft` 等）。`user_input` 在 plugin action 預設為空字串，但範本本身**仍須**至少 emit 一個 `{{ message "user" }}…{{ /message }}` 區塊，否則回 422 `multi-message:no-user-message`。
- `replace` 與 `append` 互斥：同時設定 `replace: true` 與 `append: true` 會被拒絕（HTTP 400）。`replace: true` 加上 `appendTag` 也會被拒絕。

#### WebSocket 信封流程

WebSocket 通道使用以下 envelope（已加進 `WsClientMessage` / `WsServerMessage` 的 discriminated union）：

| 方向 | 型別 | 說明 |
|------|------|------|
| Client → Server | `plugin-action:run` | 啟動一次 plugin action（含 `pluginName`、`series`、`name`、`promptFile`、`append`、`appendTag`、`replace`、`extraVariables`） |
| Client → Server | `plugin-action:abort` | 中止目前進行中的 plugin action |
| Server → Client | `plugin-action:delta` | 串流中的增量 chunk |
| Server → Client | `plugin-action:done` | 完成；payload 等同 helper 回傳的 `{ content, usage, chapterUpdated, chapterReplaced, appendedTag }` |
| Server → Client | `plugin-action:error` | 失敗；payload 為 RFC 9457 Problem Details |
| Server → Client | `plugin-action:aborted` | 已中止；append 與 `post-response` 都不會發生 |

HTTP fallback（`POST /api/plugins/:pluginName/run-prompt`）僅回傳最終 JSON，沒有逐 chunk 進度保證。

### Append 行為與 `post-response` 派發

當 `append: true` 時：

1. 後端串完 LLM 回應後，把累積內容做一次「外層 wrapper 歸一化」——若 trim 後內容剛好被一層 `<{appendTag}>…</{appendTag}>` 包住，就剝掉這唯一的最外層；最多剝一層，避免破壞合法的同名巢狀結構。
2. 以 atomic 方式把 `\n<{appendTag}>\n{歸一化內容}\n</{appendTag}>\n` 接到故事中編號最大的章節檔尾端。
3. 重新讀取整份章節檔，並以 deep-frozen `PostResponsePayload`：`{ correlationId, content: <append 後完整章節內容>, chapterPath, chapterNumber, storyDir, series, name, rootDir, source: "plugin-action", pluginName, appendedTag, endpoint, usage }` 派發 `post-response`。
4. `pre-write` 與 `response-stream` 在 `append-to-existing-chapter` 模式**不會**派發；中止（abort）發生時，append 步驟與 `post-response` 都會被略過。

換句話說，正常聊天回合與 plugin action append 對 `post-response` 看到的 `content` 同樣是「append 後的完整章節內容」，下游 replay／diff 邏輯不需要區分來源。

### Replace 行為（`replace-last-chapter` WriteMode）

當 `replace: true` 時，後端以 **atomic overwrite** 模式覆寫故事中編號最大的章節檔：

1. 後端串完 LLM 回應後，以 `replace-last-chapter` WriteMode 將累積內容直接覆寫最高編號的章節檔案（整檔取代，不做 append 或歸一化包裹）。
2. 寫入前先將原始章節內容備份至記憶體；若中途發生錯誤或使用者中止（abort），原始檔案內容會被**逐位元組還原**（byte-for-byte preserved），不會產生半寫入或損毀的檔案。
3. 覆寫成功後，以 deep-frozen `PostResponsePayload`：`{ correlationId, content: <覆寫後完整章節內容>, chapterPath, chapterNumber, storyDir, series, name, rootDir, source: "plugin-action", pluginName, endpoint, usage }` 派發 `post-response`（`appendedTag` 在 replace 模式**不會**被設定）。
4. `pre-write` 與 `response-stream` 在 replace 模式**不會**派發。

**互斥規則：**

- `replace: true` 與 `append: true` 互斥，同時設定回 HTTP 400 `plugin-action:conflicting-write-mode`。
- `replace: true` 搭配 `appendTag` 也會被拒絕（HTTP 400），因為 replace 模式不使用標籤包裹。

**回應欄位：**

- `chapterReplaced: boolean`：replace 模式成功覆寫時為 `true`，其餘情境為 `false`。

### `draft` 保留變數

在 replace 模式下，後端會自動將當前最高編號章節的完整內容（經過所有 plugin 的 `promptStripTags` 清理後）注入為 Vento 模板變數 `draft`。Plugin 的提示詞範本可透過 `{{ draft }}` 引用原始章節內容，供 LLM 在改寫時參考。

規則：

- `"draft"` 為系統保留的變數名稱，呼叫端**不得**透過 `extraVariables` 覆寫此值——若嘗試覆寫，後端回 HTTP 400。
- 僅在 `replace: true` 時注入；`append` 模式或無寫入模式下不會產生 `draft` 變數。
- 注入的內容已套用 `promptStripTags`，與 `previous_context` 的清理管線一致。

### 路徑安全

- `promptFile` 必須是相對路徑，副檔名必須為 `.md`，且必須是 regular file。
- 後端先以 `safePath()` 解析，再對 plugin 目錄與解析後的 prompt 路徑同時呼叫 `Deno.realPath()` 取得 canonical path，最後以 `isPathContained()` 驗證 prompt 落在 plugin 目錄之內——這同時擋下 `..` 路徑穿越與 symlink 跳脫。
- 違反任一條件即回 400/404 對應的 `plugin-action:invalid-prompt-path` / `plugin-action:non-md-prompt` / `plugin-action:prompt-file-not-found`。

### Rate Limit

`POST /api/plugins/:pluginName/run-prompt` 與 WebSocket 上的 `plugin-action:run` 共用一個 **每分鐘 30 次（每 client）** 的路由級 rate limiter，與 `chat` 路由相同；超過上限回 HTTP 429。全域 300/min 限制仍適用。

### 並行限制

整個故事一次只能有一個 LLM generation 進行中。Plugin action 在啟動 LLM 呼叫前會以 `tryMarkGenerationActive(series, name)` 取得 per-story generation lock；若已被其他流程（一般聊天或另一次 plugin action）持有，會回 HTTP 409 `plugin-action:concurrent-generation`。Lock 會在 `finally` 區塊釋放，無論成功、失敗或中止。

### 完整範例：state 重算狀態按鈕

`plugins/state/plugin.json`：

```json
{
  "name": "state",
  "displayName": "狀態追蹤",
  "version": "1.0.0",
  "description": "Track and display state diff per chapter",
  "type": "full-stack",
  "frontendModule": "./frontend.js",
  "backendModule": "./handler.js",
  "tags": ["UpdateVariable"],
  "promptStripTags": ["UpdateVariable"],
  "actionButtons": [
    {
      "id": "recompute-state",
      "label": "🧮 重算狀態",
      "tooltip": "Recompute state diff for the latest chapter",
      "priority": 100,
      "visibleWhen": "last-chapter-backend"
    }
  ]
}
```

`plugins/state/frontend.js`（節錄）：

```javascript
export function register(hooks) {
  hooks.register('action-button:click', async (context) => {
    if (context.buttonId !== 'recompute-state') return;

    try {
      await context.runPluginPrompt('state-recompute.md', {
        append: true,
        appendTag: 'UpdateVariable',
      });
      context.reload();
      context.notify({
        title: '已重算狀態變更',
        body: '最新章節的狀態 patch 已重新生成並寫入。',
        level: 'info',
      });
    } catch (err) {
      context.notify({
        title: '重算狀態失敗',
        body: err?.message ?? String(err),
        level: 'error',
      });
    }
  }, 100);
}
```

`plugins/state/state-recompute.md`（草稿）：

```vento
{{ message "system" }}
You are computing a JSON patch describing the variable state changes implied by the latest chapter.
Return ONLY a `<UpdateVariable>` JSON block; do NOT include narrative text outside the tag.
{{ /message }}

{{ message "user" }}
Prior state:
```json
{{ status_data }}
```

Latest chapter content:
{{ previous_context }}

Emit the JSON patch now.
{{ /message }}
```

> 範本必須至少包含一個 `{{ message "user" }}…{{ /message }}` 區塊；否則後端會回 422 `multi-message:no-user-message`，與一般聊天的契約一致。

## Plugin Settings

Plugin 可透過在 manifest 中宣告 `settingsSchema` 取得一組由系統提供的設定 API 與閱讀器內建的設定頁。設定值持久儲存於 `playground/_plugins/<pluginName>/config.json`，與其他使用者資料一起保留於 `PLAYGROUND_DIR`。

完整規格見 [`openspec/specs/plugin-settings/spec.md`](../openspec/specs/plugin-settings/spec.md)。

### 宣告 `settingsSchema`

`settingsSchema` 為 JSON Schema 子集（HeartReverie 自有方言；hand-rolled validator）。它必須是物件型 schema（`type: "object"`、帶 `properties`）且**必須宣告 `x-schema-version: 1`**。Plugin 載入時 PluginManager 會驗證頂層結構與 `x-*` 擴充欄位的硬性規則；不符規格者會被拒絕並記錄錯誤。

```json
{
  "name": "sd-webui-image-gen",
  "displayName": "SD WebUI 配圖",
  "version": "1.0.0",
  "description": "Generate scene images via Automatic1111 / Stable Diffusion WebUI",
  "type": "full-stack",
  "backendModule": "./handler.ts",
  "settingsSchema": {
    "type": "object",
    "x-schema-version": 1,
    "properties": {
      "endpoint": {
        "type": "string",
        "title": "WebUI Endpoint",
        "format": "url",
        "default": "http://localhost:7860"
      },
      "apiKey": {
        "type": "string",
        "title": "API Key",
        "writeOnly": true
      },
      "model": {
        "type": "string",
        "title": "Checkpoint",
        "x-options-url": "/api/plugins/sd-webui-image-gen/proxy/sd-models"
      },
      "samplers": {
        "type": "array",
        "title": "Allowed Samplers",
        "items": { "type": "string" },
        "x-options-url": "/api/plugins/sd-webui-image-gen/proxy/samplers"
      },
      "savePath": {
        "type": "string",
        "title": "Save Directory",
        "format": "path",
        "x-path-roots": ["playground/_plugins/sd-webui-image-gen/"]
      },
      "enabled": { "type": "boolean", "default": true }
    }
  }
}
```

#### 支援的關鍵字

| 類別 | 關鍵字 |
|------|------|
| Type | `string`、`number`、`integer`、`boolean`、`array`、`object`、`null` |
| Numeric | `minimum`、`maximum`、`exclusiveMinimum`、`exclusiveMaximum`、`multipleOf` |
| String | `minLength`、`maxLength`、`pattern`（ECMAScript regex）、`format` |
| Array | `items`、`minItems`、`maxItems`、`uniqueItems` |
| Object | `properties`、`required`、`additionalProperties`（僅 boolean） |
| Composition | `enum`、`const` |
| Annotation | `title`、`description`（純文字）、`default`、`writeOnly` |

`format` 白名單僅含 `path`、`color`、`url`、`email`、`uuid`。其他值不會觸發驗證錯誤（silent ignore）。**機密欄位應使用 `writeOnly: true`，不要透過 `format` 表達**。

#### `x-*` 擴充欄位

| 關鍵字 | 用途 |
|------|------|
| `x-schema-version: 1` | **必填**。Schema 方言版本；未來主版本升級時的硬性圍籬 |
| `x-show-when` | 條件可見性。形式 `{ field, equals \| notEquals \| in }`；`field` 必須是同層 sibling property，且該 property 不能同時出現在 `required` 中 |
| `x-options-url` | `select` / `multi-select` / `combobox` widget 從這個 URL 抓取選項。回應 shape：`{ options: [{ value, label }] }` |
| `x-path-roots` | 限縮 `format: "path"` 欄位的允許根目錄。**只能縮小**硬編碼集合（`playground/lore/`、`playground/chapters/`、`playground/_plugins/<pluginName>/`），不能擴張。空交集會在載入時被拒絕 |
| `x-previous-names` | 欄位重新命名遷移；`GET` 時以記憶體內方式把舊鍵值搬到新名稱，後續成功 `PUT` 才落盤 |
| `x-legacy: true` | 頂層旗標。允許 `config.json` 內保留 schema 未描述的舊鍵，落盤時會被搬到頂層 `x-legacy: {...}` 命名空間。`x-legacy` 命名空間永不外洩給前端 |

`writeOnly: true` 的欄位：`GET` 回應遮蔽為 `null`；`PUT` 收到 `null` 表示「保留現值」（短路在型別檢查之前），`""` 表示「清空」，其他值正常驗證後寫入。

### Settings 端點

| 端點 | 說明 |
|------|------|
| `GET /api/plugins/:name/settings-schema` | 回傳完整 JSON Schema（含所有 `x-*` 關鍵字）。未宣告時 404 |
| `GET /api/plugins/:name/settings` | 預設值 + `config.json` 合併。`writeOnly` 欄位遮蔽為 `null`；`x-previous-names` 在記憶體內遷移；若 disk 有違反目前 schema 的舊值，會附帶 `x-legacy-warnings: ValidationError[]` 不阻擋 GET |
| `PUT /api/plugins/:name/settings` | 結構化驗證；接收選填的頂層 `_changedPaths: string[]` 欄位做兩階段驗證 |
| `POST /api/plugins/:name/settings/validate` | 純驗證，永不落盤；永遠回 200 + envelope |
| `GET /api/plugins/:name/settings/schema-meta` | 回傳 `{ schemaVersion, pathRoots, formats }` |

所有端點皆受 passphrase middleware 保護；reader-only 部署（`HEARTREVERIE_READER_ONLY=1`）時全部回 404。

#### 結構化錯誤封套

`PUT` 的成功與失敗回應**都**含 `{ errors: ValidationError[], warnings: ValidationError[] }`。`ValidationError` shape：

```
{ "path": "items[0].name", "keyword": "pattern", "messageKey": "pattern", "params": { "pattern": "^[a-z]+$" } }
```

`messageKey` 用於前端 i18n 查表；前端找不到時 fallback 為 `keyword` + `params` 的通用訊息。

#### 兩階段驗證（`_changedPaths`）

`PUT` body 頂層可加上 `_changedPaths: string[]`（不會被持久化）。Server 永遠額外計算 `incoming ⊝ disk` 的實際 diff。**阻擋範圍** = `actualDiff ∪ _changedPaths`。錯誤的 `path` 落在阻擋範圍之內 → 400 阻擋；之外 → 200 + 列為 `warnings`。

效果：使用者只修了 A 欄位，但 disk 內 B 欄位有舊有違規 → 仍可存檔（B 變 warning）；但若使用者誤把 `_changedPaths` 設成空陣列又動到了 A 的無效值 → server 仍會偵測到實際 diff 並阻擋。`_changedPaths` 是給前端做 UX 用，不是 trust boundary。

`writeOnly: true` + `null` 短路機制讓「未修改密碼」的 round-trip 不需要把明文送回 server。

### 設定頁與 widget registry

閱讀器在 `/settings/plugins/:name` 路由顯示自動產生的表單。`PluginSettingsPage` 透過 `<SchemaField>` 遞迴渲染，每個欄位由 `WidgetRegistry` 依 schema 比對解析出最高優先序的 widget。

Phase 1 內建 widget 集合（priority 高 → 低）：

| Widget | match 條件 |
|------|------|
| `multi-select` | `type: array` 且 `items.enum` 或 `items.x-options-url` |
| `repeater` | `type: array` 且 `items.type: object` |
| `path-picker` | `format: "path"` |
| `range-number` | `type: number\|integer` 且同時有 `minimum` 與 `maximum` |
| `masked-secret` | `writeOnly: true` |
| `combobox` | `type: string` 且 `x-options-url`（無 `enum`） |
| `select` | `enum` 在 `type: string` 上 |
| `color` | `format: "color"` |
| `tags` | `type: array` 且 `items.type: string`（無 `enum`、無 object/array items） |
| `object-fieldset` | `type: object` |
| `checkbox` | `type: boolean` |
| `number` | `type: number\|integer` |
| `text` | fallback |

**Phase 1 不允許 plugin 註冊自訂 widget**；前端 `register(context)` 不會新增 widget API。`x-options-url` 維持原樣，由 `select` / `multi-select` / `combobox` 在掛載時抓取選項（passphrase 標頭一併送出），失敗時降級到 `enum` 並顯示 inline 錯誤。

`x-show-when` 在前端評估：條件為 false 時欄位以 `v-if` 從 DOM 移除；模型值仍保留在 form 狀態中，重新顯示時恢復。隱藏欄位的 path 會從 `_changedPaths` 中排除，使其違規不會阻擋存檔。

### Plugin 端取用設定

Plugin 後端模組可在 `registerRoutes(context)` 中以 `context.getSettings()` / `context.saveSettings(...)` 讀寫自身設定（見下節）。一般 `register(context)` 取得的 context 也提供 `getSettings()`，可在 hook handler 執行時讀取最新設定；不要在模組載入時永久快取設定。`getDynamicVariables(context)` 則可使用 `context.getSettings?.()` 讀取自身設定。

`enabled` 是內建的通用慣例：engine 會在 `getPromptVariables()` 與 `getDynamicVariables()` 中中央化跳過 disabled plugin 的提示詞與動態變數，並在 action-button API 過濾按鈕。Plugin 自身仍必須在前端 hook 與後端 hook 中讀取設定並自行 no-op。`promptStripTags` 與 `displayStripTags` 不受 `enabled` 影響，這是刻意設計，使 plugin 停用後歷史章節中的標籤仍能被清除。

## Plugin 自訂 API 路由

後端模組可在 `register`／`getDynamicVariables` 之外，額外匯出 `registerRoutes(context)` 函式。系統會在 `createApp()` 期間呼叫一次，並把該 plugin 自家的 Hono routes 掛載到 `/api/plugins/:name/*` 命名空間下；所有路由自動共用 passphrase 認證 middleware。

完整規格見 [`openspec/specs/plugin-core/spec.md`](../openspec/specs/plugin-core/spec.md) 的「Plugin route registration」需求。

### 簽章

```typescript
// writer/types.ts
export interface PluginRouteContext {
  readonly app: Hono;            // 整個 Hono app；plugin 應只在自己的 basePath 下註冊
  readonly basePath: string;     // "/api/plugins/<pluginName>"
  readonly logger: Logger;       // 已綁定 plugin 名稱的結構化 logger
  readonly getSettings: () => Promise<Record<string, unknown>>;
  readonly saveSettings: (settings: Record<string, unknown>) => Promise<void>;
  readonly config: AppConfig;    // 唯讀的全域設定（PLAYGROUND_DIR 等）
}
```

`registerRoutes` 可為同步或非同步。若回傳 Promise，系統會在 `initPluginRoutes(app)` 中等待所有 plugin 完成註冊後才開放服務。

### 範例

```typescript
// handler.ts
import type { PluginRegisterContext, PluginRouteContext } from "../../writer/types.ts";

export function register({ hooks, logger }: PluginRegisterContext): void {
  // ...一般 hook 註冊
}

export async function registerRoutes(ctx: PluginRouteContext): Promise<void> {
  const { app, basePath, logger, getSettings } = ctx;

  // 代理 SD WebUI 的 /sdapi/v1/sd-models，將結果作為 settingsSchema 的 x-options-url 候選
  app.get(`${basePath}/proxy/sd-models`, async (c) => {
    const settings = await getSettings();
    const endpoint = String(settings.endpoint ?? "http://localhost:7860");
    try {
      const res = await fetch(`${endpoint}/sdapi/v1/sd-models`);
      if (!res.ok) return c.json([], 200);
      const models = (await res.json()) as Array<{ title: string }>;
      return c.json(models.map((m) => m.title));
    } catch (err) {
      logger.warn("sd-webui proxy failed", { error: String(err) });
      return c.json([]);
    }
  });

  // 觸發圖片生成；寫入 PLAYGROUND_DIR/<series>/<story>/_images/ 後由 story-image-serving 路由提供出去
  app.post(`${basePath}/generate`, async (c) => {
    // ...
    return c.json({ ok: true });
  });
}
```

### 限制與安全

- 路由只能掛載於自家 `basePath` 之下；註冊在 `basePath` 之外的 path 雖然技術上可達，但會遭路徑檢查或前端 `/plugins/...` 命名空間阻擋。Plugin 應永遠以 `${basePath}/...` 為前綴。
- 所有 `/api/plugins/:name/*` 路徑共用全域 passphrase 認證——plugin 不需自行驗證 passphrase。
- `registerRoutes` 異常或 `Promise` reject 會被記錄但不會阻止伺服器啟動；其他 plugin 仍會繼續初始化。
- 路由命名建議冪等的 REST 風格（`proxy/...`、`generate`、`status` 等），避免與既有 `settings`／`settings-schema`／`run-prompt` 等系統路徑衝突。

## API 端點

系統提供下列與 plugin 相關的 API 端點。除非另有說明，所有端點皆受 passphrase 認證 middleware 保護。

### GET /api/plugins

回傳所有已載入 plugin 的 metadata 陣列：

```json
[
  {
    "name": "thinking",
    "displayName": "思維鏈",
    "version": "1.0.0",
    "description": "Think before reply and fold thinking tags",
    "type": "full-stack",
    "tags": ["thinking", "think"],
    "displayStripTags": [],
    "hasFrontendModule": true,
    "hasSettings": true,
    "settings": { "enabled": true },
    "frontendStyles": [],
    "actionButtons": []
  }
]
```

`hasSettings` 為 `true` 時，前端會在設定頁側欄列出該 plugin 的設定分頁（路由：`/settings/plugins/:name`）。

### GET /api/plugins/action-buttons

回傳所有目前可見的 plugin action buttons，並在每個項目附加 `pluginName`。若 owning plugin 的 resolved `enabled === false`，該 plugin 的所有按鈕會被省略。

### GET /api/plugins/parameters

回傳所有可用的 Vento 模板參數（包含核心參數與 plugin 參數）：

```json
[
  { "name": "lore_all", "type": "string", "source": "lore", "description": "..." },
  { "name": "think_before_reply", "type": "string", "source": "thinking", "description": "..." }
]
```

此端點供前端的提示詞編輯器使用，讓使用者在編輯模板時查看可用變數。

### Plugin Settings 端點

詳見「[Plugin Settings](#plugin-settings)」章節：

- `GET /api/plugins/:name/settings-schema` — 取得 plugin 的 JSON Schema
- `GET /api/plugins/:name/settings` — 取得已合併預設值的目前設定
- `PUT /api/plugins/:name/settings` — 驗證並儲存新設定

### Story Image Serving 端點

供 plugin（例如 sd-webui-image-gen）使用，將生成的圖片從故事目錄下的 `_images/` 子目錄提供出來。詳細規格見 [`openspec/specs/story-image-serving/spec.md`](../openspec/specs/story-image-serving/spec.md)。

| 端點 | 說明 |
|------|------|
| `GET /api/stories/:series/:story/images/:filename` | 提供 `PLAYGROUND_DIR/<series>/<story>/_images/<filename>` 的二進位圖片。`filename` 必須符合 `^[\w\-\.]+$`，並排除任何含 `..` 的請求。Content-Type 依副檔名推導（`.avif`／`.webp`／`.png`／`.jpg`／`.jpeg`／`.gif`／`.svg`），並附 `Cache-Control: public, immutable`。 |
| `GET /api/stories/:series/:story/image-metadata?chapter=<N>` | 回傳 `{ images: [...] }`，從 `_images/_metadata.json` 讀取，可選 `chapter` 查詢參數過濾單章。檔案不存在時回 `{ images: [] }`。 |

`/api/*` 的 body limit 為 10 MB，以容納 sd-webui 等服務回傳的 base64 圖片。

## 安全機制

Plugin 系統在多個層面實施安全防護：

### 路徑包含檢查

`backendModule`、`promptFragments`、`frontendModule` 的路徑在解析後必須位於 plugin 目錄內部。任何嘗試透過相對路徑（如 `../../etc/passwd`）存取外部檔案的行為都會被攔截。

### Plugin 名稱驗證

`isValidPluginName()` 函式拒絕包含 `..`、null byte、斜線等特殊字元的名稱。此外，manifest 中的 `name` 欄位必須與目錄名稱一致，防止 plugin 透過偽造名稱來覆蓋其他 plugin。

### 模板注入防護（SSTI Prevention）

使用者可透過前端編輯器自訂提示詞模板，這些模板在伺服器端由 Vento 引擎執行。`validateTemplate()` 函式以白名單方式解析模板中的 Vento 表達式，僅允許以下語法：

- 簡單變數引用（`{{ variable_name }}`）
- `for ... of` 迴圈
- `if` / `else` 條件判斷
- Pipe filter（`|> trim`）
- 註解（`{{# comment #}}`）

函式呼叫、屬性存取（`.`）、`process.env` 等運算式一律被拒絕，模板大小限制為 500KB。

### 前端模組靜態服務

`/plugins/:name/:file` 路由僅提供 manifest 中宣告的 `frontendModule` 檔案，不允許存取 plugin 目錄下的任意檔案。

## 使用外部外掛

本專案將部分選用外掛獨立維護於外部倉庫 [HeartReverie_Plugins](https://codeberg.org/jim60105/HeartReverie_Plugins.git)，提供更豐富的提示詞片段與功能擴充。以下說明如何啟用這些外掛。

### 取得外部外掛

```bash
git clone https://codeberg.org/jim60105/HeartReverie_Plugins.git
```

### 設定環境變數

將 `PLUGIN_DIR` 指向已複製的目錄絕對路徑，並將外掛的 `system.md` 複製至專案根目錄覆寫預設提示詞模板（其中引用了外部外掛提供的模板變數）：

```bash
# .env
PLUGIN_DIR=/path/to/HeartReverie_Plugins
```

```bash
# 複製外掛提示詞模板至專案根目錄
cp /path/to/HeartReverie_Plugins/system.md ./system.md
```

或以命令列方式啟動：

```bash
PLUGIN_DIR=/path/to/HeartReverie_Plugins \
./scripts/serve.sh
```

> [!WARNING]
> 請勿以 `PROMPT_FILE` 環境變數指向外部外掛的 `system.md`。`PROMPT_FILE` 用於儲存使用者自訂的提示詞，按下「重置」按鈕時該檔案會被刪除。應以複製方式覆寫專案根目錄的 `system.md`，讓重置後仍可正確回復至外掛版提示詞。

> [!NOTE]
> 當外部 plugin 的名稱與內建 plugin 相同時，外部版本會覆蓋內建版本。系統會在 console 記錄覆蓋資訊。

## 撰寫自訂 Plugin

### 最小範例：prompt-only

建立 `plugins/my-plugin/` 目錄，加入兩個檔案：

**plugin.json**

```json
{
  "name": "my-plugin",
  "displayName": "我的外掛",
  "version": "1.0.0",
  "description": "自訂提示詞指令",
  "type": "prompt-only",
  "promptFragments": [
    { "file": "./instructions.md", "variable": "my_instructions", "priority": 100 }
  ]
}
```

**instructions.md**

```markdown
以下是自訂指令的內容，會在渲染時注入模板中的 {{ my_instructions }} 位置。
```

接著在 `system.md` 模板中加入 `{{ my_instructions }}` 即可。

### 完整範例：full-stack

一個同時包含提示詞片段、後端 hook、前端模組的 plugin：

**plugin.json**

```json
{
  "name": "my-fullstack",
  "displayName": "我的全端外掛",
  "version": "1.0.0",
  "description": "完整功能 plugin 範例",
  "type": "full-stack",
  "promptFragments": [
    { "file": "./prompt.md", "variable": "my_var", "priority": 100 }
  ],
  "backendModule": "./handler.js",
  "frontendModule": "./frontend.js",
  "tags": ["mytag"],
  "promptStripTags": ["mytag"],
  "displayStripTags": ["mytag"]
}
```

**handler.js**

```javascript
export function register({ hooks, logger }) {
  logger.info('Plugin initialized');

  hooks.register('post-response', async (ctx) => {
    const log = ctx.logger ?? logger;
    // ctx 為 deep-frozen PostResponsePayload — 切勿修改
    log.info('章節已寫入', {
      correlationId: ctx.correlationId,
      chapter: ctx.chapterNumber,
      source: ctx.source,                      // "chat" | "continue" | "plugin-action"
      pluginName: ctx.pluginName ?? null,      // 僅 source === "plugin-action" 才存在
      endpoint: ctx.endpoint,                  // 解析後的上游 URL
      tokens: ctx.usage?.totalTokens ?? null,
      upstreamCostUsd: ctx.usage?.upstreamCostUsd ?? null,
    });
  }, 100);
}
```

**frontend.js**

```javascript
export function register(hooks) {
  hooks.register('frontend-render', (context) => {
    // 自訂渲染邏輯
  }, 100);
}
```

### 使用外部 plugin 目錄

將 `PLUGIN_DIR` 環境變數設為外部目錄的絕對路徑，系統會在啟動時額外掃描該目錄。外部 plugin 與內建 plugin 同名時，外部版本會覆蓋內建版本。

## 內建 Plugin 一覽

| Plugin | 類型 | 功能 |
|--------|------|------|
| context-compaction | full-stack | 長篇脈絡壓縮，自動摘要早期章節 |
| dialogue-colorize | frontend-only | 對話標籤上色顯示，透過 `chapter:dom:ready` / `chapter:dom:dispose` 以 CSS Custom Highlight API 標示引號區段，不修改 DOM |
| polish | full-stack | 一鍵文學潤飾改寫；貢獻 `✨ 潤飾` 動作按鈕（`visibleWhen: "last-chapter-backend"`），以 `replace: true` 原子覆寫最新章節。前端模組為薄層 action-button click 接線 |
| reading-progress | full-stack | 單一使用者多裝置閱讀進度同步——章節編號、捲動比例與文字片段錨點，支援檔案或瀏覽器本地兩種儲存後端 |
| start-hints | prompt-only | 首輪章節開場引導提示，含提示詞與顯示標籤清除 |
| thinking | full-stack | 回覆前思考指令與折疊 `<thinking>`/`<think>` 標籤為可展開的 details 元素 |
| user-message | full-stack | 使用者訊息標籤前端清除，pre-write hook 注入使用者訊息區塊 |
| response-notify | full-stack | 後端 → 前端 Toast 通知系統，透過 `notification` hook 推送使用者提示 |

> [!NOTE]
> 內建 plugin 的提示詞內容必須維持 SFW（Safe For Work）。禁止包含 NSFW 內容、越獄指令（jailbreak）或年齡相關指示。使用者如有此類需求，應透過外部 plugin（`PLUGIN_DIR`）自行提供。

## Hook Inspector

Hook Inspector 是一套**啟動期一致性檢查 + 執行期觀測**機制，協助 plugin 作者及部署者快速確認後端／前端 hook 是否如預期註冊，並偵測多 plugin 之間可能的衝突。

### Manifest 欄位：`hooks`

`plugin.json` 可宣告 plugin 預期註冊的 hook 階段陣列：

```json
{
  "name": "my-plugin",
  "displayName": "我的外掛",
  "hooks": [
    { "stage": "post-response", "reads": ["content", "usage", "endpoint", "source"] },
    { "stage": "frontend-render" }
  ]
}
```

- `stage`（必填）：hook 階段名稱（後端或前端皆可）。
- `reads` / `writes`（選填）：宣告該 handler 會讀取／寫入的 pipeline 欄位，供衝突偵測使用。**注意**：`post-response` 的 payload 為 deep-frozen，handler 無法修改任何欄位，因此該 stage 不應宣告 `writes`。

**嚴格宣告／註冊一致性**：當 `hooks` 欄位存在（即使為空陣列）時，系統會於 plugin 載入後比對「宣告 vs 實際 `hooks.register()` 呼叫」。若有差異，plugin 載入會被回滾並寫入 `declaredOnly`／`registeredOnly` 的錯誤訊息。**省略 `hooks` 欄位**則進入 legacy 模式（不檢查），用於相容尚未遷移的外部 plugin。

新撰寫的 plugin **必須**宣告 `hooks`，建議將 `register()` 內每個 `hooks.register(stage, ...)` 對應地寫入 manifest。

### Hook Inspector 頁面

瀏覽器內進入「設定 → 開發者工具 → Hook Inspector」（路由 `/settings/hook-inspector`），需通過通行碼驗證。頁面以 stage → handler 樹狀結構顯示：

- 後端／前端各階段已註冊的 handler（plugin 名稱、priority、`errorCount`「自上次重啟以來」累計）。
- 衝突告警（C1：兩個 plugin 對同一欄位都宣告 `writes`；C2：讀取了沒人寫入的欄位；C3：同一 `(plugin, stage)` 重複註冊；C4：宣告與註冊不符）。
- Strip-tag 宣告（哪個 plugin 管理哪些標籤）。
- 啟動期 mismatch 摘要（若有）。

頁面右上角的「重新整理」按鈕重新拉取 `/api/plugin-introspection/hooks`。每次成功取得資料後，前端會以 `frontendHooks.dispatch("hook-inspector:report", payload)` 派發 [`hook-inspector:report`](#typed-events) 事件，方便其他 plugin（例如告警 logger）訂閱。

### CLI：`deno task introspect:hooks`

容器內可執行：

```bash
podman exec heartreverie deno task introspect:hooks
```

輸出為單一 JSON 物件，欄位包含 `backend`、`frontend`、`manifestDeclarations`、`stripTags`、`pipelineFields`、`generatedAt`，供 CI 或第三方工具消費。stderr 會輸出 plugin 載入 log，stdout 維持純 JSON。

### Typed event：`hook-inspector:report`

Plugin 可在前端訂閱：

```javascript
window.HeartReverie.hooks.register("hook-inspector:report", (report) => {
  console.log("conflicts:", report.conflicts);
  console.log("backend handlers:", report.backend);
});
```

`payload` 型別與 Hook Inspector 頁面顯示的資料一致。companion plugin `hook-inspector-logger`（位於 `HeartReverie_Plugins/`）展示了一個最小訂閱者實作。

[prompt-template]: ./prompt-template.md
[lore-codex]: ./lore-codex.md

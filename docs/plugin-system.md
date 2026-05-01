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
└── ...（共 6 個 plugin）
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

## Plugin Manifest 規格

每個 plugin 目錄下必須包含一個 `plugin.json`，其 `name` 欄位必須與目錄名稱一致。以下是完整的欄位定義：

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `name` | `string` | ✅ | Plugin 的唯一識別名稱，必須與目錄名稱相同 |
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
| `parameters` | `array` | ❌ | 自訂 Vento 模板參數宣告 |

### Plugin 類型

`type` 欄位決定 plugin 的功能範圍：

| 類型 | 說明 | 範例 |
|------|------|------|
| `prompt-only` | 僅提供提示詞片段，不包含後端或前端邏輯 | imgthink、start-hints |
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
- Plugin 名稱不得包含 `..`、`\0`、`/`、`\` 等路徑穿越字元

驗證失敗時，系統記錄警告並跳過該 plugin，不影響其餘 plugin 的載入。

### 後端模組初始化

具有 `backendModule` 的 plugin 會在探索完成後進行模組初始化。系統以 `import()` 動態載入模組（在 Deno 中使用 `file://` URL），並呼叫其匯出的 `register(context)` 函式。context 物件包含 `hooks`（HookDispatcher 實例）和 `logger`（已綁定 plugin 名稱的 Logger 實例），讓 plugin 向 HookDispatcher 註冊 hook 處理函式並記錄結構化日誌。系統亦支援 `mod.default` 作為 `register` 匯出的備援（即 `const registerFn = mod.register || mod.default;`）。

模組路徑必須通過路徑包含檢查——解析後的絕對路徑必須位於 plugin 目錄內部，否則跳過載入。

若模組同時匯出 `getDynamicVariables(context)` 函式，系統會在渲染提示詞時呼叫該函式，取得動態模板變數（見「動態變數」章節）。

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

- 動態變數不得覆寫核心變數（`previous_context`、`user_input`、`isFirstRound`、`series_name`、`story_name`、`plugin_fragments`），否則記錄警告並忽略
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

- **`promptStripTags`**：在後端組建提示詞時生效。系統讀取已儲存的章節內容組建 `previousContext` 時，移除符合 pattern 的標籤，確保這些標籤不會出現在送往 LLM 的提示詞中。
- **`displayStripTags`**：在前端瀏覽器渲染時生效。前端在顯示章節內容時移除符合 pattern 的標籤，確保讀者不會看到這些內部標記。

兩個欄位支援相同的 pattern 格式：純文字標籤名稱和正規表達式。

### 純文字標籤

最簡單的形式是直接寫標籤名稱：

```json
{
  "promptStripTags": ["disclaimer", "user_message"],
  "displayStripTags": ["disclaimer", "imgthink"]
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

HookDispatcher 提供五個生命週期階段，plugin 可在任意階段註冊非同步處理函式：

| 階段 | 觸發時機 | Context 參數 |
|------|---------|-------------|
| `prompt-assembly` | 系統提示詞渲染期間 | `{ previousContext, rawChapters, storyDir, series, name }` |
| `response-stream` | 每次從 LLM SSE 串流解析出非空內容片段時 | `{ correlationId, chunk, series, name, storyDir, chapterPath, chapterNumber }` |
| `pre-write` | LLM 回應完成、寫入檔案之前 | `{ message, chapterPath, storyDir, series, name, preContent }` |
| `post-response` | LLM 回應完成後 | `{ content, storyDir, series, name, rootDir }` |
| `strip-tags` | 內容標籤清除時 | `{ content }` |

> [!NOTE]
> `strip-tags` 目前未被任何程式碼路徑分派，僅作為未來擴充保留。實際分派的 hook 階段為：`prompt-assembly`（story.ts）、`response-stream`（chat-shared.ts）、`pre-write`（chat-shared.ts）、`post-response`（chat-shared.ts）。

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
| `frontend-render` | 自訂內容渲染（例如將 `<options>` 轉為互動式 UI） | `{ text, placeholderMap, options }` — 其中 `options` 為 `{ isLastChapter: boolean }` |
| `notification` | 通知觸發（LLM 回應完成/錯誤時由核心派發） | `{ event, data, notify }` — `event` 為 `'chat:done'` 或 `'chat:error'`，`notify` 為通知函式 |
| `chat:send:before` | 使用者送出訊息前，允許 plugin 改寫將送出的文字 | `{ message, mode }` — `mode` 為 `'send'` 或 `'resend'`；若 handler `return` 一個字串，該字串將覆蓋 `context.message`（pipeline 行為） |
| `chapter:render:after` | 章節 Markdown 渲染完成後，允許 plugin 後處理 token 陣列 | `{ tokens, rawMarkdown, options }` — 可直接變更 `tokens`（push/replace/mutate `.content`）；任何新增或 `.content` 變動的 `html` token 會被系統再次以 DOMPurify 重新消毒 |
| `story:switch` | 使用者切換系列／故事時觸發 | `{ series, story, mode, previousSeries, previousStory }` — `mode` 為 `'backend'` 或 `'fsa'`，首次載入時 `previousSeries`／`previousStory` 為 `null`；資訊用途，不可取消 |
| `chapter:change` | 目前顯示的章節變動時觸發（包含跳章、翻頁、重新載入至最後一章） | `{ chapter, index, previousIndex }` — `chapter` 為對應 `ChapterData.number`（FSA 模式首次載入時為 `null`），`previousIndex` 為 `null` 代表首次載入；資訊用途，不可取消 |
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
- **Edit-save 不變式。** `useChapterNav` 暴露 `currentContent: ShallowRef<string>` 與 `renderEpoch: Ref<number>`，所有寫入都經由內部的 `commitContent()` 進行；位元組相同的覆寫也會呼叫 `triggerRef(currentContent)` 並遞增 `renderEpoch`，確保下游 computed 與 watch 重新執行。`ChapterContent.vue` 在儲存編輯後呼叫 `refreshAfterEdit(targetChapter)`，停留在使用者剛剛編輯的章節並強制重新渲染。
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

- CSS `<link>` 在前端 JS 模組 `import()` **之前**注入，確保元件渲染時樣式已可用
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

Loader 會逐項驗證 `actionButtons`；無效項目會被個別丟棄並記錄警告，plugin 其餘部分仍正常載入。同一 plugin 中重複的 `id` 保留先出現者並對後者記警告。`GET /api/plugins` 回傳的每個 plugin 描述都會帶 `actionButtons` 陣列；未宣告者保證為 `[]`。

#### `visibleWhen` 列舉值

v1 版本僅提供兩個值，未來可在不破壞相容的前提下擴充：

| 值 | 何時顯示 |
|----|----------|
| `"last-chapter-backend"`（預設） | 後端模式（連線 writer 後端）且目前顯示的章節為故事最後一章時 |
| `"backend-only"` | 後端模式中任何章節（包含非最後一章），但 FSA／檔案閱讀模式下不顯示 |

兩個值在 FSA 模式下都不會渲染——v1 不存在會在 FSA 模式可見的選項。可見性會在路由、模式、章節索引變化時自動重新計算。

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

> **注意**：v1 **不**提供 `appendToLastChapter` helper。需要把 LLM 回應寫入章節時，請於呼叫 `runPluginPrompt` 時帶 `{ append: true, appendTag: "..." }`，由後端統一在伺服器端執行 atomic append、章節重讀、`post-response` 派發等流程。

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
    extraVariables?: Record<string, string | number | boolean>; // 僅允許純量
  }
): Promise<{
  content: string;                // append=true 時為 trim 後的「歸一化回應」；append=false 時為原始 LLM 回應
  usage: TokenUsageRecord | null; // 上游回傳的 token 用量（若有）
  chapterUpdated: boolean;        // append=true 並成功寫入時為 true
  appendedTag: string | null;     // 實際附加的 tag（append=true 時等於 appendTag，否則為 null）
}>
```

行為要點：

- 與一般 `chat:send` 共用 `isLoading` / `streamingContent` / `errorMessage` / `abortCurrentRequest`，因此使用者按下「⏹ 停止」可以中斷正在跑的 plugin action。
- 當 `isLoading.value === true`（一般 send 或另一個 plugin action 正在進行）時，呼叫會以 reject 回應，避免重疊。
- 當 WebSocket 已連線時走 WS 路徑並把進度餵入 `streamingContent`；HTTP fallback 一次性回傳最終 JSON，不提供逐字串流。
- 後端會以同一 Vento engine、同一 dynamic-variable 管線渲染 `promptFile`；`extraVariables` 必須為純量且不得撞到保留變數名（`previousContext`、任何 `lore_*`、`status_data` 等）。`user_input` 在 plugin action 預設為空字串，但範本本身**仍須**至少 emit 一個 `{{ message "user" }}…{{ /message }}` 區塊，否則回 422 `multi-message:no-user-message`。

#### WebSocket 信封流程

WebSocket 通道使用以下 envelope（已加進 `WsClientMessage` / `WsServerMessage` 的 discriminated union）：

| 方向 | 型別 | 說明 |
|------|------|------|
| Client → Server | `plugin-action:run` | 啟動一次 plugin action（含 `pluginName`、`series`、`name`、`promptFile`、`append`、`appendTag`、`extraVariables`） |
| Client → Server | `plugin-action:abort` | 中止目前進行中的 plugin action |
| Server → Client | `plugin-action:delta` | 串流中的增量 chunk |
| Server → Client | `plugin-action:done` | 完成；payload 等同 helper 回傳的 `{ content, usage, chapterUpdated, appendedTag }` |
| Server → Client | `plugin-action:error` | 失敗；payload 為 RFC 9457 Problem Details |
| Server → Client | `plugin-action:aborted` | 已中止；append 與 `post-response` 都不會發生 |

HTTP fallback（`POST /api/plugins/:pluginName/run-prompt`）僅回傳最終 JSON，沒有逐 chunk 進度保證。

### Append 行為與 `post-response` 派發

當 `append: true` 時：

1. 後端串完 LLM 回應後，把累積內容做一次「外層 wrapper 歸一化」——若 trim 後內容剛好被一層 `<{appendTag}>…</{appendTag}>` 包住，就剝掉這唯一的最外層；最多剝一層，避免破壞合法的同名巢狀結構。
2. 以 atomic 方式把 `\n<{appendTag}>\n{歸一化內容}\n</{appendTag}>\n` 接到故事中編號最大的章節檔尾端。
3. 重新讀取整份章節檔，並以 `{ content: <append 後完整章節內容>, chapterPath, chapterNumber, storyDir, series, name, rootDir, source: "plugin-action", pluginName, appendedTag }` 派發 `post-response`。
4. `pre-write` 與 `response-stream` 在 `append-to-existing-chapter` 模式**不會**派發；中止（abort）發生時，append 步驟與 `post-response` 都會被略過。

換句話說，正常聊天回合與 plugin action append 對 `post-response` 看到的 `content` 同樣是「append 後的完整章節內容」，下游 replay／diff 邏輯不需要區分來源。

### 路徑安全

- `promptFile` 必須是相對路徑，副檔名必須為 `.md`，且必須是 regular file。
- 後端先以 `safePath()` 解析，再對 plugin 目錄與解析後的 prompt 路徑同時呼叫 `Deno.realPath()` 取得 canonical path，最後以 `isPathContained()` 確保 prompt 落在 plugin 目錄之內——這同時擋下 `..` 路徑穿越與 symlink 跳脫。
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

## API 端點

系統提供兩個與 plugin 相關的 API 端點：

### GET /api/plugins

回傳所有已載入 plugin 的 metadata 陣列：

```json
[
  {
    "name": "thinking",
    "version": "1.0.0",
    "description": "Think before reply and fold thinking tags",
    "type": "full-stack",
    "tags": ["thinking", "think"],
    "displayStripTags": [],
    "hasFrontendModule": true,
    "frontendStyles": []
  }
]
```

### GET /api/plugins/parameters

回傳所有可用的 Vento 模板參數（包含核心參數與 plugin 參數）：

```json
[
  { "name": "lore_all", "type": "string", "source": "lore", "description": "..." },
  { "name": "think_before_reply", "type": "string", "source": "thinking", "description": "..." }
]
```

此端點供前端的提示詞編輯器使用，讓使用者在編輯模板時查看可用變數。

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
> 請勿以 `PROMPT_FILE` 環境變數指向外部外掛的 `system.md`。`PROMPT_FILE` 用於儲存使用者自訂的提示詞，按下「重置」按鈕時該檔案會被刪除。應以複製方式覆寫專案根目錄的 `system.md`，確保重置後仍可正確回復至外掛版提示詞。

> [!NOTE]
> 當外部 plugin 的名稱與內建 plugin 相同時，外部版本會覆蓋內建版本。系統會在 console 記錄覆蓋資訊。

## 撰寫自訂 Plugin

### 最小範例：prompt-only

建立 `plugins/my-plugin/` 目錄，加入兩個檔案：

**plugin.json**

```json
{
  "name": "my-plugin",
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

  hooks.register('post-response', async (context) => {
    const log = context.logger ?? logger;
    log.info(`回應長度：${context.content.length}`, { contentLength: context.content.length });
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
| imgthink | prompt-only | 圖像思考標籤處理 |
| start-hints | prompt-only | 首輪章節開場引導提示，含提示詞與顯示標籤清除 |
| thinking | full-stack | 回覆前思考指令與折疊 `<thinking>`/`<think>` 標籤為可展開的 details 元素 |
| user-message | full-stack | 使用者訊息標籤前端清除，pre-write hook 注入使用者訊息區塊 |
| response-notify | full-stack | 後端 → 前端 Toast 通知系統，透過 `notification` hook 推送使用者提示 |

[prompt-template]: ./prompt-template.md
[lore-codex]: ./lore-codex.md

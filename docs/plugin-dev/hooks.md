# Hook 系統

> 想直接拿到 hook handler 樣板？用 [`heartreverie-create-plugin`][skill] Agent Skill 一鍵產出常見階段的骨架程式碼。

[skill]: overview.md#agent-skill

## 後端 Hook

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

### `post-response` Payload（deep-frozen）

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

### `TokenUsageRecord`

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

### `pre-llm-fetch`（觀察用，預設 serial；可選 `parallel:true + readOnly:true`）

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

### Per-handler 觀察事件：`ctx.hooks.onHandlerStart` / `onHandlerEnd`

除了註冊 hook handler，plugin 也可以**觀察其他 plugin 的 handler 執行**（用於除錯面板、效能分析、coverage 偵測等）。此 API 預設關閉，只有在至少一個訂閱者存在時，dispatcher 才會建立 snapshot 並 fan-out 事件，否則路徑零成本。

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
- `ctxBeforeRefs` / `ctxAfterRefs` 為 **identity 比較用**，`reassigned: string[]` 包含「handler 將 `ctx.X` 整段取代而非原地修改」的欄位，依字母序排序。
- snapshot 採每欄位獨立 `structuredClone`：若單一 allowlist 欄位無法被 clone（例如指向 function），該欄位會以哨兵物件 `{ __snapshotError: <message> }` 取代，其餘欄位仍會正常拍照，事件仍會照常發送。
- 訂閱者拋出例外不會影響 dispatcher 正確性；連續兩次例外的訂閱者會被自動取消註冊，且每個 stage 每 60 秒最多輸出一筆 `warn` 訊息。
- 訂閱 API 僅作為觀察介面，**不可** 被用於修改 dispatch context（context 應透過 hook handler 修改）。

### `response-stream` 範例

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

### 並行分派模型（Parallel Dispatch Model）

後端 `HookDispatcher` 支援將同一 stage 中符合條件的 handler **並行執行**，以減少 I/O 密集型 handler 的總 wall-clock 時間。並行分派為 **opt-in**，且僅限後端；前端 `FrontendHookDispatcher` 在 v1 完全不受影響。

#### Manifest `hooks[]` 宣告

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

#### Stage 白名單與特殊條件

| Stage | 可並行？ | 備註 |
|-------|:-------:|------|
| `prompt-assembly` | ✅ | `parallel:true` 需搭配 `readOnly:true`（缺少則自動降級為 serial + warn） |
| `post-response` | ✅ | 同上 |
| `response-stream` | ✅（條件式） | `parallel:true` **必須**搭配 `readOnly:true`，否則整條宣告被 **reject**（非降級）。每 chunk 獨立 fan-out、無 back-pressure |
| `pre-llm-fetch` | ✅ | 觀察用；`messages` / `requestMetadata` 深度凍結。`parallel:true` 需搭配 `readOnly:true`（缺少則降級為 serial + warn） |
| `pre-write` | ❌ | 強制序列（fan-in pipeline，單一寫者） |
| `strip-tags` | ❌ | 強制序列（未被 dispatch） |

#### Parallel-safe 判準

handler 可安全宣告 `parallel: true` 的條件：

1. handler **不寫入**任何 `context.*` 欄位（如 `previousContext`、`preContent`、`chunk`）
2. handler **不就地 mutate** context 上的陣列或物件（如 `arr.push()`）
3. handler 的副作用彼此獨立（HTTP 呼叫、寫入各自路徑的檔案等）

> [!WARNING]
> Proxy `set` trap 僅在 `HOOK_DEBUG=1` 環境變數下偵測 **top-level** 屬性寫入。對既存陣列 / 物件的就地 mutate（同一 reference 的 `.push()`、`.splice()` 等）**無法被偵測**。請依據上述判準自行確認。

#### Track B：`readOnly:true` 預設並行

宣告 `readOnly: true` 且 **未**顯式指定 `parallel` 的條目，dispatcher 會自動視為 `parallel: true`。這減少了樣板：plugin 作者既然已承諾不寫 context，不需再額外指定 `parallel`。

- 顯式 `parallel: false` 可 opt out，完全尊重

> [!IMPORTANT]
> **BREAKING 行為變化**：既有的 `readOnly:true` entry 將從 priority-strict 序列執行變為預設並行。若你的 handler 依賴與其他 handler 的執行順序，請加上 `"parallel": false`。

#### Priority 語意變化

並行 handler **一律在所有序列 handler 之後執行**，與 priority 數值無關。Priority 僅作為同一 bucket 內的排序鍵：

- **序列 bucket**：依 priority-asc 依序 `await`（與過去完全一致）
- **並行 bucket**：序列 bucket 全部完成後，一次 `Promise.allSettled` 啟動

Manifest validator 在 `parallel:true && priority < 100` 時會 `log.warn` 提醒作者：該 handler 不會搶先任何 serial handler。

#### Concurrency 異質宣告 register-time 警告

同一個 parallel bucket 內 `concurrency` 值不一致時，dispatcher 在 **註冊時** 會 `log.warn`，提示作者：因為 `Math.min` 收斂規則，**一個較低（或單一 finite）concurrency 會 throttle 整個 parallel bucket**，亦即更寬鬆的 peer 也會被同樣限速。

觸發條件（任一即可）：

- 新註冊條目宣告 finite `concurrency`，且 bucket 內已有 peer 宣告 **unbounded**（未設）
- 新註冊條目宣告 finite `concurrency`，且 bucket 內存在 peer 宣告 **更高** finite 值（或反向：peer 較低，新 entry 較高）

警告為 **advisory-only**，不阻擋註冊。每個 `${stage}::${plugin ?? "<anonymous>"}::${concurrency ?? "none"}` 組合僅發出一次（process 內 dedup）；payload 包含 `plugin`、`stage`、`concurrency`、`throttlers`、`unboundedPeers`、`message`（內含 `"throttle the entire '<stage>' parallel bucket"` 字面字串）。

#### `register()` options-object 多載

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

#### 前端排除

v1 並行分派僅限後端。`FrontendHookDispatcher` 完全不動，所有前端 hook 階段（`frontend-render`、`notification`、`chat:send:before` 等）的行為與過去 100% 一致。

### Plugin Logger

每個 plugin 在 `register()` 時會收到一個已綁定 plugin 名稱的 Logger 實例（透過 `baseData: { plugin: name }`）。所有使用此 logger 記錄的訊息都會自動附帶 plugin 名稱，方便在日誌中快速辨識來源。

Plugin 收到的 `hooks` 物件是經過包裝的版本。呼叫 `hooks.register(stage, handler, priority?)` 時，系統會自動綁定 plugin 名稱和 baseLogger，因此 plugin 無需手動傳遞這些參數。

在 hook 處理函式被分派時，若 hook context 中帶有 `correlationId`（例如 chat 流程），系統會自動注入 `context.logger`，這是從 plugin 的 baseLogger 衍生的 Logger 實例，同時保留 plugin 名稱和請求 correlationId。建議優先使用 `context.logger`，回退到註冊時取得的 logger：

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

## 前端 Hook

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
| `action-button:click` | 使用者點選 `PluginActionBar` 中由 plugin 貢獻的按鈕時觸發；async dispatch 並依 `originPluginName` 過濾 | `{ buttonId, pluginName, series, name, storyDir, lastChapterIndex, runPluginPrompt, notify, reload }`，詳見「[動作按鈕（Action Buttons）](action-buttons.md)」 |

前端的標籤清除已改為宣告式設定，透過 `displayStripTags` manifest 欄位處理，不再需要前端模組。

`chat:send:before` 採 **pipeline** 模式：handler 回傳 `string` 時會被寫回 `context.message`，下一個 handler 看到的是改寫後的字串；回傳 `undefined` / `null` / 非字串值則不變更 `message`，plugin 仍可直接變更 `context.message` 屬性。此階段不做取消（no veto），若要過濾，handler 應回傳空字串。

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

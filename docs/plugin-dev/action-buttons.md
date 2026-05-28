# 動作按鈕（Action Buttons）

動作按鈕讓 plugin 在閱讀器主版面上貢獻一顆互動按鈕；點選後可由 plugin 自家的提示詞檔案發起一次 LLM 回合，並（可選）將回應以指定 XML 標籤包裹後接到目前章節檔尾端。對應的失敗復原情境例如「重算 `<UpdateVariable>` JSON patch」、「重新生成 `<options>` 選項面板」均以此機制統一實作，無需各自在核心改動。

按鈕位於 `MainLayout.vue` 中 `UsagePanel` 與 `ChatInput` 之間的 `PluginActionBar`，沒有任何 plugin 貢獻可見按鈕時整條 bar 不渲染任何 DOM。

下圖為實際章節頁底部的 `PluginActionBar`，可看到由 `polish`、`state`、`options`、`sd-webui-image-gen` 等內建／外部 plugin 貢獻的按鈕並列於故事指令輸入框上方。

<!-- screenshot-recipe
schema: v1
url: http://localhost:8080/悠奈悠花姊妹大冒險/放學後/
viewport: 1440x900
theme: default
preconditions:
  - 容器已啟動於 localhost:8080
  - 已通過 PASSPHRASE 登入
  - 章節 1 已建立
steps:
  - wait_for: 'main'
  - scroll_to: 'textarea[placeholder*="故事指令"]'
capture: viewport
output: docs/assets/screenshots/plugin-action-buttons.png
captured_at: 2026-05-28
app_commit: 4534325
notes: 與 author/writer-ui.md 的 writer-action-buttons.png 共用同一張擷取，皆呈現章節底部 PluginActionBar
-->
![章節底部的 PluginActionBar 列出多顆 plugin 動作按鈕](../assets/screenshots/plugin-action-buttons.png)


## Manifest 欄位：`actionButtons`

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

Loader 會逐項驗證 `actionButtons`；無效項目會被個別丟棄並記錄警告，plugin 其餘部分仍正常載入。同一 plugin 中重複的 `id` 保留先出現者並對後者記警告。`GET /api/plugins` 回傳的每個 plugin 描述都會帶 `actionButtons` 陣列；未宣告者保證為 `[]`。`GET /api/plugins/action-buttons` 會額外套用設定過濾：當 owning plugin 的 resolved `enabled === false` 時，該 plugin 的按鈕不出現在回應中；前端點選路徑也會再次檢查設定並 no-op，避免 stale cache race。

### `visibleWhen` 列舉值

v1 版本僅提供兩個值，未來可在不破壞相容的前提下擴充：

| 值 | 何時顯示 |
|----|----------|
| `"last-chapter-backend"`（預設） | 目前顯示的章節為故事最後一章時 |
| `"backend-only"` | 任何章節（包含非最後一章） |

兩個值皆會渲染，保留雙值列舉以維持與未來顯示模式擴充的相容性。可見性會在路由、章節索引變化時自動重新計算。

範例：

```json
// 只在後端模式的最後一章顯示（適合「處理最新章節」類動作）
{ "id": "recompute-state", "label": "🧮 重算狀態", "visibleWhen": "last-chapter-backend" }

// 後端模式的任何章節都顯示（適合不依賴章節位置的動作）
{ "id": "open-tools", "label": "🛠 工具", "visibleWhen": "backend-only" }
```

## 前端 hook：`action-button:click`

使用者點選按鈕時，前端 `FrontendHookDispatcher` 會以 `async` 方式分派 `action-button:click` 階段。Dispatcher 只會呼叫**擁有該按鈕之 plugin** 所註冊的 handler（依 `originPluginName === context.pluginName` 過濾），並依 `priority` 順序逐一 `await`。在 dispatch promise 結算（resolve 或 reject）前，按鈕會以 `pendingKey = ${pluginName}:${buttonId}` 記錄在 pending 集合中並維持 disabled 狀態，避免重複點選。

Context 物件：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `buttonId` | `string` | 被點選按鈕的 `id` |
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

## `runPluginPrompt(promptFile, opts?)` Helper

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

### WebSocket 信封流程

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

## Append 行為與 `post-response` 派發

當 `append: true` 時：

1. 後端串完 LLM 回應後，把累積內容做一次「外層 wrapper 歸一化」，若 trim 後內容剛好被一層 `<{appendTag}>…</{appendTag}>` 包住，就剝掉這唯一的最外層；最多剝一層，避免破壞合法的同名巢狀結構。
2. 以 atomic 方式把 `\n<{appendTag}>\n{歸一化內容}\n</{appendTag}>\n` 接到故事中編號最大的章節檔尾端。
3. 重新讀取整份章節檔，並以 deep-frozen `PostResponsePayload`：`{ correlationId, content: <append 後完整章節內容>, chapterPath, chapterNumber, storyDir, series, name, rootDir, source: "plugin-action", pluginName, appendedTag, endpoint, usage }` 派發 `post-response`。
4. `pre-write` 與 `response-stream` 在 `append-to-existing-chapter` 模式**不會**派發；中止（abort）發生時，append 步驟與 `post-response` 都會被略過。

換句話說，正常聊天回合與 plugin action append 對 `post-response` 看到的 `content` 同樣是「append 後的完整章節內容」，下游 replay／diff 邏輯不需要區分來源。

## Replace 行為（`replace-last-chapter` WriteMode）

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

## `draft` 保留變數

在 replace 模式下，後端會自動將當前最高編號章節的完整內容（經過所有 plugin 的 `promptStripTags` 清理後）注入為 Vento 模板變數 `draft`。Plugin 的提示詞範本可透過 `{{ draft }}` 引用原始章節內容，供 LLM 在改寫時參考。

規則：

- `"draft"` 為系統保留的變數名稱，呼叫端**不得**透過 `extraVariables` 覆寫此值，若嘗試覆寫，後端回 HTTP 400。
- 僅在 `replace: true` 時注入；`append` 模式或無寫入模式下不會產生 `draft` 變數。
- 注入的內容已套用 `promptStripTags`，與 `previous_context` 的清理管線一致。

## 路徑安全

- `promptFile` 必須是相對路徑，副檔名必須為 `.md`，且必須是 regular file。
- 後端先以 `safePath()` 解析，再對 plugin 目錄與解析後的 prompt 路徑同時呼叫 `Deno.realPath()` 取得 canonical path，最後以 `isPathContained()` 驗證 prompt 落在 plugin 目錄之內——這同時擋下 `..` 路徑穿越與 symlink 跳脫。
- 違反任一條件即回 400/404 對應的 `plugin-action:invalid-prompt-path` / `plugin-action:non-md-prompt` / `plugin-action:prompt-file-not-found`。

## Rate Limit

`POST /api/plugins/:pluginName/run-prompt` 與 WebSocket 上的 `plugin-action:run` 共用一個 **每分鐘 30 次（每 client）** 的路由級 rate limiter，與 `chat` 路由相同；超過上限回 HTTP 429。全域 300/min 限制仍適用。

## 並行限制

整個故事一次只能有一個 LLM generation 進行中。Plugin action 在啟動 LLM 呼叫前會以 `tryMarkGenerationActive(series, name)` 取得 per-story generation lock；若已被其他流程（一般聊天或另一次 plugin action）持有，會回 HTTP 409 `plugin-action:concurrent-generation`。Lock 會在 `finally` 區塊釋放，無論成功、失敗或中止。

## 完整範例：state 重算狀態按鈕

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

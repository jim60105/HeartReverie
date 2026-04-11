# Plugin 系統

本專案採用以 manifest 驅動的 plugin 架構，將提示詞片段、標籤處理、前端渲染、後處理等功能拆分為獨立的 plugin。每個 plugin 透過 `plugin.json` 宣告自身的能力，由 `PluginManager` 在啟動時自動掃描、載入、初始化。

## 架構概覽

```
writer/
├── server.js                  ← 主伺服器，初始化 plugin 與 hook
└── lib/
    ├── plugin-manager.js      ← PluginManager 類別：探索、載入、管理 plugin
    └── hooks.js               ← HookDispatcher 類別：後端 hook 註冊與分派

plugins/                       ← 內建 plugin 目錄
├── state-patches/
│   ├── plugin.json
│   ├── handler.js
│   ├── frontend.js
│   └── rust/
├── de-robotization/
│   ├── plugin.json
│   └── de-robotization.md
├── t-task/
│   ├── plugin.json
│   ├── frontend.js
│   └── prompt-fragments/
│       ├── T-task.md
│       └── T-task_think_format.md
└── ...（共 10 個 plugin）
```

Plugin 與伺服器的互動分為五個層面，分別對應 manifest 中的不同欄位：

- **提示詞注入**：透過 `promptFragments` 將 Markdown 片段載入為 Vento 模板變數
- **提示詞標籤清除**：透過 `promptStripTags` 宣告需要從 previousContext（已儲存章節內容）中移除的 XML 標籤或正規表達式，在組建提示詞時生效
- **顯示標籤清除**：透過 `displayStripTags` 宣告需要從前端顯示中移除的 XML 標籤或正規表達式，在瀏覽器渲染時生效
- **後端 hook**：透過 `backendModule` 註冊伺服器端生命週期事件的處理函式
- **前端模組**：透過 `frontendModule` 提供瀏覽器端的自訂標籤渲染邏輯

## Plugin Manifest 規格

每個 plugin 目錄下必須包含一個 `plugin.json`，其 `name` 欄位必須與目錄名稱一致。以下是完整的欄位定義：

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `name` | `string` | ✅ | Plugin 的唯一識別名稱，必須與目錄名稱相同 |
| `version` | `string` | ✅ | 語意化版本號（例如 `"1.0.0"`） |
| `description` | `string` | ✅ | 簡短描述 |
| `type` | `string` | ✅ | Plugin 類型，見下方說明 |
| `promptFragments` | `array` | ❌ | 提示詞片段宣告，見「提示詞片段」章節 |
| `backendModule` | `string` | ❌ | 後端模組路徑（相對於 plugin 目錄） |
| `frontendModule` | `string` | ❌ | 前端模組路徑（相對於 plugin 目錄） |
| `tags` | `array` | ❌ | 此 plugin 管理的 XML 標籤名稱列表 |
| `promptStripTags` | `array` | ❌ | 組建提示詞時從 previousContext 中移除的標籤或正規表達式 |
| `displayStripTags` | `array` | ❌ | 前端顯示時移除的標籤或正規表達式 |
| `parameters` | `array` | ❌ | 自訂 Vento 模板參數宣告 |

### Plugin 類型

`type` 欄位決定 plugin 的功能範圍：

| 類型 | 說明 | 範例 |
|------|------|------|
| `prompt-only` | 僅提供提示詞片段，不包含後端或前端邏輯 | de-robotization、writestyle |
| `hook-only` | 僅透過後端 hook 參與生命週期，不提供提示詞 | — |
| `full-stack` | 同時包含提示詞片段、後端模組、前端模組 | options、status |
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
- `name`、`version`、`description`、`type` 為必填欄位
- `name` 必須與所在目錄名稱完全一致（防止 plugin 冒名）
- Plugin 名稱不得包含 `..`、`\0`、`/`、`\` 等路徑穿越字元

驗證失敗時，系統記錄警告並跳過該 plugin，不影響其餘 plugin 的載入。

### 後端模組初始化

具有 `backendModule` 的 plugin 會在探索完成後進行模組初始化。系統以 `import()` 動態載入模組（在 Deno 中使用 `file://` URL），並呼叫其匯出的 `register(hookDispatcher)` 函式，讓 plugin 向 HookDispatcher 註冊 hook 處理函式。

模組路徑必須通過路徑包含檢查——解析後的絕對路徑必須位於 plugin 目錄內部，否則跳過載入。

## 提示詞片段

提示詞片段是 plugin 向系統提示詞注入內容的主要機制。Plugin 在 manifest 的 `promptFragments` 陣列中宣告片段檔案，系統在渲染提示詞時將檔案內容載入為 Vento 模板變數。

### 片段宣告格式

```json
{
  "promptFragments": [
    { "file": "./de-robotization.md", "variable": "de_robotization", "priority": 100 }
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

### 路徑安全

片段檔案路徑經過 `path.resolve()` 後，必須仍在 plugin 目錄內部。嘗試透過 `../` 讀取 plugin 目錄外部的檔案會被攔截並跳過。

### 目前的 plugin 變數

以下是所有內建 plugin 提供的模板變數：

| 變數名稱 | 來源 plugin | Priority | 說明 |
|----------|-------------|----------|------|
| `threshold_lord_start` | threshold-lord | 10 | 故事節奏控制（開場指令） |
| `de_robotization` | de-robotization | 100 | 去機械化寫作指令 |
| `t_task` | t-task | 100 | 親密場景質感任務指令 |
| `t_task_think_format` | t-task | 100 | 質感任務思考格式 |
| `writestyle` | writestyle | 100 | 寫作風格指令 |
| `options` | options | 100 | 選項格式說明 |
| `status` | status | 100 | 狀態格式說明 |
| `writestyle_reinforce` | writestyle | 800 | 寫作風格強化（高 priority，排在提示詞後段） |
| `threshold_lord_end` | threshold-lord | 900 | 故事節奏控制（結尾指令） |

這些變數之外，系統還提供五個核心變數：`scenario`、`previous_context`、`user_input`、`status_data`、`isFirstRound`。詳細說明參見 [Prompt 模板系統][prompt-template]。

## 標籤清除

LLM 回應中經常包含 plugin 定義的 XML 標籤（例如 `<options>`、`<T-task>`），這些標籤會隨回應一同寫入章節檔案。系統提供兩種標籤清除機制：

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

當標籤可能帶有屬性（例如 `<T-task type="think">`），純文字模式無法匹配。此時可使用正規表達式語法，以 `/` 開頭標示：

```json
{
  "promptStripTags": ["/<T-task\\b[^>]*>[\\s\\S]*?<\\/T-task>/g"],
  "displayStripTags": ["/<T-task\\b[^>]*>[\\s\\S]*?<\\/T-task>/g"]
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
| `prompt-assembly` | 系統提示詞渲染期間 | `{ prompt, variables }` |
| `response-stream` | 接收 LLM 串流回應時 | `{ chunk, content }` |
| `pre-write` | LLM 回應完成、寫入檔案之前 | `{ message, chapterPath, storyDir, series, name, preContent }` |
| `post-response` | LLM 回應完成後 | `{ content, storyDir, series, name, rootDir }` |
| `strip-tags` | 內容標籤清除時 | `{ content }` |

註冊方式為在後端模組中匯出 `register` 函式：

```javascript
export function register(hookDispatcher) {
  hookDispatcher.register('post-response', async (context) => {
    // 在 LLM 回應完成後執行自訂邏輯
    const { content, storyDir, rootDir } = context;
    // ...
  }, 100); // priority：數字越小越先執行
}
```

同一階段可有多個處理函式，依 priority 排序後依序執行。單一處理函式拋出的例外會被記錄，但不會阻斷後續處理函式的執行。

### 前端 Hook

前端 plugin 以 ES module 形式由瀏覽器載入，透過獨立的 FrontendHookDispatcher 註冊同步處理函式。前端 hook 目前僅支援一個階段：

| 階段 | 用途 | Context 參數 |
|------|------|-------------|
| `frontend-render` | 自訂內容渲染（例如將 `<options>` 轉為互動式 UI） | `{ text, element }` |

前端的標籤清除已改為宣告式設定，透過 `displayStripTags` manifest 欄位處理，不再需要前端模組。

前端模組的結構：

```javascript
export function register(hooks) {
  hooks.register('frontend-render', (context) => {
    // 自訂渲染邏輯
  }, 100);
}
```

前端模組透過 `/plugins/:name/:file` 路由由伺服器提供靜態檔案服務，僅允許存取 manifest 中宣告的 `frontendModule` 檔案。

## API 端點

系統提供兩個與 plugin 相關的 API 端點：

### GET /api/plugins

回傳所有已載入 plugin 的 metadata 陣列：

```json
[
  {
    "name": "state-patches",
    "version": "1.0.0",
    "description": "Apply state patches and render variable updates",
    "type": "full-stack",
    "tags": ["UpdateVariable"],
    "displayStripTags": [],
    "hasFrontendModule": true
  }
]
```

### GET /api/plugins/parameters

回傳所有可用的 Vento 模板參數（包含核心參數與 plugin 參數）：

```json
[
  { "name": "scenario", "type": "string", "source": "core", "description": "..." },
  { "name": "t_task", "type": "string", "source": "t-task", "description": "..." }
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
- `include` 指令
- 註解（`{{# comment #}}`）

函式呼叫、屬性存取（`.`）、`process.env` 等運算式一律被拒絕，模板大小限制為 500KB。

### 前端模組靜態服務

`/plugins/:name/:file` 路由僅提供 manifest 中宣告的 `frontendModule` 檔案，不允許存取 plugin 目錄下的任意檔案。

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
export function register(hookDispatcher) {
  hookDispatcher.register('post-response', async (context) => {
    console.log(`回應長度：${context.content.length}`);
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
| de-robotization | prompt-only | 去機械化寫作指令 |
| imgthink | prompt-only | 圖像思考標籤處理 |
| options | full-stack | 選項面板的提示詞說明、標籤清除、前端渲染 |
| state-patches | full-stack | LLM 回應完成後執行 Rust 二進位檔處理狀態 patch，前端渲染變數更新區塊 |
| status | full-stack | 狀態面板的提示詞說明、標籤清除、前端渲染 |
| t-task | prompt-only | 親密場景質感任務指令，支援正規表達式標籤清除 |
| threshold-lord | full-stack | 故事節奏控制（開場 priority 10、結尾 priority 900），免責聲明標籤前端清除 |
| user-message | full-stack | 使用者訊息標籤前端清除，pre-write hook 注入使用者訊息區塊 |
| writestyle | prompt-only | 寫作風格指令與強化（priority 100 + 800） |

[prompt-template]: ./prompt-template.md

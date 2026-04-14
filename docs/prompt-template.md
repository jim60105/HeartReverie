# Prompt 模板系統

本專案使用 [Vento](https://vento.js.org/) 模板引擎來組合 LLM 的系統提示詞（system prompt）。Vento 是輕量級的 JavaScript 模板引擎，語法簡潔直觀，適合用於渲染 Markdown 格式的提示詞模板。

## 模板架構概覽

主模板位於專案根目錄的 `system.md`，由使用者自行撰寫。模板系統負責將核心變數與外掛提供的變數一併傳入 Vento 引擎進行渲染。外掛如何提供變數，參見[外掛系統文件][plugin-system]。

## 模板變數

伺服器在渲染模板時傳入以下核心變數：

| 變數名稱 | 型別 | 說明 |
|---|---|---|
| `previous_context` | `string[]` | 已存在的章節內容陣列，按章節編號順序排列。內容經 `stripPromptTags()` 移除外掛定義的 XML 標籤後傳入 |
| `user_input` | `string` | 使用者在聊天請求中發送的原始訊息 |
| `status_data` | `string` | 執行階段的狀態資料，來自 `current-status.yml` 或 `init-status.yml` 的 YAML 內容 |
| `isFirstRound` | `boolean` | 當所有章節內容皆為空時為 `true`，表示這是故事的第一回合 |
| `series_name` | `string` | 目前所選系列的名稱（與系列目錄名稱相同） |
| `story_name` | `string` | 目前所選故事的名稱（與故事目錄名稱相同） |
| `plugin_fragments` | `string[]` | 外掛透過 `promptFragments` 提供的內容片段陣列 |
| `lore_all` | `string` | 所有啟用的典籍篇章，依 priority 降冪排列後串接（由典籍系統提供） |
| `lore_<tag>` | `string` | 具有該有效標籤的啟用篇章（如 `lore_scenario`、`lore_characters`，由典籍系統提供） |
| `lore_tags` | `string[]` | 所有已發現的標籤名稱陣列（由典籍系統提供） |

除上述核心變數外，外掛亦可透過 `promptFragments` 提供額外的具名變數，一併傳入模板。

> **備註：** 變數名稱使用 `status_data` 而非 `status`，是因為模板內部以 `{{ set status }}{{ include "./status.md" }}{{ /set }}` 將 `status.md` 子模板的內容存入名為 `status` 的區域變數（該子模板提供的是狀態格式說明）。使用 `status_data` 可避免命名衝突。

## Vento 語法

### 變數插值

使用雙大括號 `{{ }}` 輸出變數值：

```vento
{{ lore_scenario }}
{{ user_input }}
{{ status_data }}
```

### 陣列迭代

使用 `{{ for ... of ... }}` 遍歷陣列：

```vento
{{ for chapter of previous_context }}
<previous_context>{{ chapter }}</previous_context>
{{ /for }}
```

此語法會對 `previous_context` 陣列中的每個章節內容進行迭代，將每個章節包裹在 `<previous_context>` 標籤中輸出。

外掛提供的內容片段也透過同樣的語法注入：

```vento
{{ for fragment of plugin_fragments }}
{{ fragment }}
{{ /for }}
```

### 條件渲染

使用 `{{ if ... }}` 進行條件判斷：

```vento
{{ if isFirstRound }}
<start_hints>第一回合的起始提示...</start_hints>
{{ /if }}
```

當 `isFirstRound` 為 `true` 時，渲染 `<start_hints>` 區塊；否則跳過。

### 設定區域變數與載入子模板

使用 `set` 搭配 `include` 將子模板內容存入區域變數，並透過 `|> trim` 管道過濾器去除前後空白。`-` 符號用於消除標籤本身產生的多餘空行：

```vento
{{- set writestyle |> trim -}}{{- include "./writestyle.md" -}}{{- /set -}}
```

之後可在模板中透過 `{{ writestyle }}` 引用該變數的內容。

## 提示詞建構流程

以下描述從使用者發送請求到 LLM 收到提示詞的完整流程：

### 1. 接收請求

客戶端發送 `POST /api/stories/:series/:name/chat`，請求主體包含 `{ message: "..." }`。

### 2. 準備資料

聊天端點處理器依序執行以下步驟：

1. **讀取章節檔案** — 從 `playground/:series/:name/` 目錄讀取所有現有章節檔案（最多取最近 200 個章節）
2. **偵測第一回合** — 檢查是否所有章節內容皆為空
3. **清理章節內容** — 對每個章節呼叫 `stripPromptTags()` 移除外掛定義的 XML 標籤，建構 `previousContext` 陣列
4. **載入狀態資料** — 讀取 `current-status.yml`（若不存在則回退至 `init-status.yml`）

### 3. 渲染模板

呼叫 `renderSystemPrompt()`，此函式：

1. 讀取主模板 `system.md`（或使用者提供的覆寫模板）
2. 解析典籍系統（Lore Codex）變數：呼叫 `resolveLoreVariables()` 掃描適用的 global / series / story 篇章，取得原始篇章與第一輪變數快照
3. 逐篇渲染典籍內容：將每篇篇章本體透過 Vento 引擎渲染，傳入不可變的第一輪變數快照（包含所有 `lore_*` 變數、`series_name`、`story_name`）。若渲染失敗則回退為原始內容
4. 重新產生典籍變數：以渲染後的篇章重新計算 `lore_all`、`lore_<tag>`、`lore_tags`
5. 收集外掛提供的變數與內容片段
6. 使用 Vento 引擎渲染主模板，傳入所有變數：

```typescript
const result = await ventoEnv.runString(systemTemplate, {
  previous_context: previousContext || [],
  user_input: userInput || "",
  status_data: status || "",
  isFirstRound: isFirstRound || false,
  series_name: series || "",
  story_name: story || "",
  ...loreVars,
  ...pluginVars.variables,
  plugin_fragments: pluginVars.fragments || [],
});
```

> 使用者提供的覆寫模板會經過 `validateTemplate()` 白名單驗證，阻擋函式呼叫、屬性存取等不安全的表達式，防止 SSTI 攻擊。

### 4. 建構訊息陣列

伺服器將渲染後的模板內容組成兩則訊息陣列，發送至 LLM：

```typescript
const messages = [
  { role: "system", content: systemPrompt },
  { role: "user", content: message },
];
```

- `system` 訊息包含由模板渲染出的完整系統提示詞
- `user` 訊息包含使用者的原始輸入

### 5. 發送至 LLM

訊息陣列透過串流方式發送至 OpenRouter API，LLM 回應逐步寫入章節檔案。

## 典籍篇章的 Vento 渲染

典籍篇章的本體（Markdown 部分）支援使用 Vento 語法。這使得篇章可以引用其他篇章的內容或利用上下文變數（如 `series_name`、`story_name`）來動態產生內容。

### 可用變數

在典籍篇章內可使用以下變數：

- 所有 `lore_*` 變數（第一輪快照，即渲染前的原始內容）
- `series_name` — 目前系列名稱
- `story_name` — 目前故事名稱

### 範例

```vento
角色所在的世界：{{ lore_setting }}
本系列：{{ series_name }}
```

### 循環參照

若篇章 A 引用 `lore_b`（篇章 B 的標籤），而篇章 B 也引用 `lore_a`，雙方都會看到對方的**原始**（未渲染）內容。這是因為渲染使用不可變的第一輪快照，確保結果具有確定性。

### 錯誤處理

若某篇篇章的 Vento 語法有誤，該篇章會回退為原始內容，不會影響其他篇章或整體模板的渲染。

[plugin-system]: ./plugin-system.md

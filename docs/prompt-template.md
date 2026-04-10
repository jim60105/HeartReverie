# Prompt 模板系統

本專案使用 [Vento](https://vento.js.org/) 模板引擎來組合 LLM 的系統提示詞（system prompt）。Vento 是一個輕量級的 JavaScript 模板引擎，語法簡潔直觀，適合用於渲染 Markdown 格式的提示詞模板。

## 模板架構概覽

主模板位於 `playground/prompts/system.md`，透過 Vento 的 `include` 指令載入多個子模板，組成完整的系統提示詞：

```
playground/prompts/
├── system.md                  ← 主模板（入口）
├── Threshold-Lord_start.md    ← 子模板：開頭指令
├── de-robotization.md         ← 子模板：去機械化指令
├── world_aesthetic_program.md ← 子模板：世界觀美學
├── T-task.md                  ← 子模板：任務指令
├── writestyle.md              ← 子模板：寫作風格
├── Threshold-Lord_end.md      ← 子模板：結尾指令
├── status.md                  ← 子模板：狀態格式說明
└── options.md                 ← 子模板：選項格式說明
```

## 模板變數

伺服器在渲染模板時傳入以下變數：

| 變數名稱 | 型別 | 說明 |
|---|---|---|
| `scenario` | `string` | 系列情境描述，內容來自 `playground/:series/scenario.md` |
| `previous_context` | `string[]` | 已存在的章節內容陣列，按章節編號順序排列。內容已透過 `stripPromptTags()` 移除 `<options>`、`<disclaimer>`、`<user_message>` 標籤 |
| `user_input` | `string` | 使用者在聊天請求中發送的原始訊息 |
| `status_data` | `string` | 執行階段的狀態資料，來自 `current-status.yml` 或 `init-status.yml` 的 YAML 內容 |
| `isFirstRound` | `boolean` | 當所有章節內容皆為空時為 `true`，表示這是故事的第一回合 |

> **備註：** 變數名稱使用 `status_data` 而非 `status`，是因為模板內部以 `{{ set status }}{{ include "./status.md" }}{{ /set }}` 將 `status.md` 子模板的內容存入名為 `status` 的區域變數（該子模板提供的是狀態格式說明）。使用 `status_data` 可避免命名衝突。

## Vento 語法

### 變數插值

使用雙大括號 `{{ }}` 輸出變數值：

```vento
{{ scenario }}
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

`server.js` 中的聊天端點處理器依序執行以下步驟：

1. **讀取章節檔案** — 從 `playground/:series/:name/` 目錄讀取所有現有章節檔案（最多取最近 200 個章節）
2. **偵測第一回合** — 檢查是否所有章節內容皆為空：`chapters.every((ch) => ch.content.trim() === "")`
3. **清理章節內容** — 對每個章節呼叫 `stripPromptTags()` 移除 `<options>`、`<disclaimer>`、`<user_message>` 標籤，建構 `previousContext` 陣列
4. **載入狀態資料** — 讀取 `current-status.yml`（若不存在則回退至 `init-status.yml`）
5. **載入情境描述** — 讀取 `playground/:series/scenario.md`

### 3. 渲染模板

呼叫 `renderSystemPrompt(series, { previousContext, userInput, status, isFirstRound })`，此函式：

1. 讀取主模板 `playground/prompts/system.md`
2. 讀取系列情境檔案 `playground/:series/scenario.md`
3. 使用 Vento 引擎渲染模板，傳入所有變數：

```javascript
const result = await ventoEnv.runString(systemTemplate, {
  scenario: scenarioContent,
  previous_context: previousContext || [],
  user_input: userInput || "",
  status_data: status || "",
  isFirstRound: isFirstRound || false,
});
```

### 4. 模板渲染結構

`system.md` 模板按以下順序渲染完整的系統提示詞：

1. **載入子模板** — 透過 `set`/`include` 載入 `Threshold-Lord_start`、`de-robotization`、`world_aesthetic_program`、`T-task`、`writestyle` 等子模板
2. **系統指令** — 渲染寫作規則、格式要求、語言設定等基礎指令
3. **情境描述** — 渲染 `{{ scenario }}` 變數
4. **世界觀設定** — 渲染已載入的子模板變數
5. **寫作指南** — 渲染思考流程與寫作規範
6. **歷史章節** — 透過 `{{ for chapter of previous_context }}` 迭代渲染每個章節
7. **起始提示**（條件性）— 當 `{{ if isFirstRound }}` 為真時渲染 `<start_hints>` 區塊
8. **使用者輸入** — 渲染 `<inputs>{{ user_input }}</inputs>`
9. **狀態資料** — 渲染 `<status_current_variable>{{ status_data }}</status_current_variable>`
10. **後段子模板** — 載入並渲染 `Threshold-Lord_end`、`status`（格式說明）、`options` 等子模板

### 5. 建構訊息陣列

伺服器將渲染後的模板內容組成簡潔的兩則訊息陣列，發送至 LLM：

```javascript
const messages = [
  { role: "system", content: systemPrompt },
  { role: "user", content: message },
];
```

- `system` 訊息包含由模板渲染出的完整系統提示詞（含所有指令、歷史章節、使用者輸入、狀態資料）
- `user` 訊息包含使用者的原始輸入

### 6. 發送至 LLM

訊息陣列透過串流方式發送至 OpenRouter API，回應即時串流回客戶端。

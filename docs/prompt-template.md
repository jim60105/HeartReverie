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
| `isFirstRound` | `boolean` | 當所有章節內容皆為空時為 `true`，表示這是故事的第一回合 |
| `series_name` | `string` | 目前所選系列的名稱（與系列目錄名稱相同） |
| `story_name` | `string` | 目前所選故事的名稱（與故事目錄名稱相同） |
| `plugin_fragments` | `string[]` | 外掛透過 `promptFragments` 提供的內容片段陣列 |
| `lore_all` | `string` | 所有啟用的典籍篇章，依 priority 降冪排列後串接（由典籍系統提供） |
| `lore_<tag>` | `string` | 具有該有效標籤的啟用篇章（如 `lore_scenario`、`lore_characters`，由典籍系統提供） |
| `lore_tags` | `string[]` | 所有已發現的標籤名稱陣列（由典籍系統提供） |

除上述核心變數外，外掛亦可透過 `promptFragments` 提供額外的具名變數。外掛後端模組也可匯出 `getDynamicVariables()` 提供動態變數，一併傳入模板。

## Vento 語法

### 變數插值

使用雙大括號 `{{ }}` 輸出變數值：

```vento
{{ lore_scenario }}
{{ user_input }}
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

### `{{ message }}` 多訊息標籤

`{{ message }}` 是本專案註冊到 Vento 的自訂區塊標籤，用於在模板中宣告一則送往 LLM 的對話訊息。**渲染後的模板就是上游 `messages` 陣列的唯一來源**——伺服器不會在模板之外自動補上任何 `system` 或 `user` 訊息，模板必須自行透過 `{{ message }}` 區塊產生內容。

#### 語法

```vento
{{ message "system" }}你是一位敘事家。{{ /message }}
{{ message "user" }}{{ user_input }}{{ /message }}
{{ message "assistant" }}遵命。{{ /message }}
```

允許的角色（role）僅限以下三種：

- `"system"` — 系統指示
- `"user"` — 使用者輸入
- `"assistant"` — 助手回覆（常用於 few-shot 示例或「假裝模型已回覆」的引導）

也支援以**裸識別字**（bare identifier）動態指定角色，識別字的執行期值必須是上述三者之一：

```vento
{{ for ex of examples }}
{{ message "user" }}{{ ex.q }}{{ /message }}
{{ message "assistant" }}{{ ex.a }}{{ /message }}
{{ /for }}
```

> [!NOTE]
> 角色運算式只接受字串字面量或單一識別字，**不接受**管道（`|>`）、屬性存取（`obj.role`）或函式呼叫（`fn()`）。這是 SSTI 白名單刻意留下的限制。

#### 區塊內容支援的語法

`{{ message }}` 區塊內可使用所有一般 Vento 語法：變數插值、`{{ if }}`、`{{ for }}`、管道過濾器、外掛片段插值、典籍變數等。

```vento
{{ message "system" }}
角色：{{ persona_name }}
{{ if isFirstRound }}
這是故事的第一回合，請以開場白引入場景。
{{ /if }}
{{ /message }}
```

#### 訊息順序與合併規則

整份模板渲染後的訊息順序，**完全依照原始碼的字面順序**組裝：

1. 任何位於所有 `{{ message }}` 區塊**之外**的頂層文字會被視為 `system` 角色內容，依字面順序插入訊息陣列中。
2. **相鄰的 `system` 訊息會被合併**為單一訊息，內容以單一換行 `\n` 串接。這包括頂層文字之間、頂層文字與作者明確寫的 `{{ message "system" }}` 區塊之間，以及兩個明確寫的 `{{ message "system" }}` 區塊之間。
3. **相同角色的非系統訊息（`user`/`assistant`）不會合併**——若你寫了兩個相鄰的 `{{ message "user" }}` 區塊，最終陣列會保留為兩則獨立的 `user` 訊息，以尊重作者意圖。
4. **僅含空白字元的頂層片段會被丟棄**，不會產生空的 `system` 訊息。

#### 限制

- **不可巢狀**：`{{ message }}` 區塊內不能再出現 `{{ message }}` 區塊。違反時 Vento 會在**編譯期**丟出 `multi-message:nested` 錯誤（即使巢狀的內層位於 `{{ if false }}` 之類永不執行的分支內也會被攔截，因為偵測在編譯期掃描 token 完成）。
- **必須至少有一則 `user` 訊息**：組裝完成後若整個訊息陣列中找不到 `role: "user"` 的元素，伺服器會以 `multi-message:no-user-message` 為類型回傳 422 RFC 9457 Problem Details，並**不會**呼叫上游 LLM API。最常見的做法是在模板末尾放上 `{{ message "user" }}<inputs>{{ user_input }}</inputs>{{ /message }}`。
- **無效角色於編譯期攔截**：若字串字面量不是 `"system"`/`"user"`/`"assistant"`（例如打錯為 `"sytsem"`），Vento 會在編譯期丟出 `multi-message:invalid-role`；若是動態識別字解析出非允許值，則於執行期丟出同一錯誤類別。

#### 完整多輪範例

以下範例展示 persona 系統訊息、few-shot 對話、以及最終的使用者輸入：

```vento
{{ message "system" }}
你是一位專精於奇幻文學的敘事家，請以正體中文回覆。

# 系列：{{ series_name }}
# 場景：
{{ lore_scenario }}
{{ /message }}

{{ for ex of examples }}
{{ message "user" }}{{ ex.q }}{{ /message }}
{{ message "assistant" }}{{ ex.a }}{{ /message }}
{{ /for }}

{{ for chapter of previous_context }}
{{ message "user" }}<previous_context>{{ chapter }}</previous_context>{{ /message }}
{{ /for }}

{{ if isFirstRound }}
{{ message "system" }}{{ start_hints }}{{ /message }}
{{ /if }}

{{ message "user" }}<inputs>{{ user_input }}</inputs>{{ /message }}
```

#### 錯誤類型總覽

| 錯誤類型 | 觸發時機 | 偵測階段 |
|---|---|---|
| `multi-message:invalid-role` | 角色不是 `system`/`user`/`assistant` | 字串字面量於編譯期；識別字於執行期 |
| `multi-message:nested` | 巢狀的 `{{ message }}` 區塊 | 編譯期 |
| `multi-message:no-user-message` | 組裝後找不到 `user` 訊息 | 渲染後 |
| `multi-message:assembly-corrupt` | 內部哨兵索引損毀（一般不應出現） | 渲染後 |

所有錯誤皆透過 `buildVentoError()` 包裝為 RFC 9457 Problem Details，並由 Prompt Editor 的 `VentoErrorCard` 顯示對應的修正建議。

### 設定區域變數與載入子模板

使用 `set` 搭配 `include` 將子模板內容存入區域變數，並透過 `|> trim` 管道過濾器去除前後空白。`-` 符號用於消除標籤本身產生的多餘空行：

```vento
{{- set my_var |> trim -}}{{- include "./my-template.md" -}}{{- /set -}}
```

之後可在模板中透過 `{{ my_var }}` 引用該變數的內容。

## 在 Prompt Editor UI 中編輯模板

`/settings/prompt-editor` 頁面是修改 `system.md` 的主要入口。編輯器有兩種互斥模式：**結構化卡片模式**（預設）與**純文字模式**（raw fallback）。

### 結構化卡片模式

載入時，編輯器會以前端解析器將 `system.md` 拆解為訊息卡片清單；每個 `{{ message "<role>" }}…{{ /message }}` 區塊對應一張卡片。每張卡片包含：

- **傳送者** `<select>`（系統 / 使用者 / 助理；底層值仍為英文 `system` / `user` / `assistant` 並在儲存時寫回）。
- **內容編輯區** — 一個 `<textarea>`，內容即該訊息區塊的原始 Vento 來源（保留原文，不做轉義）。
- **「插入變數」輔助選單** — 從現有的變數列表（核心變數 + 外掛變數 + 典籍變數）中選一個，會以 `{{ var_name }}` 形式插入游標位置。控制流程語法（`{{ for }}`、`{{ if }}` 等）仍需手動輸入。
- **上移／下移／刪除** 按鈕。刪除採卡片內聯確認（「確定刪除這則訊息？」），不會跳出對話框。

工具列提供「新增訊息」「儲存」「回復預設」「預覽 Prompt」以及「進階：純文字模式」切換。儲存時會將卡片清單序列化為 `{{ message "<role>" }}\n<body>\n{{ /message }}` 區塊，以單一空行分隔，並 `PUT /api/template`。

### 純文字模式（raw fallback）

純文字模式下，編輯器顯示完整的 `system.md` 原始來源於單一 `<textarea>` 中（與舊版編輯器行為相同），並在上方保留變數插入按鈕列。儲存時直接以 textarea 內容 `PUT /api/template`，不做序列化。

#### 自動切入純文字模式的情況

當解析器偵測到下列情況時，會自動切換為純文字模式並在工具列上方顯示可關閉的警告橫幅，內含 zh-TW 原因：

- **未配對的 `{{ message }}`／`{{ /message }}` 標籤**。
- **非允許角色**（角色字串字面量不在 `system` / `user` / `assistant` 之中）。
- **巢狀 `{{ message }}` 區塊**。
- **動態角色識別字**（如 `{{ message dynamic_role }}`）—「動態角色訊息標籤需使用純文字模式編輯」。卡片模式僅支援雙引號字串字面量角色。
- **JavaScript 表達式逸脫 `{{> … }}`** —「偵測到 JavaScript 表達式（{{> ...}}），需使用純文字模式編輯」。
- **`{{ echo }}…{{ /echo }}` 原始區塊** —「偵測到 echo 區塊，需使用純文字模式編輯」。

使用者亦可隨時手動點擊「進階：純文字模式」切換；於純文字模式下則改顯示「結構化模式」按鈕，再次點擊時會以當前 textarea 內容重新解析，成功則切回卡片，失敗則維持純文字並顯示橫幅原因。

### 模式切換與原始來源保留

切換到純文字模式時，textarea 會以**當前卡片清單的 `serializeMessageCards()` 結果**（即會儲存的有損正規化後內容）填入。這代表頂層內容（`{{ message }}` 區塊之外的文字）已在 cards 模式時被正規化掉，不會在切換時重新出現；如要保留逐字內容，請於載入後立即切換到純文字模式並直接編輯 `originalRawSource`。為避免來回切換靜默遺失卡片端的未存檔編輯，composable 會於 cards → raw 時快照當前 cards（深複製）與剛序列化的 raw 文字；若使用者未改動 textarea 而切回 cards，將原樣還原快照中的 cards。`originalRawSource` 僅於成功 Load／Save／Reset 時更新，模式切換不會碰觸它，dirty 追蹤始終以最近一次 Load／Save 的基準為準。

### 有損正規化警告

卡片模式只能表達 `{{ message }}` 區塊；位於所有區塊**之外**的頂層內容會以「有損正規化」處理：

- 第一個 `{{ message }}` 區塊**之前**的非空白頂層文字會合併為一張首位的 `system` 卡片（無資料遺失，不顯示警告）。
- 區塊**之間**或**之後**的非空白頂層文字會在儲存時被捨棄；此時解析器會回傳 `topLevelContentDropped = true`。
- 完全沒有 `{{ message }}` 區塊但有非空白內容的舊版模板，會整段成為單一 `system` 卡片（不視為遺失）。

當 `topLevelContentDropped === true` 時，卡片模式會顯示**常駐**（不可關閉）的警告長條：「範本中有部分內容（訊息區塊之外的文字）將在儲存時被捨棄；如要保留，請使用『進階：純文字模式』」。長條會在重新載入、重設或下一次成功的「純文字 → 卡片」切換（且新狀態未遺失內容）後消失。需要逐字保留註解或排版的作者，請改用純文字模式。

### 儲存前驗證

卡片模式下，「儲存」按鈕會在下列情況停用，並以 tooltip 說明原因，避免儲存後在伺服器端觸發 `multi-message:no-user-message` 或 `multi-message:empty-message`：

- 卡片清單為空 →「請至少新增一則訊息」。
- 沒有任何 `role === "user"` 卡片 →「請至少包含一則使用者訊息（傳送者：使用者）」。
- 任何卡片的內容經 `trim()` 後為空 →「請填入所有訊息的內容」。

純文字模式下不套用此項驗證（作者可能透過 Vento 控制流程在執行期動態產生 `user` 訊息）；伺服器仍會在儲存與渲染時各自執行自己的驗證。

### 儲存事件與預覽

無論在卡片模式或純文字模式，成功儲存（`PUT /api/template` 回傳成功）後 `PromptEditor.vue` 都會發出 `saved` 事件；`PromptEditorPage.vue` 監聽此事件並重新載入內嵌的 `PromptPreview`，使預覽永遠對應最新存檔內容。

## 提示詞建構流程

以下描述從使用者發送請求到 LLM 收到提示詞的完整流程：

### 1. 接收請求

客戶端發送 `POST /api/stories/:series/:name/chat`，請求主體包含 `{ message: "..." }`。

### 2. 準備資料

聊天端點處理器依序執行以下步驟：

1. **讀取章節檔案** — 從 `playground/:series/:name/` 目錄讀取所有現有章節檔案（最多取最近 200 個章節）
2. **偵測第一回合** — 檢查是否所有章節內容皆為空
3. **清理章節內容** — 對每個章節呼叫 `stripPromptTags()` 移除外掛定義的 XML 標籤，建構 `previousContext` 陣列
4. **載入狀態資料** — 讀取 `current-status.yaml`（若不存在則回退至 `init-status.yaml`）

### 3. 渲染模板

呼叫 `renderSystemPrompt()`，此函式：

1. 讀取主模板 `system.md`（或使用者提供的覆寫模板）
2. 解析典籍系統（Lore Codex）變數：呼叫 `resolveLoreVariables()` 掃描適用的 global / series / story 篇章，取得原始篇章與第一輪變數快照
3. 逐篇渲染典籍內容：將每篇篇章本體透過 Vento 引擎渲染，傳入不可變的第一輪變數快照（包含所有 `lore_*` 變數、`series_name`、`story_name`）。若渲染失敗則回退為原始內容
4. 重新產生典籍變數：以渲染後的篇章重新計算 `lore_all`、`lore_<tag>`、`lore_tags`
5. 收集外掛提供的變數與內容片段
6. 使用 Vento 引擎渲染主模板，傳入所有變數：

```typescript
// 收集外掛動態變數
const dynamicVars = await pluginManager.getDynamicVariables({
  series: series || "",
  name: story || "",
  storyDir: storyDir || "",
});

const result = await ventoEnv.runString(systemTemplate, {
  ...dynamicVars,
  previous_context: previousContext || [],
  user_input: userInput || "",
  isFirstRound: isFirstRound || false,
  series_name: series || "",
  story_name: story || "",
  ...loreVars,
  ...pluginVars.variables,
  plugin_fragments: pluginVars.fragments || [],
});
```

> [!IMPORTANT]
> 使用者提供的覆寫模板會經過 `validateTemplate()` 白名單驗證，阻擋函式呼叫、屬性存取等不安全的表達式，防止 SSTI 攻擊。

### 4. 組裝訊息陣列

模板渲染完成後，`splitRenderedMessages()` 後處理器會：

1. 以每次渲染專屬的 nonce 為標誌，將渲染輸出依字面順序拆解為「文字片段」與「`{{ message }}` 區塊的訊息」。
2. 將非空白的頂層文字片段視為 `system` 訊息。
3. 合併相鄰的 `system` 訊息（以 `\n` 串接），但保留相同角色的非系統訊息為獨立元素。
4. 丟棄純空白的片段。

接著呼叫 `assertHasUserMessage()`，若組裝後的陣列不包含任何 `role: "user"` 訊息，則丟出 `multi-message:no-user-message` 錯誤，伺服器以 422 RFC 9457 Problem Details 回應，**不會**呼叫上游 LLM API。

> [!IMPORTANT]
> 渲染後的模板即為發送至 LLM 的完整 `messages` 陣列。伺服器**不再**自動補上 `{ role: "user", content: message }`——`user_input` 變數仍可用，但必須由模板作者放在 `{{ message "user" }}` 區塊內部。

### 5. 發送至 LLM

組裝後的 `messages` 陣列直接作為 OpenAI 相容 Chat Completions 請求的 `messages` 欄位，透過串流方式發送至上游 LLM API，回應逐步寫入章節檔案。

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

# Vento 語法

## 變數插值

使用雙大括號 `{{ }}` 輸出變數值：

```vento
{{ lore_scenario }}
{{ user_input }}
```

## 陣列迭代

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

## 條件渲染

使用 `{{ if ... }}` 進行條件判斷：

```vento
{{ if isFirstRound }}
<start_hints>第一回合的起始提示...</start_hints>
{{ /if }}
```

當 `isFirstRound` 為 `true` 時，渲染 `<start_hints>` 區塊；否則跳過。

## `{{ message }}` 多訊息標籤

`{{ message }}` 是本專案註冊到 Vento 的自訂區塊標籤，用於在模板中宣告一則送往 LLM 的對話訊息。**渲染後的模板就是上游 `messages` 陣列的唯一來源**——伺服器不會在模板之外自動補上任何 `system` 或 `user` 訊息，模板必須自行透過 `{{ message }}` 區塊產生內容。

### 語法

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

### 區塊內容支援的語法

`{{ message }}` 區塊內可使用所有一般 Vento 語法：變數插值、`{{ if }}`、`{{ for }}`、管道過濾器、外掛片段插值、典籍變數等。

```vento
{{ message "system" }}
角色：{{ persona_name }}
{{ if isFirstRound }}
這是故事的第一回合，請以開場白引入場景。
{{ /if }}
{{ /message }}
```

### 訊息順序與合併規則

整份模板渲染後的訊息順序，**完全依照原始碼的字面順序**組裝：

1. 任何位於所有 `{{ message }}` 區塊**之外**的頂層文字會被視為 `system` 角色內容，依字面順序插入訊息陣列中。
2. **相鄰的 `system` 訊息會被合併**為單一訊息，內容以單一換行 `\n` 串接。這包括頂層文字之間、頂層文字與作者明確寫的 `{{ message "system" }}` 區塊之間，以及兩個明確寫的 `{{ message "system" }}` 區塊之間。
3. **相同角色的非系統訊息（`user`/`assistant`）不會合併**——若你寫了兩個相鄰的 `{{ message "user" }}` 區塊，最終陣列會保留為兩則獨立的 `user` 訊息，以尊重作者意圖。
4. **僅含空白字元的頂層片段會被丟棄**，不會產生空的 `system` 訊息。

### 限制

- **不可巢狀**：`{{ message }}` 區塊內不能再出現 `{{ message }}` 區塊。違反時 Vento 會在**編譯期**丟出 `multi-message:nested` 錯誤（即使巢狀的內層位於 `{{ if false }}` 之類永不執行的分支內也會被攔截，因為偵測在編譯期掃描 token 完成）。
- **必須至少有一則 `user` 訊息**：組裝完成後若整個訊息陣列中找不到 `role: "user"` 的元素，伺服器會以 `multi-message:no-user-message` 為類型回傳 422 RFC 9457 Problem Details，並**不會**呼叫上游 LLM API。最常見的做法是在模板末尾放上 `{{ message "user" }}<inputs>{{ user_input }}</inputs>{{ /message }}`。
- **無效角色於編譯期攔截**：若字串字面量不是 `"system"`/`"user"`/`"assistant"`（例如打錯為 `"sytsem"`），Vento 會在編譯期丟出 `multi-message:invalid-role`；若是動態識別字解析出非允許值，則於執行期丟出同一錯誤類別。

### 完整多輪範例

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

### 錯誤類型總覽

| 錯誤類型 | 觸發時機 | 偵測階段 |
|---|---|---|
| `multi-message:invalid-role` | 角色不是 `system`/`user`/`assistant` | 字串字面量於編譯期；識別字於執行期 |
| `multi-message:nested` | 巢狀的 `{{ message }}` 區塊 | 編譯期 |
| `multi-message:no-user-message` | 組裝後找不到 `user` 訊息 | 渲染後 |
| `multi-message:assembly-corrupt` | 內部哨兵索引損毀（一般不應出現） | 渲染後 |

所有錯誤皆透過 `buildVentoError()` 包裝為 RFC 9457 Problem Details，並由 Prompt Editor 的 `VentoErrorCard` 顯示對應的修正建議。

## 區域變數與子模板的替代寫法

Vento 的 `set` / `/set` 與 `include` 區塊指令在本專案中**已被 SSTI 白名單封鎖**，無法在 `system.md`、plugin `promptFragments`、或典籍篇章中使用。需要等同功能時請依下列模式改寫：

- **想把一段 Markdown 抽出來重用** → 由 plugin 在 `promptFragments` 宣告該檔案，並指定 `variable` 名稱。模板中直接以 `{{ my_instructions }}` 引用即可，不必透過外部子模板載入。
- **想根據資料動態組裝字串** → 由 plugin 後端模組匯出 `getDynamicVariables()`，把計算好的字串以具名變數回傳，模板僅做純插值。
- **想在模板中暫存中間結果（trim、串接等）** → 改在資料來源端（plugin 變數產生時）處理；模板層僅允許 `|> trim` 之類的管道過濾器，不允許自訂中間變數。

例如，過去可能在模板中以 Vento `set` + `include` 把 `./snippet.md` 讀進 `my_var` 再插值的片段，現在應改為：

```jsonc
// plugin.json
{
  "promptFragments": [
    { "file": "./snippet.md", "variable": "my_var", "priority": 100 }
  ]
}
```

```vento
{{ my_var }}
```

引擎會在渲染前讀取 `snippet.md` 並以 `my_var` 注入模板，行為與原本 `set` + `include` 等價，但不再經過樣板層的執行期表達式。

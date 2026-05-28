# 提示詞片段

提示詞片段是 plugin 向系統提示詞注入內容的主要機制。Plugin 在 manifest 的 `promptFragments` 陣列中宣告片段檔案，系統在渲染提示詞時將檔案內容載入為 Vento 模板變數。

## 片段宣告格式

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

## 與 `{{ message }}` 多訊息標籤的互動

自從 `{{ message }}` 多訊息標籤加入後，模板可將不同片段指派到不同對話角色。Plugin 作者撰寫片段時請注意以下規則：

- **片段內容以純文字插值**：Vento 將 `{{ fragment }}` 以 `output += fragment` 的形式輸出，**不會**重新解析片段內容為 Vento 原始碼。也就是說，片段檔案中即使寫入 `{{ message "user" }}…{{ /message }}`，這些字元也會原樣呈現，**不會**產生新的對話訊息。若需要將片段綁定到特定角色，請由模板作者在 `system.md` 中以 `{{ message "<role>" }}{{ for f of plugin_fragments }}{{ f }}{{ /for }}{{ /message }}` 的方式包裹。
- **不可巢狀**：若片段內容會被插入到 `{{ message }}` 區塊之內，片段本體**不得**再寫入 `{{ message }}` 標籤——巢狀的 `{{ message }}` 區塊會在編譯期被 `multi-message:nested` 拒絕。
- **角色變數的型別約束**：若 plugin 透過 `getDynamicVariables()` 提供的變數會在模板中作為 `{{ message <ident> }}` 的角色識別字使用，該變數的執行期值**必須**僅為 `"system"`、`"user"`、`"assistant"` 三者之一，否則會在執行期丟出 `multi-message:invalid-role`。

## 路徑安全

片段檔案路徑經過 `path.resolve()` 後，必須仍在 plugin 目錄內部。嘗試透過 `../` 讀取 plugin 目錄外部的檔案會被攔截並跳過。

## 在 Template Editor 中為唯讀（read-only）

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

## 目前的 plugin 變數

以下是所有內建 plugin 提供的模板變數：

| 變數名稱 | 來源 plugin | Priority | 說明 |
|----------|-------------|----------|------|
| `think_before_reply` | thinking | 100 | 回覆前思考指令（chain-of-thought） |
| `start_hints` | start-hints | 100 | 首輪章節開場引導提示 |
| `context_compaction` | context-compaction | 800 | 長篇脈絡壓縮摘要 |

這些變數之外，系統還提供六個核心變數：`previous_context`、`user_input`、`isFirstRound`、`series_name`、`story_name`、`plugin_fragments`，以及外掛透過 `getDynamicVariables()` 提供的動態變數和典籍系統（Lore Codex）提供的 `lore_all`、`lore_<tag>`、`lore_tags` 等變數。詳細說明參見 [Prompt 模板系統][prompt-template] 及[典籍系統文件][lore-codex]。

[prompt-template]: ../author/prompt-template.md
[lore-codex]: ../author/lore-codex.md

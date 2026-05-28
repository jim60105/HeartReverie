# 標籤清除

LLM 回應中包含 plugin 定義的 XML 標籤，這些標籤會隨回應一同寫入章節檔案。系統提供兩種標籤清除機制：

- **`promptStripTags`**：在後端組建提示詞時生效。系統讀取已儲存的章節內容組建 `previousContext` 時，移除符合 pattern 的標籤，避免這些標籤出現在送往 LLM 的提示詞中。
- **`displayStripTags`**：在前端瀏覽器渲染時生效。前端在顯示章節內容時移除符合 pattern 的標籤，讓讀者不會看到這些內部標記。

兩個欄位支援相同的 pattern 格式：純文字標籤名稱和正規表達式。

## 純文字標籤

最簡單的形式是直接寫標籤名稱：

```json
{
  "promptStripTags": ["disclaimer", "user_message"],
  "displayStripTags": ["disclaimer", "scratchpad"]
}
```

系統會自動將每個名稱包裝為正規表達式 `<tagname>[\\s\\S]*?</tagname>`，進行非貪婪比對。

## 正規表達式模式

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
- 無效的正規表達式語法會被 try-catch 捕捉並跳過，不影響其餘 pattern
- 前端的 `displayStripTags` 會額外執行 ReDoS 安全檢測，自動跳過可能造成效能問題的 pattern

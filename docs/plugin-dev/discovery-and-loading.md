# Plugin 探索與載入

## 探索流程

伺服器啟動時，`PluginManager.init()` 依序掃描兩個目錄：

1. **內建 plugin**：專案根目錄下的 `plugins/` 目錄
2. **外部 plugin**：環境變數 `PLUGIN_DIR` 指定的目錄（選填，必須為絕對路徑）

當外部 plugin 的名稱與內建 plugin 相同時，外部 plugin 會覆蓋內建版本。系統會在 console 記錄覆蓋資訊。

## 驗證規則

探索過程中，系統對每個 plugin 執行以下驗證：

- `plugin.json` 必須為合法的 JSON 格式
- `name` 為必填欄位
- `name` 必須與所在目錄名稱完全一致（防止 plugin 冒名）
- `displayName` 為必填欄位，必須為字串，trim 後不得為空字串
- Plugin 名稱不得包含 `..`、`\0`、`/`、`\` 等路徑穿越字元

驗證失敗時，系統記錄警告並跳過該 plugin，不影響其餘 plugin 的載入。

## 後端模組初始化

具有 `backendModule` 的 plugin 會在探索完成後進行模組初始化。系統以 `import()` 動態載入模組（在 Deno 中使用 `file://` URL），並呼叫其匯出的 `register(context)` 函式。context 物件包含 `hooks`（HookDispatcher 實例）、`logger`（已綁定 plugin 名稱的 Logger 實例）和 `getSettings()`（讀取該 plugin 已合併預設值的設定），讓 plugin 向 HookDispatcher 註冊 hook 處理函式、讀取執行期設定並記錄結構化日誌。系統亦支援 `mod.default` 作為 `register` 匯出的備援（即 `const registerFn = mod.register || mod.default;`）。

模組路徑必須通過路徑包含檢查——解析後的絕對路徑必須位於 plugin 目錄內部，否則跳過載入。

若模組同時匯出 `getDynamicVariables(context)` 函式，系統會在渲染提示詞時呼叫該函式，取得動態模板變數（見「動態變數」章節）。

若模組同時匯出 `registerRoutes(context)` 函式，系統會在 `createApp()` 期間呼叫一次，將 plugin 自訂的 HTTP 路由掛載於 `/api/plugins/:name/*` 之下（見「[Plugin 自訂 API 路由](api-routes.md)」章節）。

## 動態變數

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

- 動態變數不得覆寫核心變數（`previous_context`、`user_input`、`isFirstRound`、`series_name`、`story_name`、`plugin_fragments`、`draft`），否則記錄警告並忽略
- 多個 plugin 提供相同鍵時，先載入的 plugin 優先（first-loaded wins），記錄警告
- 動態變數的優先順序低於核心變數與典籍變數（spread 在最前方）

若 plugin 透過 `getDynamicVariables()` 提供變數，建議同時在 `plugin.json` 的 `parameters` 陣列中宣告該變數，使 API 端點 `GET /api/plugins/parameters` 能正確列出。

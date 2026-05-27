# 提示詞建構流程

以下描述從使用者發送請求到 LLM 收到提示詞的完整流程：

## 1. 接收請求

客戶端發送 `POST /api/stories/:series/:name/chat`，請求主體包含 `{ message: "..." }`。

## 2. 準備資料

聊天端點處理器依序執行以下步驟：

1. **讀取章節檔案** — 從 `playground/:series/:name/` 目錄讀取所有現有章節檔案（最多取最近 200 個章節）
2. **偵測第一回合** — 檢查是否所有章節內容皆為空
3. **清理章節內容** — 對每個章節呼叫 `stripPromptTags()` 移除外掛定義的 XML 標籤，建構 `previousContext` 陣列
4. **載入狀態資料** — 讀取 `current-status.yaml`（若不存在則回退至 `init-status.yaml`）

## 3. 渲染模板

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

## 4. 組裝訊息陣列

模板渲染完成後，`splitRenderedMessages()` 後處理器會：

1. 以每次渲染專屬的 nonce 為標誌，將渲染輸出依字面順序拆解為「文字片段」與「`{{ message }}` 區塊的訊息」。
2. 將非空白的頂層文字片段視為 `system` 訊息。
3. 合併相鄰的 `system` 訊息（以 `\n` 串接），但保留相同角色的非系統訊息為獨立元素。
4. 丟棄純空白的片段。

接著呼叫 `assertHasUserMessage()`，若組裝後的陣列不包含任何 `role: "user"` 訊息，則丟出 `multi-message:no-user-message` 錯誤，伺服器以 422 RFC 9457 Problem Details 回應，**不會**呼叫上游 LLM API。

> [!IMPORTANT]
> 渲染後的模板即為發送至 LLM 的完整 `messages` 陣列。伺服器**不再**自動補上 `{ role: "user", content: message }`——`user_input` 變數仍可用，但必須由模板作者放在 `{{ message "user" }}` 區塊內部。

## 5. 發送至 LLM

組裝後的 `messages` 陣列直接作為 OpenAI 相容 Chat Completions 請求的 `messages` 欄位，透過串流方式發送至上游 LLM API，回應逐步寫入章節檔案。

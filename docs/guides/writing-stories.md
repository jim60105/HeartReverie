# 撰寫故事

HeartReverie 把「寫小說」拆成兩種角色，你輸入幾句話來引導劇情走向，AI 接著把故事寫進章節檔案。整個流程圍繞著「章節 `.md` 檔」展開，前端 Reader UI 把章節逐字渲染，Writer UI 讓你直接編輯章節原文，提示詞模板與典籍系統決定 AI 接續時看到的脈絡。

## 一段章節的完整生命週期

1. **準備脈絡**：開啟故事後，引擎會把該故事下所有章節（`01.md`、`02.md`、…）讀進 `previous_context`，並依 Plugin 的 `promptStripTags` 設定移除標籤內容。
2. **使用者輸入**：你在 Reader UI 底部輸入幾句話作為 `user_input`，這段內容只作為引導，不會直接寫進章節。
3. **組裝提示詞**：引擎用 `system.md`（Vento 模板）渲染最終 prompt，把 `previous_context`、`user_input`、`lore_*` 變數、Plugin 提供的片段全部注入。詳見 [Prompt 模板概覽](/prompt-template/overview.md)。
4. **呼叫 LLM**：以串流方式接收回應，逐字寫進下一個章節檔。Plugin 可以在 `response-stream` hook 中對串流分塊做處理。
5. **寫入後續**：寫入完成後派發 `post-response` hook，Plugin 可在此記錄、計算 token 用量或觸發後續動作。

## 引導 AI 走出你想要的劇情

「引導」是 HeartReverie 想要凸顯的工作模式，你提供方向，AI 提供內容。建議的做法如下。

- **第一回合**：留下空白章節（或只放開場一兩句），讓 AI 把開頭寫完。引擎會在 `isFirstRound` 為 `true` 時切換到首回合模式。
- **中段**：在 `user_input` 寫下你希望的劇情轉折、角色互動或設定提示。內容愈具體，AI 愈不會脫離你的構想。
- **修正方向**：發現 AI 跑偏時，最快的做法是切到 Writer UI 直接刪改章節原文，再回到 Reader UI 讓 AI 接續。詳見 [Writer UI](writer-ui.md)。

## 把世界觀寫進典籍

如果你的世界觀很龐大，把每一份設定都塞進 `user_input` 並不實際。建議把世界觀寫進典籍篇章，並用標籤管理觸發條件。引擎會自動把篇章注入 Vento 變數 `lore_<tag>`，供 `system.md` 引用。詳見[典籍系統概覽](/lore-codex/overview.md)。

## 用 Plugin 擴充工作流

撰寫故事的工作流幾乎所有環節都能透過 Plugin 擴充，包含提示詞片段、Hook、自訂 UI 區塊、自訂 API 路由。完整擴充點請見 [Plugin 系統概覽](/plugin-system/overview.md)，撰寫指南請見 [撰寫自訂 Plugin](/plugin-system/authoring-guide.md)。

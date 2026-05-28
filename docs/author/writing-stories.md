# 撰寫故事

HeartReverie 把「寫小說」拆成兩種角色，你輸入幾句話來引導劇情走向，AI 接著把故事寫進章節檔案。整個流程圍繞著「章節 `.md` 檔」展開，前端 Reader UI 把章節逐字渲染，Writer UI 讓你直接編輯章節原文，提示詞模板與典籍系統決定 AI 接續時看到的脈絡。

## 一段章節的完整生命週期

1. **準備脈絡**：開啟故事後，引擎會把該故事下所有章節（`01.md`、`02.md`、…）讀進 `previous_context`，並依 Plugin 的 `promptStripTags` 設定移除標籤內容。
2. **使用者輸入**：你在 Reader UI 底部輸入幾句話作為 `user_input`，這段內容只作為引導，不會直接寫進章節。
3. **組裝提示詞**：引擎用 `system.md`（Vento 模板）渲染最終 prompt，把 `previous_context`、`user_input`、`lore_*` 變數、Plugin 提供的片段全部注入。詳見 [Prompt 模板概覽](prompt-template.md)。
4. **呼叫 LLM**：以串流方式接收回應，逐字寫進下一個章節檔。Plugin 可以在 `response-stream` hook 中對串流分塊做處理。
5. **寫入後續**：寫入完成後派發 `post-response` hook，Plugin 可在此記錄、計算 token 用量或觸發後續動作。

## 引導 AI 走出你想要的劇情

HeartReverie 是隨興 RPG 故事冒險引擎：你操控故事的走向、AI 寫出章節內容。引導全靠故事指令輸入框：

- **第一回合**：在輸入框寫下開場想要的場景與角色互動方向，按發送讓 AI 把開頭章節寫完。引擎於 `isFirstRound = true` 時切換到首回合模式。
- **中段**：在輸入框描述想要的劇情轉折、角色互動或設定提示。內容愈具體，AI 愈貼近你的構想。輸入內容只作為 `user_input` 傳遞，不會被寫入章節本身。
- **修正方向**：若 AI 跑偏，最快的做法是點該章工具列的「編輯」直接修訂章節原文，下一回合的 `previous_context` 自動帶入修訂後的內容。詳見 [Writer UI](writer-ui.md)。

## 把世界觀寫進典籍

世界觀龐大時，逐次把設定塞進 `user_input` 並不實際。建議把世界觀寫進典籍篇章，由標籤決定每篇要拼進提示詞的哪個位置。引擎掃描每篇 frontmatter `tags`、所在子目錄名與檔名，組成有效標籤集合，再依標籤把內容串接到 Vento 變數 `lore_<tag>`，供 `system.md` 用 `{{ lore_<tag> }}` 引用。標籤的角色是**提示詞拼裝**——決定一篇典籍落在 system prompt 的哪個區塊；它不是觸發條件，也沒有「符合就啟動」的動態判斷。是否注入由 frontmatter `enabled` 決定，順序由 `priority` 決定。詳見[典籍系統概覽](lore-codex.md)。

## 用 Plugin 擴充工作流

撰寫故事的工作流幾乎所有環節都能透過 Plugin 擴充，包含提示詞片段、Hook、自訂 UI 區塊、自訂 API 路由。完整擴充點請見 [Plugin 系統概覽](../plugin-dev/overview.md)，範本骨架請見 [外掛範本骨架](../plugin-dev/authoring-guide.md)。

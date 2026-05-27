# 內建 Plugin 一覽

| Plugin | 類型 | 功能 |
|--------|------|------|
| context-compaction | full-stack | 長篇脈絡壓縮，自動摘要早期章節 |
| dialogue-colorize | frontend-only | 對話標籤上色顯示，透過 `chapter:dom:ready` / `chapter:dom:dispose` 以 CSS Custom Highlight API 標示引號區段，不修改 DOM |
| polish | full-stack | 一鍵文學潤飾改寫；貢獻 `✨ 潤飾` 動作按鈕（`visibleWhen: "last-chapter-backend"`），以 `replace: true` 原子覆寫最新章節。前端模組為薄層 action-button click 接線 |
| reading-progress | full-stack | 單一使用者多裝置閱讀進度同步——章節編號、捲動比例與文字片段錨點，支援檔案或瀏覽器本地兩種儲存後端 |
| start-hints | prompt-only | 首輪章節開場引導提示，含提示詞與顯示標籤清除 |
| thinking | full-stack | 回覆前思考指令與折疊 `<thinking>`/`<think>` 標籤為可展開的 details 元素 |
| user-message | full-stack | 使用者訊息標籤前端清除，pre-write hook 注入使用者訊息區塊 |
| response-notify | full-stack | 後端 → 前端 Toast 通知系統，透過 `notification` hook 推送使用者提示 |

> [!NOTE]
> 內建 plugin 的提示詞內容必須維持 SFW（Safe For Work）。禁止包含 NSFW 內容、越獄指令（jailbreak）或年齡相關指示。使用者如有此類需求，應透過外部 plugin（`PLUGIN_DIR`）自行提供。

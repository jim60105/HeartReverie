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

`dialogue-colorize` 啟用後，章節內凡是被 `「」` 或對話標籤包覆的引號區段都會以主題色塊高亮，幫助讀者快速辨認對話發話者。

<!-- screenshot-recipe
schema: v1
url: http://localhost:8080/悠奈悠花姊妹大冒險/放學後/
viewport: 1440x900
theme: default
preconditions:
  - 容器已啟動於 localhost:8080
  - 已通過 PASSPHRASE 登入
  - dialogue-colorize plugin 已啟用
steps:
  - wait_for: 'main'
capture: viewport
output: docs/assets/screenshots/plugin-dialogue-colorize.png
captured_at: 2026-05-28
app_commit: 4534325
-->
![章節內對話引號被對話著色 plugin 高亮顯示](../assets/screenshots/plugin-dialogue-colorize.png)

`reading-progress` 會在章節捲動時持續記錄當前位置，把章節編號、捲動比例與文字片段錨點寫回 playground 或瀏覽器 storage；下次開啟同一故事時自動回到上次閱讀位置。此 plugin 在閱讀章節時靜默運作、沒有額外的 UI 元素，因此下圖改以設定頁面呈現可調整的同步開關、儲存後端、輪詢與保留天數等選項。

<!-- screenshot-recipe
schema: v1
url: http://localhost:8080/settings/plugins/reading-progress
viewport: 1440x900
theme: default
preconditions:
  - 容器已啟動於 localhost:8080
  - 已通過 PASSPHRASE 登入
  - reading-progress plugin 已啟用
steps:
  - wait_for: 'main'
capture: viewport
output: docs/assets/screenshots/plugin-reading-progress.png
captured_at: 2026-05-28
app_commit: 4534325
-->
![閱讀進度 plugin 的設定頁面，可調整同步開關、進度儲存後端、輪詢間隔與保留天數](../assets/screenshots/plugin-reading-progress.png)

> [!NOTE]
> 內建 plugin 的提示詞內容必須維持 SFW（Safe For Work）。禁止包含 NSFW 內容、越獄指令（jailbreak）或年齡相關指示。使用者如有此類需求，應透過外部 plugin（`PLUGIN_DIR`）自行提供。

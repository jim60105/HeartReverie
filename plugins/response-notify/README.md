# response-notify

LLM 章節生成完成時自動發出通知。分頁在背景時優先走系統通知，分頁在前景時用站內 toast，讓讀者不必一直盯著畫面。

## 運作原理

純前端外掛，註冊於 `notification` hook 階段，監聽 WebSocket 的 `chat:done` 事件。事件抵達時，外掛會依照 `document.visibilityState` 與 `notifyWhenVisible` 設定選擇通知通道：

- 分頁隱藏：以 `channel: 'auto'` 發送。若先前已授予系統通知權限就走系統通知，否則一律回退至站內 toast；分頁隱藏時不會主動跳出權限請求視窗。
- 分頁可見且 `notifyWhenVisible` 為 `true`：以 `channel: 'in-app'` 發送站內 toast。
- 分頁可見且 `notifyWhenVisible` 為 `false`：不發通知。

要在背景收到系統通知，需要先在分頁可見時授予瀏覽器通知權限；拒絕或尚未授權時，外掛仍會以站內 toast 通知。

## 設定項目

| 設定 | 預設 | 說明 |
|------|------|------|
| `enabled` | `true` | 關閉後外掛停用，等同未安裝。 |
| `notifyTitle` | `故事生成完成` | 通知標題文字。 |
| `notifyBody` | `新的章節已經寫入完成` | 通知內文。 |
| `notifyWhenVisible` | `true` | 開啟時，分頁在前景也會跳站內 toast；關閉後僅在分頁隱藏時才提醒。 |
| `notifyLevel` | `success` | 通知視覺等級，可選 `info`、`success`、`warning`。 |

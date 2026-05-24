# response-notify

章節生成要等一段時間，這個外掛在 LLM 寫完時跳通知提醒你回來看。分頁切到背景就走作業系統通知，分頁在前景則用站內 toast，不必一直盯著畫面等。

## 如何使用

預設啟用後，每當 LLM 生成完一章就會自動通知。想在背景也收到作業系統通知，第一次使用時要在分頁可見的狀態下授予瀏覽器通知權限（外掛不會主動跳權限請求）；拒絕或尚未授權時仍會用站內 toast 提醒。

## 設定項目

| 設定 | 預設 | 說明 |
|------|------|------|
| `enabled` | `true` | 關掉後外掛停用，章節寫完不會跳通知。 |
| `notifyTitle` | `故事生成完成` | 通知標題文字。 |
| `notifyBody` | `新的章節已經寫入完成` | 通知內文。 |
| `notifyWhenVisible` | `true` | 開啟時，分頁在前景也會跳站內 toast；關閉後僅在分頁隱藏時才提醒。 |
| `notifyLevel` | `success` | 通知視覺等級，可選 `info`、`success`、`warning`。 |

## 運作原理

純前端外掛，註冊於 `notification` hook 階段，監聽 WebSocket 的 `chat:done` 事件。事件抵達時，外掛會依照 `document.visibilityState` 與 `notifyWhenVisible` 設定選擇通知通道：

- 分頁隱藏：以 `channel: 'auto'` 發送。若先前已授予系統通知權限就走系統通知，否則一律回退至站內 toast；分頁隱藏時不會主動跳出權限請求視窗。
- 分頁可見且 `notifyWhenVisible` 為 `true`：以 `channel: 'in-app'` 發送站內 toast。
- 分頁可見且 `notifyWhenVisible` 為 `false`：不發通知。

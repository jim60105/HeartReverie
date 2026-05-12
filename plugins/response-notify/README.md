# response-notify

在 LLM 生成完成後透過前端 `notification` hook 發出通知。

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | 關閉後本外掛將停用，等同未安裝外掛。 |
| `notifyTitle` | `故事生成完成` | 通知標題。 |
| `notifyBody` | `新的章節已經寫入完成` | 通知內文。 |
| `notifyWhenVisible` | `true` | 預設開啟：頁面可見時以站內 toast 通知，隱藏時以系統通知通知。關閉後僅在頁面隱藏時通知。 |
| `notifyLevel` | `success` | 通知視覺等級：`info`、`success` 或 `warning`。 |

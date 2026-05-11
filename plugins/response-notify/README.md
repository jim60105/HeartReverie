# response-notify

在 LLM 生成完成後透過前端 `notification` hook 發出通知。

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | 關閉後不再發出完成通知。 |
| `notifyTitle` | `故事生成完成` | 通知標題。 |
| `notifyBody` | `新的章節已經寫入完成` | 通知內文。 |
| `notifyWhenVisible` | `false` | 預設只在文件隱藏時通知；開啟後文件可見時也通知。 |
| `notifyLevel` | `success` | 通知視覺等級：`info`、`success` 或 `warning`。 |

# 篇章格式

每個篇章是一個 `.md` 檔案，包含選填的 YAML 前言區塊（frontmatter）與 Markdown 內容：

```markdown
---
tags: [character, world]
priority: 100
enabled: true
---

（Markdown 內容）
```

## Frontmatter 欄位

| 欄位 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| `tags` | `string[]` | `[]` | 分類標籤 |
| `priority` | `number` | `0` | 排序權重，數字越大越先出現 |
| `enabled` | `boolean` | `true` | 設為 `false` 可排除此篇章，不注入提示詞 |

Frontmatter 為選填。若省略，篇章以預設值載入（無標籤、priority 0、啟用）。

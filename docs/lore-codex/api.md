# API 參考

所有 API 端點皆需通過認證（`X-Passphrase` header 或 WebSocket 認證）。

## 端點一覽

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/lore/tags` | 列出所有標籤 |
| GET | `/api/lore/global` | 列出全域篇章 |
| GET | `/api/lore/series/:series` | 列出系列篇章 |
| GET | `/api/lore/story/:series/:story` | 列出故事篇章 |
| GET | `/api/lore/global/*path` | 讀取單一全域篇章 |
| GET | `/api/lore/series/:series/*path` | 讀取單一系列篇章 |
| GET | `/api/lore/story/:series/:story/*path` | 讀取單一故事篇章 |
| PUT | `/api/lore/global/*path` | 建立或更新全域篇章 |
| PUT | `/api/lore/series/:series/*path` | 建立或更新系列篇章 |
| PUT | `/api/lore/story/:series/:story/*path` | 建立或更新故事篇章 |
| DELETE | `/api/lore/global/*path` | 刪除全域篇章 |
| DELETE | `/api/lore/series/:series/*path` | 刪除系列篇章 |
| DELETE | `/api/lore/story/:series/:story/*path` | 刪除故事篇章 |

## 查詢參數

列表端點（GET scope）支援 `?tag=` 參數，以有效標籤過濾結果：

```
GET /api/lore/global?tag=characters
```

## GET 列表回應格式

```json
[
  {
    "filename": "hero.md",
    "directory": "characters",
    "tags": ["protagonist", "characters", "hero"],
    "priority": 100,
    "enabled": true,
    "scope": "global"
  }
]
```

## GET 單一篇章回應格式

```json
{
  "frontmatter": { "tags": ["protagonist"], "priority": 100, "enabled": true },
  "content": "Markdown 內容"
}
```

## PUT 請求主體格式

```json
{
  "frontmatter": { "tags": ["tag1"], "priority": 0, "enabled": true },
  "content": "Markdown 內容"
}
```

建立新篇章回傳 `201`，更新現有篇章回傳 `200`。刪除篇章回傳 `204`（無回應內容）。路徑中的 `*path` 必須以 `.md` 結尾。

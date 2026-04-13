# 典籍系統（Lore Codex）

典籍系統是以檔案為基礎的世界觀知識庫，取代舊有的 `scenario.md` 做法。設計靈感來自 SillyTavern 的 World Info，但採用檔案優先的工作流程。每一則知識以 Markdown 篇章（passage）的形式存放，透過標籤（tag）分類，再注入為 Vento 模板變數供系統提示詞引用。

## 目錄結構

典籍資料以 `_lore/` 子目錄的形式與系列、故事資料共置（co-located），分為三個作用域（scope）：

```
playground/
├── _lore/                          # 全域篇章 — 套用於所有故事
│   ├── world-rules.md
│   └── characters/                 # 子目錄即為隱式標籤
│       ├── hero.md
│       └── villain.md
├── <series>/
│   ├── _lore/                      # 系列篇章 — 套用於該系列下所有故事
│   │   └── scenario.md
│   └── <story>/
│       ├── _lore/                  # 故事篇章 — 僅套用於特定故事
│       │   └── chapter-context.md
│       ├── 01.md
│       └── 02.md
```

| 作用域 | 目錄 | 套用範圍 |
|--------|------|---------|
| global | `playground/_lore/` | 所有故事 |
| series | `playground/<series>/_lore/` | 同一系列下的所有故事 |
| story | `playground/<series>/<story>/_lore/` | 特定故事 |

各作用域目錄下可建立一層子目錄，子目錄名稱會自動成為該目錄內所有篇章的隱式標籤（directory-as-tag）。

### 底線前綴保留規則

以底線（`_`）開頭的目錄名稱為系統保留名稱，不會被列為系列或故事。`_lore/` 即屬於此類保留目錄。故事列表 API 和典籍標籤掃描皆會自動排除底線前綴的目錄。

## 篇章格式

每個篇章是一個 `.md` 檔案，包含選填的 YAML 前言區塊（frontmatter）與 Markdown 內容：

```markdown
---
tags: [character, world]
priority: 100
enabled: true
---

（Markdown 內容）
```

### Frontmatter 欄位

| 欄位 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| `tags` | `string[]` | `[]` | 分類標籤 |
| `priority` | `number` | `0` | 排序權重，數字越大越先出現 |
| `enabled` | `boolean` | `true` | 設為 `false` 可排除此篇章，不注入提示詞 |

Frontmatter 為選填。若省略，篇章以預設值載入（無標籤、priority 0、啟用）。

## 標籤系統

### 有效標籤

每個篇章的有效標籤（effective tags）由三個來源聯集而成：

1. **Frontmatter 標籤**：`tags` 欄位中宣告的標籤
2. **目錄隱式標籤**：若篇章位於子目錄中，該子目錄名稱自動成為一個標籤
3. **檔名隱式標籤**：篇章的檔名（去除 `.md` 副檔名後）經正規化處理，若結果非空則自動成為一個標籤

例如：位於 `_lore/characters/hero.md` 的篇章，frontmatter 為 `tags: [protagonist]`，其有效標籤為 `[protagonist, characters, hero]`。

檔名隱式標籤的額外規則：純 CJK 字元的檔名正規化後為空字串，不會產生標籤。保留名稱（`all`、`tags`）同樣不會產生標籤。

### 標籤正規化

標籤在產生模板變數名稱時會經過正規化處理，依序執行三項轉換：先將所有字元轉為小寫，接著將連字號（`-`）和空格轉為底線（`_`），最後移除非英數字和底線的字元。

以 `My Characters` 為例，正規化後為 `my_characters`；`world-building` 則成為 `world_building`。

### 保留標籤名稱

以下名稱為保留字，不得作為標籤使用：

- `all` — 已用於 `{{ lore_all }}`
- `tags` — 已用於 `{{ lore_tags }}`

## 模板變數

典籍系統在渲染提示詞時自動產生以下模板變數：

| 變數 | 型別 | 說明 |
|------|------|------|
| `{{ lore_all }}` | `string` | 所有啟用篇章的內容，依 priority 降冪排列後串接 |
| `{{ lore_<tag> }}` | `string` | 具有該有效標籤的啟用篇章，依 priority 降冪排列後串接 |
| `{{ lore_tags }}` | `string[]` | 所有已發現的標籤名稱陣列 |

### 行為細節

篇章依 priority 降冪排序，同 priority 則依檔名字母順序排列。多個篇章串接時以 `\n\n---\n\n` 作為分隔符。

標籤名稱經正規化後用於變數名稱，例如標籤 `world-building` 對應變數 `{{ lore_world_building }}`。若某個標籤未匹配到任何篇章，其變數值為空字串而非 undefined，因此可在模板中安全引用。

停用的篇章（`enabled: false`）不會出現在任何變數的內容中，但其標籤仍會被發現並產生對應的空變數。

### 使用範例

在 `system.md` 模板中引用：

```vento
{{ lore_scenario }}

{{ if lore_characters }}
<characters>
{{ lore_characters }}
</characters>
{{ /if }}
```

## API 參考

所有 API 端點皆需通過認證（`X-Passphrase` header 或 WebSocket 認證）。

### 端點一覽

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

### 查詢參數

列表端點（GET scope）支援 `?tag=` 參數，以有效標籤過濾結果：

```
GET /api/lore/global?tag=characters
```

### GET 列表回應格式

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

### GET 單一篇章回應格式

```json
{
  "frontmatter": { "tags": ["protagonist"], "priority": 100, "enabled": true },
  "content": "Markdown 內容"
}
```

### PUT 請求主體格式

```json
{
  "frontmatter": { "tags": ["tag1"], "priority": 0, "enabled": true },
  "content": "Markdown 內容"
}
```

建立新篇章回傳 `201`，更新現有篇章回傳 `200`。刪除篇章回傳 `204`（無回應內容）。路徑中的 `*path` 必須以 `.md` 結尾。

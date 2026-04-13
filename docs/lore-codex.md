# 典籍系統（Lore Codex）

典籍系統是以檔案為基礎的世界觀知識庫，取代舊有的 `scenario.md` 做法。靈感來自 SillyTavern 的 World Info，但專為檔案工作流程設計——每一則知識以 Markdown 篇章（passage）的形式存放，透過標籤（tag）分類，最終注入為 Vento 模板變數供系統提示詞使用。

## 目錄結構

典籍資料存放在 `playground/lore/` 下，分為三個作用域（scope）：

```
playground/lore/
├── global/               # 全域篇章 — 套用於所有故事
│   ├── world-rules.md
│   └── characters/       # 子目錄即為隱式標籤
│       ├── hero.md
│       └── villain.md
├── series/
│   └── <series>/         # 系列篇章 — 套用於該系列下所有故事
│       └── scenario.md
└── story/
    └── <series>/
        └── <story>/      # 故事篇章 — 僅套用於特定故事
            └── chapter-context.md
```

| 作用域 | 目錄 | 套用範圍 |
|--------|------|---------|
| global | `playground/lore/global/` | 所有故事 |
| series | `playground/lore/series/<series>/` | 同一系列下的所有故事 |
| story | `playground/lore/story/<series>/<story>/` | 特定故事 |

各作用域目錄下可建立子目錄，子目錄名稱會自動成為該目錄內所有篇章的隱式標籤（directory-as-tag）。子目錄僅支援一層深度。

## 篇章格式

每個篇章是一個 `.md` 檔案，包含 YAML frontmatter 與 Markdown 內容：

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
| `priority` | `number` | `0` | 排序權重：數字越大越先出現 |
| `enabled` | `boolean` | `true` | 設為 `false` 可排除此篇章，不注入提示詞 |

Frontmatter 為選填。若省略，篇章將以預設值（無標籤、priority 0、啟用）載入。

## 標籤系統

### 有效標籤

每個篇章的有效標籤（effective tags）由兩個來源聯集而成：

1. **Frontmatter 標籤**：`tags` 欄位中宣告的標籤
2. **目錄隱式標籤**：若篇章位於子目錄中，該子目錄名稱自動成為一個標籤

例如：位於 `global/characters/hero.md` 的篇章，frontmatter 為 `tags: [protagonist]`，其有效標籤為 `[protagonist, characters]`。

### 標籤正規化

標籤在產生模板變數名稱時會經過正規化處理：

- 轉為小寫
- 連字號（`-`）和空格（` `）轉為底線（`_`）
- 移除非英數字和底線的字元

例如：`My Characters` → `my_characters`、`world-building` → `world_building`。

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

- 篇章依 priority 降冪排序；同 priority 則依檔名字母順序排列
- 多個篇章以 `\n\n---\n\n` 分隔符串接
- 標籤名稱經正規化後用於變數名稱（如標籤 `world-building` → 變數 `{{ lore_world_building }}`）
- 未匹配到任何篇章的標籤變數為空字串（非 undefined），可安全在模板中引用
- 停用的篇章（`enabled: false`）不會出現在任何變數的內容中，但其標籤仍會被發現並建立空變數

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
GET /api/lore/global?tag=character
```

### GET 列表回應格式

```json
[
  {
    "filename": "hero.md",
    "directory": "global/characters",
    "tags": ["protagonist", "characters"],
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

建立新篇章回傳 `201`，更新現有篇章回傳 `200`。路徑中的 `*path` 必須以 `.md` 結尾。

## 從 scenario.md 遷移

### 變更摘要

| 項目 | 舊方式 | 新方式 |
|------|--------|--------|
| 檔案位置 | `playground/<series>/scenario.md` | `playground/lore/series/<series>/scenario.md` |
| 模板變數 | `{{ scenario }}` | `{{ lore_scenario }}` |

### 遷移步驟

1. **執行遷移腳本**：

   ```bash
   deno run --allow-read --allow-write scripts/migrate-scenario.ts
   ```

   腳本會掃描 `playground/` 下所有系列目錄，將找到的 `scenario.md` 複製到 `playground/lore/series/<series>/scenario.md`，並自動添加 frontmatter：

   ```yaml
   ---
   tags: [scenario]
   priority: 1000
   enabled: true
   ---
   ```

   若目標檔案已存在則跳過。可選擇性傳入 playground 目錄路徑：

   ```bash
   deno run --allow-read --allow-write scripts/migrate-scenario.ts /path/to/playground
   ```

2. **更新提示詞模板**：將 `system.md` 中的 `{{ scenario }}` 替換為 `{{ lore_scenario }}`

3. **驗證**：啟動伺服器並使用提示詞預覽功能確認變數正確注入

> ⚠️ **Breaking change**：`{{ scenario }}` 核心變數已不再存在。遷移後必須改用 `{{ lore_scenario }}`。

[plugin-system]: ./plugin-system.md
[prompt-template]: ./prompt-template.md

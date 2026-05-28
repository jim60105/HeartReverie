# 典籍系統 Lore Codex

典籍系統是以檔案為基礎的世界觀知識庫，取代舊有的 `scenario.md` 做法。設計靈感來自 SillyTavern 的 World Info，採用檔案優先的工作流程，每一則知識以 Markdown 篇章（passage）形式存放，透過標籤（tag）分類，最終注入為 Vento 模板變數供 `system.md` 引用。

進入「設定 → 典籍」可看到以全域／系列／故事三層篩選的篇章瀏覽介面，左側列出所有設定頁入口、中央為篇章列表（依範圍切換）、右側為編輯區。

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
| series | `playground/<series>/_lore/` | 同一系列下所有故事 |
| story | `playground/<series>/<story>/_lore/` | 特定故事 |

各作用域目錄下可建立一層子目錄，子目錄名稱會自動成為該目錄內所有篇章的隱式標籤（directory-as-tag）。

### 底線前綴保留規則

以底線（`_`）開頭的目錄名稱為系統保留名稱，不會被列為系列或故事。`_lore/` 即屬於此類保留目錄；故事列表 API 與典籍標籤掃描皆會自動排除底線前綴目錄。

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

| 欄位 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| `tags` | `string[]` | `[]` | 分類標籤 |
| `priority` | `number` | `0` | 排序權重，數字越大越先出現 |
| `enabled` | `boolean` | `true` | 設為 `false` 可排除此篇章，不注入提示詞 |

Frontmatter 為選填。若省略，篇章以預設值載入（無標籤、priority 0、啟用）。

## 標籤系統

### 有效標籤

每個篇章的有效標籤（effective tags）由三個來源聯集而成：

1. **Frontmatter 標籤**：`tags` 欄位中宣告的標籤。
2. **目錄隱式標籤**：篇章所在子目錄名稱。
3. **檔名隱式標籤**：檔名（去除 `.md` 副檔名後）正規化結果。

例如：`_lore/characters/hero.md` 篇章，frontmatter 為 `tags: [protagonist]`，有效標籤為 `[protagonist, characters, hero]`。

檔名隱式標籤的額外規則：純 CJK 字元的檔名正規化後為空字串，不會產生標籤。保留名稱（`all`、`tags`）同樣不會產生標籤。

### 標籤正規化

標籤在產生模板變數名稱時會經過三項轉換：(1) 全部轉小寫；(2) 連字號（`-`）與空格轉為底線（`_`）；(3) 移除非英數字與底線字元。例：`My Characters` → `my_characters`、`world-building` → `world_building`。

### 保留標籤名稱

下列名稱為保留字，不得作為標籤：

- `all` — 已用於 `{{ lore_all }}`。
- `tags` — 已用於 `{{ lore_tags }}`。

## 模板變數

| 變數 | 型別 | 說明 |
|------|------|------|
| `{{ lore_all }}` | `string` | 所有啟用篇章內容，依 priority 降冪串接 |
| `{{ lore_<tag> }}` | `string` | 帶有該有效標籤的啟用篇章，依 priority 降冪串接 |
| `{{ lore_tags }}` | `string[]` | 所有已發現的標籤名稱陣列 |

### 行為細節

篇章依 priority 降冪排序，同 priority 則依檔名字母順序排列。多篇串接以 `\n\n---\n\n` 為分隔符。停用篇章（`enabled: false`）不會出現在內容中，但其標籤仍會被發現並產生對應的空字串變數，因此模板可安全引用。

### 使用範例

在 `system.md` 中：

```vento
{{ lore_scenario }}

{{ if lore_characters }}
<characters>
{{ lore_characters }}
</characters>
{{ /if }}
```

典籍篇章本身的 Vento 渲染細節（第一輪快照、循環參照、錯誤回退）請參考[作者 → Prompt 模板][prompt-template] 的「典籍 Vento 渲染」段落。

## API 端點

API 端點細節請見 [reference/api 的典籍 Lore 段落](../reference/api.md#典籍-lore)。

[prompt-template]: prompt-template.md

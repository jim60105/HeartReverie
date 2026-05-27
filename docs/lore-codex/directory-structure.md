# 目錄結構

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

## 底線前綴保留規則

以底線（`_`）開頭的目錄名稱為系統保留名稱，不會被列為系列或故事。`_lore/` 即屬於此類保留目錄。故事列表 API 和典籍標籤掃描皆會自動排除底線前綴的目錄。

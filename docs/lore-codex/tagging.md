# 標籤系統

## 有效標籤

每個篇章的有效標籤（effective tags）由三個來源聯集而成：

1. **Frontmatter 標籤**：`tags` 欄位中宣告的標籤
2. **目錄隱式標籤**：若篇章位於子目錄中，該子目錄名稱自動成為一個標籤
3. **檔名隱式標籤**：篇章的檔名（去除 `.md` 副檔名後）經正規化處理，若結果非空則自動成為一個標籤

例如：位於 `_lore/characters/hero.md` 的篇章，frontmatter 為 `tags: [protagonist]`，其有效標籤為 `[protagonist, characters, hero]`。

檔名隱式標籤的額外規則：純 CJK 字元的檔名正規化後為空字串，不會產生標籤。保留名稱（`all`、`tags`）同樣不會產生標籤。

## 標籤正規化

標籤在產生模板變數名稱時會經過正規化處理，依序執行三項轉換：先將所有字元轉為小寫，接著將連字號（`-`）和空格轉為底線（`_`），最後移除非英數字和底線的字元。

以 `My Characters` 為例，正規化後為 `my_characters`；`world-building` 則成為 `world_building`。

## 保留標籤名稱

以下名稱為保留字，不得作為標籤使用：

- `all` — 已用於 `{{ lore_all }}`
- `tags` — 已用於 `{{ lore_tags }}`

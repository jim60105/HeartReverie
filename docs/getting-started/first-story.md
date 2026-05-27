# 建立第一個故事

啟動服務後，前往 `http://localhost:8080`，先輸入 `PASSPHRASE` 通關密語。接著就可以建立你的第一個系列與故事，動手寫一段開頭，把劇情交給 AI 接續。

## 故事資料的擺放方式

故事資料儲存在 `playground/` 目錄底下，採用「系列 → 故事 → 章節」三層結構：

```
playground/
├── <系列>/
│   └── <故事>/
│       ├── 01.md
│       ├── 02.md
│       └── _lore/      # 故事範圍的典籍篇章
```

每個章節是一個 `.md` 檔案，依照章節編號命名。系列與故事的目錄名稱就是它們在前端的顯示名稱。

## 用「快速新增」工具一鍵建立

最便利的方式是用頁首🧰圖示打開的工具選單，選擇「快速新增」（路由 `/tools/new-series`）。這個表單可以一次建立新系列／故事，並可選擇性同步建立角色 lore 檔與世界篇章 lore 檔。

如果你想把 SillyTavern 角色卡帶過來，可以改用「ST 角色卡轉換工具」（路由 `/tools/import-character-card`）解析 V2/V3 PNG 角色卡，把欄位轉為可編輯表單後寫入故事的 `_lore/` 範圍。詳見[使用指南 → Tools 選單](/guides/tools-menu.md)。

## 開始閱讀／撰寫

故事建立後，回到首頁選擇剛建立的系列與故事，就能進入 Reader UI 開始閱讀；左下角的鉛筆圖示可切換到 Writer UI 編輯章節檔案。Reader UI 的操作細節請見[使用指南 → Reader UI](/guides/reader-ui.md)，Writer UI 請見 [Writer UI](/guides/writer-ui.md)。

## 1. 目錄與規範文件

- [x] 1.1 建立 `HeartReverie/docs/assets/screenshots/` 子目錄；目錄用途與配方參照集中說明於 `docs/contributing/screenshot-recipes.md`，目錄本身不放 `README.md` 以符合 `find -type f -not -name '*.png'` 應為空的規格
- [x] 1.2 撰寫 `HeartReverie/docs/contributing/screenshot-recipes.md`，涵蓋：配方欄位（必填／選填、語意、`schema: v1` 範例、`steps` 動詞集合、CSS selector quoting 規則）、檔名 kebab-case 規則、PNG/WebP 使用時機與寬度上限、替代文字守則（≤ 30 字、中文敘述、禁用「截圖／畫面／圖片」結尾，提供至少三組好範例與三組反例）、無障礙建議（截圖必須有周邊散文／caption）、SFW 故事限制與 `url` allow-list、`scripts/podman-build-run.sh` 啟動程序、`agent-browser` 使用提示與字型一致性建議
- [x] 1.3 在 `HeartReverie/docs/_sidebar.md` 新增「貢獻者文件」獨立區段並加入 `[截圖配方](contributing/screenshot-recipes.md)` 連結；SHALL NOT 把此頁放在「使用指南」之下，因該頁是寫給貢獻者用的擷取規範，非面向終端使用者

## 2. 容器啟動與環境準備

- [x] 2.1 以 `scripts/podman-build-run.sh` 啟動容器，確認 `http://localhost:8080/悠奈悠花姊妹大冒險/放學後/` 可載入（容器已由協作 agent 啟動，本任務僅做連線驗證）
- [x] 2.2 透過 UI 或 `set_local_storage` 清除最近開啟故事紀錄，使任何側邊欄／首頁畫面僅顯示「悠奈悠花姊妹大冒險／放學後」
- [x] 2.3 紀錄擷取當下的 git SHA，作為所有配方 `app_commit` 欄位的值（`4534325`，`captured_at` 統一為 `2026-05-28`）

## 3. Reader、Writer、Tools 截圖與嵌入

每個項目須一次完成：撰寫配方註解、擷取 PNG 並放入 `docs/assets/screenshots/`、寫入 Markdown 圖片連結與中文 alt、補上散文／caption。

- [x] 3.1 `guides/reader-ui.md`：`reader-home.png`、`reader-chapter-view.png`
- [x] 3.2 `guides/writer-ui.md`：`writer-editor.png`、`writer-generate-flow.png`、`writer-action-buttons.png`
- [x] 3.3 `guides/tools-menu.md`：`tools-menu.png`、`tools-new-series.png`、`tools-import-character-card.png`

## 4. Template Editor 與 Plugin 系統截圖

- [x] 4.1 `guides/template-editor.md` 與 `prompt-template/template-editor.md`：`template-editor-overview.png`
- [x] 4.2 `plugin-system/settings.md`：`plugin-settings-list.png`、`plugin-settings-detail.png`
- [x] 4.3 `plugin-system/hook-inspector.md`：`hook-inspector.png`
- [x] 4.4 `plugin-system/action-buttons.md`：`plugin-action-buttons.png`
- [x] 4.5 `plugin-system/builtin-catalog.md`：`plugin-dialogue-colorize.png`、`plugin-reading-progress.png`

## 5. 三主題截圖

- [x] 5.1 `getting-started/configuration.md`：以同一故事頁、同一 viewport 擷取 `theme-default.png`、`theme-light.png`、`theme-dark.png`；三段配方除 `theme` 與 `output` 外完全相同

## 6. 品質檢查

- [x] 6.1 對所有新增 alt 文字逐一驗證：非空、≤ 30 字、不以「截圖／畫面／圖片」結尾
- [x] 6.2 對每張截圖確認周邊 5 行之內有散文或 `>` caption
- [x] 6.3 確認 `docs/assets/screenshots/` 下所有檔案皆為 PNG 且寬度 ≤ 2048px
- [x] 6.4 確認所有配方 `captured_at`、`app_commit` 欄位皆已填值，無 `TBD`
- [x] 6.5 在 `docs/contributing/screenshot-recipes.md` 寫入「修改相關 UI 元件時須重跑對應截圖配方」的工作流提醒

## 7. 圖文對應稽核與致歉散文清理

- [x] 7.1 對每張 PNG 與其引用頁的散文、alt、`<!-- screenshot-recipe -->` 註解三方比對；發現不符時，依「重新擷取」或「改寫散文／alt」二擇一處理，並於本提案紀錄處理方式
- [x] 7.2 刪除 `docs/` 下（排除 `docs/contributing/`）所有「為何此頁無截圖／此頁暫無截圖／screenshot-skip-rationale」之類的可見散文、標題與 HTML 註解；本提案的延伸規格將此列為硬性約束
- [x] 7.3 將原本放在「使用指南」下的 `guides/screenshot-recipes.md` 搬遷至 `docs/contributing/screenshot-recipes.md`，並同步更新 `docs/_sidebar.md` 與所有交叉連結

## 8. 驗證

- [x] 8.1 `openspec validate "enrich-docs-with-screenshots" --strict` 通過
- [x] 8.2 `npx docsify-cli serve docs` 本機預覽，逐頁確認圖片可載入、alt 文字顯示正確、無破圖
- [x] 8.3 執行 `grep -REn '^\s*url:\s*http://localhost:8080/' HeartReverie/docs/`，每筆 URL 皆需符合 allow-list 前綴
- [x] 8.4 執行 `find HeartReverie/docs/assets/screenshots -type f -not -name '*.png'` 應為空
- [x] 8.5 執行 `grep -rn "screenshot-skip-rationale\|為何此頁無截圖\|此頁暫無截圖\|無截圖" HeartReverie/docs/ | grep -v "^HeartReverie/docs/contributing/"`，輸出 SHALL 為空

## 9. 跨倉庫指南對齊（本回合追加）

- [x] 9.1 與 `HeartReverie_Plugins/docs/contributing/screenshot-recipes.md` 對齊共通段落（檔名規則、PNG 壓縮三步驟管線、無障礙與隨圖散文、`agent-browser` 使用提示、字型一致性、修改 UI 元件工作流、alt 撰寫共通原則），確保兩本指南在 repo-specific 段落以外措辭一致；本倉庫保留 9 必填欄位、`steps` 完整動詞集、CSS selector quoting、4 類 SFW allow-list、不含 `PLUGIN_DIR` 的容器啟動指令
- [x] 9.2 本指南成為通用內容的唯一規範本；新增一段「外掛延伸欄位指引」指向 `HeartReverie_Plugins` 的截圖配方頁，讓外掛作者一眼分清通用內容讀本頁、外掛延伸讀 HRP 頁，並沿用 docsify 絕對 URL 因兩站獨立部署

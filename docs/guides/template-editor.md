# Template Editor

`/settings/template-editor` 是瀏覽器內的 Vento 模板 lint／preview／編輯工具，可即時驗證 `system.md`、plugin `promptFragments`（唯讀）與三層典籍篇章。

CodeMirror 6 編輯器附 Vento 自動完成，並提供三種 preview fixture mode（`default`、`inline`、`current`）。寫入採 atomic write + `.bak` 備份。

完整說明見 [Prompt 模板 → Template Editor](/prompt-template/template-editor.md)。

頁面採三欄佈局：左側為設定選單與檔案樹，中央為 CodeMirror 編輯器，右側為 preview。

<!-- screenshot-recipe
schema: v1
url: http://localhost:8080/settings/template-editor
viewport: 1440x900
theme: default
preconditions:
  - 容器已啟動於 localhost:8080
  - 已通過 PASSPHRASE 登入
steps:
  - wait_for: 'nav'
capture: viewport
output: docs/assets/screenshots/template-editor-overview.png
captured_at: 2026-05-28
app_commit: 4534325
-->
![Template Editor 三欄佈局與檔案樹的初始狀態](../assets/screenshots/template-editor-overview.png)

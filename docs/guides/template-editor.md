# Template Editor

`/settings/template-editor` 是瀏覽器內的 Vento 模板 lint／preview／編輯工具，可即時驗證 `system.md`、plugin `promptFragments`（唯讀）與三層典籍篇章。

CodeMirror 6 編輯器附 Vento 自動完成，並提供三種 preview fixture mode（`default`、`inline`、`current`）。寫入採 atomic write + `.bak` 備份。

完整說明見 [Prompt 模板 → Template Editor](/prompt-template/template-editor.md)。

# HeartReverie 浮心夜夢 文件

HeartReverie 浮心夜夢是一套 AI 互動小說引擎，把「讀小說」與「寫小說」綁在一起。你輸入幾句話來引導劇情走向，AI 接著把故事寫進章節檔案，你再像翻書一樣繼續往下讀。

故事、提示詞、典籍系統全部以 `.md` 檔案儲存，可以用 VSCode 等熟悉的編輯器直接編輯、用 Git 做版本控制。客製化全部走外掛系統。技術棧上，前端使用 Vue 3、後端使用 Hono，串接任何 OpenAI 相容的 LLM API，將回應逐字寫入章節檔案。

## 本站內容

這份文件站把原本散落在 `docs/` 目錄裡的長篇 Markdown 拆成可導覽的小頁面，依下列八個區段組織：

- **首頁** — 你正在看的這一頁。
- **開始使用** — 安裝、設定與第一個故事的建立步驟。
- **使用指南** — Reader UI、Writer UI、Tools 選單與 Template Editor 的操作說明。
- **Plugin 系統** — 外掛架構、manifest 規格、Hook 生命週期、撰寫指南與內建目錄。
- **Prompt 模板** — Vento 模板語法、變數注入、建構流程與 UI 編輯。
- **典籍系統（Lore Codex）** — 檔案式世界觀知識庫的目錄結構、標籤與 API。
- **部署** — Helm chart 安裝與 CI 跨儲存庫觸發。
- **遷移指南** — 重大變更的升級紀錄。

## → 開始使用

第一次接觸 HeartReverie？建議從[安裝](getting-started/installation.md)開始，依序閱讀[設定](getting-started/configuration.md)與[建立第一個故事](getting-started/first-story.md)。

如果你想了解外掛能做什麼，請前往 [Plugin 系統概覽](plugin-system/overview.md)；想知道 Vento 模板能注入哪些變數，請前往 [Prompt 模板概覽](prompt-template/overview.md)。

# HeartReverie 浮心夜夢 文件

HeartReverie 浮心夜夢是一套 AI 互動小說引擎，把「讀小說」與「寫小說」綁在一起。你輸入幾句話來引導劇情走向，AI 接著把故事寫進章節檔案，你再像翻書一樣繼續往下讀。

故事、提示詞、典籍系統全部以 `.md` 檔案儲存，可以用 VSCode 等熟悉的編輯器直接編輯、用 Git 做版本控制。客製化全部走外掛系統。技術棧上，前端使用 Vue 3、後端使用 Hono，串接任何 OpenAI 相容的 LLM API，將回應逐字寫入章節檔案。

## 本站內容

文件站以讀者身份分為六區，請依需求進入：

- **[入門][overview]**： 總覽、快速部署 quick-start、基本設定。
- **[自架站][self-host]**： 安裝、環境變數、外接 LLM、備份、Helm。
- **[作者][author]**： Reader/Writer UI、Tools、Prompt 模板、典籍系統、內建外掛、外掛設定。
- **[外掛開發者][plugin-dev]**： 外掛架構、manifest、hook、前端註冊、Settings、自訂 API、Agent Skill 引導。
- **[參考][reference]**： API 端點、設定字典。
- **[貢獻者][contributing]**：貢獻流程、CLI 腳本、截圖配方、跨儲存庫觸發。

## → 開始使用

第一次接觸 HeartReverie？建議從[開始使用][overview]讀起，再依序進入[快速部署][first-deploy]與[設定][configuration]。

想了解外掛能做什麼，請前往[外掛開發者總覽][plugin-dev]；想知道 Vento 模板能注入哪些變數，請前往[作者 → Prompt 模板][prompt-template]。

[overview]: getting-started/overview.md
[first-deploy]: getting-started/first-deploy.md
[configuration]: getting-started/configuration.md
[self-host]: self-host/installation.md
[author]: author/reader-ui.md
[plugin-dev]: plugin-dev/overview.md
[reference]: reference/api.md
[contributing]: contributing/overview.md
[prompt-template]: author/prompt-template.md

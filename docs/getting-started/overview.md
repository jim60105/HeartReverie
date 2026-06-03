# 入門總覽

[HeartReverie 浮心夜夢][project] HeartReverie 浮心夜夢 是一套 AI 互動小說引擎，把「讀小說」與「寫小說」綁在一起。你輸入幾句話來引導劇情走向，AI 接著把故事寫進章節檔案，讓你像翻書一樣繼續往下讀。

## 設計哲學

HeartReverie 採取 RPG 隨興式冒險敘事取向設計。

與 SillyTavern 以「對話」為核心的設計不同，HeartReverie 的主軸是「發展故事」，你的輸入只作為引導，並不會直接寫進章節內容。

故事、提示詞、典籍系統全部以 `.md` 檔案儲存，可以用 VSCode、NeoVim 等任何編輯器直接編輯、用 Git 做版本控制。提示詞骨架是一份 Vento 模板 `system.md`，典籍、外掛能注入提示記片段作為模板變數。

本專案有外掛系統設計，開發者們能自己動手擴充功能。並附有 Agent Skill，便於引導 AI 代理協助實作完整程式碼開發。

技術堆疊的部份，前端使用 Vue 3、後端使用 Hono，串接任何 OpenAI 相容的 LLM API，將回應逐字串流寫入章節檔案。

## 接下來該讀什麼

- 第一次部署請從[快速部署][first-deploy]開始，七步完成「從零開始至寫下第一章」。
- 已經運行起來、想調整環境變數或主題的讀者請看[設定][configuration]。
- 想查閱完整設定檔環境變數字典的讀者請參閱[設定字典][reference-config]。

[project]: https://github.com/jim60105/HeartReverie
[first-deploy]: first-deploy.md
[configuration]: configuration.md
[reference-config]: ../reference/configuration.md

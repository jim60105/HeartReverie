# 入門總覽

[HeartReverie 浮心夜夢][project] 把「閱讀」與「撰寫」兩種互動小說模式綁在同一個檔案式工作流程裡。故事章節、提示詞模板、典籍篇章全部以 `.md` 檔案存放，後端以 Hono 服務轉發任何 OpenAI 相容 API 的回應，再由前端 Vue 3 SPA 將內容寫進章節檔案。

## 設計哲學

HeartReverie 採取 RPG 隨興式冒險的敘事取向，玩家輸入的訊息只作為引導而不會被當成劇情寫入章節，AI 的回覆才會落筆。Vento 模板把脈絡、外掛片段與典籍變數組裝成單一 prompt，再以串流方式寫入下一個章節檔案，閱讀流程因而像翻書一樣推進。

## 接下來該讀什麼

- 第一次部署請從[快速部署][first-deploy]開始，七步完成「拉鏡像 → 寫第一章」。
- 已經跑起來、想調整環境變數或主題的讀者請看[設定][configuration]。
- 想看完整服務環境變數字典的讀者請看[參考 → 設定字典][reference-config]。

[project]: https://github.com/jim60105/HeartReverie
[first-deploy]: first-deploy.md
[configuration]: configuration.md
[reference-config]: ../reference/configuration.md

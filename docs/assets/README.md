# Docs Assets

這個目錄裡的檔案是從 `../../assets/` 重複而來。`docsify-cli serve` 會把 `docs/` 當作網站根目錄，無法以 `..` 跳出；GitHub Pages 部署同樣以 `docs/` 為製品根目錄。把資源共置於此可以讓兩種模式都解析得到。

# MD Story Reader

以瀏覽器閱讀多章節 Markdown 故事檔案，支援 [SillyTavern](https://github.com/SillyTavern/SillyTavern) AI 對話中產生的自訂 XML 區塊（`<status>`、`<options>`、`<UpdateVariable>`）。

純前端應用——不需要建置步驟、不使用框架、不需要後端伺服器。

## 功能特色

- 📂 透過 File System Access API 開啟本機故事資料夾
- 📖 逐章閱讀，支援鍵盤快捷鍵（← →）切換章節
- 🎭 角色狀態面板——顯示角色數值、服裝、特寫，於桌面版以側邊欄呈現
- 🎲 選項面板——可點擊的選擇按鈕，點擊後自動複製至剪貼簿
- 📝 變數更新區塊——可收合的原始資料檢視
- 💾 工作階段記憶——重新整理頁面後自動恢復上次開啟的資料夾
- 🌙 暗色主題搭配 CJK 最佳化字型排版

## 快速開始

```bash
cd reader
./serve.zsh          # https://localhost:8443
./serve.zsh 8080     # 自訂連接埠
```

> HTTPS 為必要條件——File System Access API 僅在安全環境（Secure Context）下運作。
> 開發伺服器會在首次執行時自動產生自簽 TLS 憑證。

開啟瀏覽器造訪上述網址，點擊「**選擇資料夾**」，選取包含編號 `.md` 檔案的資料夾（例如 `001.md`、`002.md`）即可開始閱讀。

## 專案結構

```
reader/              網頁閱讀器應用程式
  index.html           入口頁面（所有 CSS 內嵌）
  js/                  ES 模組（6 個檔案）
  serve.zsh            HTTPS 開發伺服器（zsh + Node.js）
openspec/            規格說明與變更歷史
regex.json           SillyTavern 正則表達式腳本
short-template/      故事範本章節
```

## 瀏覽器支援

本應用依賴 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)，僅支援 Chromium 系列瀏覽器：

| 瀏覽器 | 支援狀態 | 最低版本 |
|--------|---------|---------|
| Chrome | ✅ 支援 | 86+ |
| Edge | ✅ 支援 | 86+ |
| Opera | ✅ 支援 | 72+ |
| Firefox | ❌ 不支援 | — |
| Safari | ❌ 不支援 | — |

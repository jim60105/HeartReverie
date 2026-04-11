# MD Story Tools

搭配 [SillyTavern](https://github.com/SillyTavern/SillyTavern) AI 角色扮演的故事工具集——包含網頁閱讀器與狀態補丁處理器。

| 工具 | 說明 | 技術 |
|------|------|------|
| **[reader/](reader/)** | 瀏覽器多章節 Markdown 故事閱讀器 | 純前端（HTML / JS） |
| **[plugins/apply-patches/rust/](plugins/apply-patches/rust/)** | 從章節檔案擷取 `<JSONPatch>` 並套用至角色狀態 | Rust CLI |

---

## Reader — 網頁閱讀器

以瀏覽器閱讀多章節 Markdown 故事檔案，支援 SillyTavern AI 對話中產生的自訂 XML 區塊（`<status>`、`<options>`、`<UpdateVariable>`）。

純前端應用——不需要建置步驟、不使用框架、不需要後端伺服器。

### 功能特色

- 📂 透過 File System Access API 開啟本機故事資料夾
- 📖 逐章閱讀，支援鍵盤快捷鍵（← →）切換章節
- 🎭 角色狀態面板——顯示角色數值、服裝、特寫，於桌面版以側邊欄呈現
- 🎲 選項面板——可點擊的選擇按鈕，點擊後自動複製至剪貼簿
- 📝 變數更新區塊——可收合的原始資料檢視
- 💾 工作階段記憶——重新整理頁面後自動恢復上次開啟的資料夾
- 🌙 暗色主題搭配 CJK 最佳化字型排版

### 快速開始

```bash
cd reader
./serve.zsh          # https://localhost:8443
./serve.zsh 8080     # 自訂連接埠
```

> HTTPS 為必要條件——File System Access API 僅在安全環境（Secure Context）下運作。
> 開發伺服器會在首次執行時自動產生自簽 TLS 憑證。

開啟瀏覽器造訪上述網址，點擊「**選擇資料夾**」，選取包含編號 `.md` 檔案的資料夾（例如 `001.md`、`002.md`）即可開始閱讀。

### 瀏覽器支援

本應用依賴 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)，僅支援 Chromium 系列瀏覽器：

| 瀏覽器 | 支援狀態 | 最低版本 |
|--------|---------|---------|
| Chrome | ✅ 支援 | 86+ |
| Edge | ✅ 支援 | 86+ |
| Opera | ✅ 支援 | 72+ |
| Firefox | ❌ 不支援 | — |
| Safari | ❌ 不支援 | — |

---

## Apply-Patches — 狀態補丁處理器

Rust CLI 工具，掃描目錄中的 `init-status.yml` 與編號 `.md` 檔案，從章節內容擷取 `<JSONPatch>` 區塊並依序套用，產出最新的 `current-status.yml`。

### 支援的操作

| 操作 | 說明 |
|------|------|
| `replace` | 替換指定路徑的值 |
| `delta` | 對數值做加減運算 |
| `insert` | 在陣列或物件中插入新項目 |
| `remove` | 移除指定路徑的值 |

### 快速開始

需要 Rust 工具鏈（`cargo`）。

```bash
cd plugins/apply-patches/rust
cargo build --release
./target/release/apply-patches [root_dir]
```

工具會遞迴掃描 `root_dir` 下每個含有 `init-status.yml` 的子目錄，依檔名順序讀取 `.md` 檔案中的補丁，最終在該子目錄輸出 `current-status.yml`。

---

## 專案結構

```
reader/              網頁閱讀器應用程式
  index.html           入口頁面（所有 CSS 內嵌）
  js/                  ES 模組（6 個檔案）
  serve.zsh            HTTPS 開發伺服器（zsh + Node.js）
plugins/
  apply-patches/       狀態補丁處理器插件
    plugin.json          插件清單
    handler.js           後處理掛鉤：呼叫 Rust 二進位檔
    rust/                Rust CLI 實作
      src/               Rust 原始碼模組
      Cargo.toml         套件設定
tests/               測試檔案（鏡像原始碼結構）
  writer/              後端測試
  reader/js/           前端測試
openspec/            規格說明與變更歷史
regex.json           SillyTavern 正則表達式腳本
short-template/      故事範本章節
```

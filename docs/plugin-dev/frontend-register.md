# 前端模組註冊（frontend-render & 樣式）

本頁描述外掛前端模組從註冊到 DOM hook、再到 CSS 樣式注入的完整流程。

## 前端 Render 生命週期

前端外掛的 hook 註冊發生在 `usePlugins.initPlugins()`，需要先完成才能讓 `useMarkdownRenderer.renderChapter()` 對齊外掛的 `frontend-render` 與 `chapter:render:after` handler。為了避免「外掛尚未註冊就先渲染」的競態，閱讀器採用以下契約：

- **Readiness 雙旗標**：`usePlugins()` 暴露兩個 reactive ref：
  - `pluginsReady` — 僅在 `initPlugins()` 完整成功後才為 `true`，作為診斷與 sidebar relocation watch 的依賴。
  - `pluginsSettled` — `initPlugins()` 結束後（不論成功或失敗）為 `true`，用於閘控章節渲染。
  - 失敗時透過 `useNotification` 顯示警告 toast 並降級為「無外掛」渲染。
- **Idempotent 初始化**：`initPlugins()` 透過模組內的 in-flight `Promise<void>` 共享給並發呼叫，並 `await Promise.resolve(register(...))` 以支援非同步 `register()`。
- **Readiness gate**：`ContentArea.vue` 以 `v-if="pluginsSettled && currentContent"` 閘控 `<ChapterContent>`；settled 之前顯示「載入中…」placeholder。
- **Sidebar relocation 契約**：`ContentArea.vue` 的 `watch([currentContent, isLastChapter, pluginsReady, renderEpoch], …, { flush: "post" })`：
  1. 一律先清空 `<Sidebar>`，避免上一章 panel 殘留。
  2. 若尚未 renderable，停止後續處理。
  3. 否則把 `.plugin-sidebar` 元素從章節內容搬到 `<Sidebar>` 中。
- **Edit-save 不變式**：`useChapterNav` 暴露 `currentContent: ShallowRef<string>` 與 `renderEpoch: Ref<number>`，所有寫入都經由 `commitContent()`；位元組相同的覆寫也會呼叫 `triggerRef(currentContent)` 並遞增 `renderEpoch`，使下游 computed 與 watch 重新執行。
- **Render 鏈式自我修正**：`ChapterContent.vue` 的 `tokens` computed 讀取 `pluginsReady` 與 `renderEpoch`，作為 readiness gate 的後備。

## 前端樣式注入

外掛可透過 `frontendStyles` manifest 欄位宣告 CSS 樣式表，系統在前端初始化時自動注入 `<link rel="stylesheet">` 至 `<head>`。

### 宣告格式

```json
{
  "frontendStyles": ["./styles.css", "./components/panel.css"]
}
```

每個路徑的規則：

| 規則 | 說明 |
|------|------|
| 相對路徑 | 必須為相對路徑（不允許 `/` 開頭） |
| `.css` 副檔名 | 每個路徑必須以 `.css` 結尾 |
| 無路徑穿越 | 不允許 `..` 段（經 `isPathContained` 驗證） |
| 檔案存在 | 啟動時驗證檔案存在；不存在者記錄警告並跳過 |

系統載入時自動正規化路徑（去除 `./` 前綴、去除重複項目）。

### 注入行為

- CSS `<link>` 在前端 JS 模組 `import()` **之前**注入，讓元件渲染時樣式已可用。
- 注入位置在核心樣式表**之後**，外掛 CSS 自然覆蓋基礎樣式。
- 每個 `<link>` 帶有 `data-plugin="<name>"` 屬性，方便除錯。
- CSS 載入失敗時 `onerror` 處理器會靜默移除該 `<link>` 元素（優雅降級）。
- 相同 `href` 不會重複注入（冪等性保證）。

### 檔案配置慣例

```
my-plugin/
├── plugin.json
├── frontend.js
└── styles.css
```

### 串階順序（Cascade Order）

1. 核心應用樣式（Vite 打包的 `base.css`、`theme.css`）。
2. 外掛 CSS（依 `GET /api/plugins` 回傳順序注入）。

外掛 CSS 可引用核心 CSS 變數（如 `--text-main`、`--panel-bg`），因為注入時這些變數已定義在 `:root`。

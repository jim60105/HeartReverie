# 前端樣式注入

Plugin 可透過 `frontendStyles` manifest 欄位宣告 CSS 樣式表，系統會在前端初始化時自動注入 `<link rel="stylesheet">` 至 `<head>`。

## 宣告格式

```json
{
  "frontendStyles": ["./styles.css", "./components/panel.css"]
}
```

每個路徑項目的規則：

| 規則 | 說明 |
|------|------|
| 相對路徑 | 必須為相對路徑（不允許 `/` 開頭） |
| `.css` 副檔名 | 每個路徑必須以 `.css` 結尾 |
| 無路徑穿越 | 不允許 `..` 段（經 `isPathContained` 驗證） |
| 檔案存在 | 啟動時驗證檔案是否存在，不存在者記錄警告並跳過 |

系統在載入時會自動正規化路徑（去除 `./` 前綴、去除重複項目）。

## 注入行為

- CSS `<link>` 在前端 JS 模組 `import()` **之前**注入，讓元件渲染時樣式已可用
- 注入位置在核心樣式表**之後**（附加至 `<head>` 尾端），plugin CSS 自然覆蓋基礎樣式
- 每個 `<link>` 帶有 `data-plugin="<name>"` 屬性，方便除錯
- 若 CSS 載入失敗，`onerror` 處理器會靜默移除該 `<link>` 元素（優雅降級）
- 相同 `href` 不會重複注入（冪等性保證）

## 檔案配置慣例

建議將 plugin 專屬樣式與 `frontend.js` 放在同一目錄：

```
my-plugin/
├── plugin.json
├── frontend.js
└── styles.css
```

## 串階順序（Cascade Order）

1. 核心應用樣式（Vite 打包的 `base.css`、`theme.css`）
2. Plugin CSS（依 `GET /api/plugins` 回傳順序注入）

Plugin CSS 可引用核心 CSS 變數（如 `--text-main`、`--panel-bg`），因為注入時這些變數已定義在 `:root`。

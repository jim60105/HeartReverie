# dialogue-colorize

為章節中的對話引號區段著色。透過瀏覽器原生的 CSS Custom Highlight API 在不修改 DOM 與不替換引號字元的前提下繪製顏色，因此複製貼上、匯出、提示詞、磁碟內容皆與原稿完全一致。

## 運作原理

此外掛為純前端模組，註冊於 `chapter:dom:ready` 階段。每次 `ChapterContent.vue` 完成 v-html 提交後，模組會：

1. 走訪章節容器內的文字節點（跳過 `<code>`、`<pre>`、`<kbd>`、`<samp>` 子節點）。
2. 以六組支援的引號正規表達式蒐集候選區段，採「最左最長」原則去重疊。
3. 為每個保留的區段建立 `Range` 並加入對應的 `Highlight`，由 `::highlight(...)` CSS 規則上色。

每次重新派發時，先以 `WeakMap` 紀錄的舊 `Range` 從 `Highlight` 中移除，再加入新的，避免累積失效節點。

## 支援的引號配對

| 起 | 收 | Suffix | Highlight 名稱 |
|---|---|---|---|
| `"` (U+0022) | `"` (U+0022) | `straight` | `dialogue-quote-straight` |
| `“` (U+201C) | `”` (U+201D) | `curly` | `dialogue-quote-curly` |
| `«` (U+00AB) | `»` (U+00BB) | `guillemet` | `dialogue-quote-guillemet` |
| `「` (U+300C) | `」` (U+300D) | `corner` | `dialogue-quote-corner` |
| `｢` (U+FF62) | `｣` (U+FF63) | `corner-half` | `dialogue-quote-corner-half` |
| `《` (U+300A) | `》` (U+300B) | `book` | `dialogue-quote-book` |

未支援（後續版本再評估）：
- `„` （U+201E，無明確收尾字元）
- `『…』`（白方括號）
- 跨段落或跨 HTML 元素的對話

## 主題覆寫

預設色跟隨目前主題的 `--text-name` 變數（若無主題則回退為 `#ff8aaa`）。亦可透過 CSS 變數 `--dialogue-color` 在任意祖先元素覆寫：

```css
.chapter-content {
  --dialogue-color: #ffd54f;
}
```

## 瀏覽器需求

需要支援 CSS Custom Highlight API 的瀏覽器：Chrome 105+、Safari 17.2+、Firefox 140+。瀏覽器若未支援，外掛會於載入時記錄一筆 info 訊息並完全跳過註冊；章節仍可正常顯示，只是不上色。

## 檔案結構

```
plugins/dialogue-colorize/
├── plugin.json    # 外掛 manifest
├── frontend.js    # 前端模組（chapter:dom:ready 處理器）
├── styles.css     # ::highlight() CSS 規則
└── README.md
```

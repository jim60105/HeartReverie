# 文件站截圖規範（Screenshot Recipes）

本頁定義 HeartReverie 文件站「截圖配方」格式、檔名規則、替代文字守則，以及擷取截圖前需要準備的環境。每張嵌在文件中的截圖都會在 Markdown 圖片連結之上緊鄰一段 `<!-- screenshot-recipe ... -->` HTML 註解，紀錄重拍所需的全部資訊。

docsify 渲染時會忽略 HTML 註解，所以配方對讀者完全不可見，但仍與圖片同檔保存，避免「文件—配方—圖片」三者走散。配方內容以 YAML-like 縮排鍵值對撰寫，方便日後以 `grep` 搭配 `yaml.parse` 抽取批次重拍。

## 配方欄位

```html
<!-- screenshot-recipe
schema: v1
url: http://localhost:8080/悠奈悠花姊妹大冒險/放學後/
viewport: 1440x900
theme: default
preconditions:
  - 容器已啟動於 localhost:8080
  - 已通過通行密語登入
  - 已透過 set_local_storage 清除非 SFW 故事的最近紀錄
steps:
  - wait_for: '[data-test="chapter-body"]'
  - dismiss_modal: '.cookie-banner'
capture: viewport
output: docs/assets/screenshots/reader-chapter-view.png
captured_at: 2026-05-28
app_commit: 4534325
notes: 取自 SFW 故事第 1 章
-->
```

### 必填欄位

| 欄位 | 語意 |
| --- | --- |
| `schema` | 固定為 `v1`；未來欄位有不相容變動時遞增。 |
| `url` | 完整 URL，含 query 與 anchor。in-app 截圖固定以 `http://localhost:8080/` 為前綴。 |
| `viewport` | `寬x高`，比對正規式 `^\d{3,4}x\d{3,4}$`。桌面建議 `1440x900`，行動建議 `390x844`。 |
| `theme` | `default`、`light`、`dark` 三者之一。 |
| `preconditions` | 條列前置條件（容器啟動、登入、清除最近紀錄、切換主題、種入 localStorage 等）。 |
| `capture` | `viewport`、`full_page`、`selector:<CSS>` 三者之一。 |
| `output` | 圖檔路徑，限定在 `docs/assets/screenshots/` 之下，且與下方 `![alt](...)` 的路徑指向同一檔案。 |
| `captured_at` | ISO 8601 日期，例如 `2026-05-28`；不得為空、不得為 `TBD`。 |
| `app_commit` | 擷取當下 HeartReverie 主程式的 git commit SHA（短或長皆可）；不得為空、不得為 `TBD`。 |

### 選填欄位

| 欄位 | 語意 |
| --- | --- |
| `steps` | 條列互動步驟。若畫面只需載入 URL 即可呈現，可省略；其餘情境一律必填。 |
| `notes` | 自由文字註記（例如「需先開啟 Hook Inspector」）。 |

解析器看到未列出的欄位 SHALL 直接忽略，方便未來相容擴充。

### `steps` 動詞集合

`steps` 僅允許以下動詞，這也是 `agent-browser` 可直接消化的子集：

- `wait_for: <selector>`
- `click: <selector>`
- `scroll_to: <selector>`
- `type: { selector: <s>, text: <t> }`
- `dismiss_modal: <selector>`
- `hover: <selector>`
- `set_local_storage: { key: <k>, value: <v> }`
- `set_theme: <default | light | dark>`
- `set_passphrase: <env_var_name>`（值由執行環境注入，禁止寫死）

### CSS selector quoting 規則

`capture: selector:<CSS>` 或 step 中的 selector 若含 `:`、`#`、`[`、`]`、`,` 或空白字元，需以雙引號包覆，例如：

```yaml
capture: 'selector:[data-test="hook-inspector"]'
```

避免 YAML 解析時被誤拆。簡單 class 與 id（如 `.chapter`、`#sidebar`）可不加引號。

## 檔名規則

- 一律使用 kebab-case，以 UI 區域為前綴：`reader-`、`writer-`、`tools-`、`template-editor-`、`plugin-`、`lore-codex-`、`theme-`。
- 同一場景的多張變體只在後綴標明差異，例如 `theme-default.png`、`theme-light.png`、`theme-dark.png`。
- 若同一張圖在桌面與行動裝置需各擷一次，請以 `-desktop` / `-mobile` 後綴區分檔名，並讓兩段配方除 `viewport` 與 `output` 外完全相同。
- 避免日期或版本號入檔名；版本資訊由配方的 `captured_at` 與 `app_commit` 表示。

## 圖片格式與大小

- `docs/assets/screenshots/` 內一律 PNG，像素寬度 ≤ 2048。
- WebP 僅允許用於非 `screenshots/` 目錄的裝飾性圖片，例如封面 `docs/assets/heart.webp`。

### 壓縮流程

每次擷取或更新 PNG 後，請依下列順序壓縮，把每張 PNG 控制在 **≤ 500KB（軟目標）／≤ 1MB（硬性上限）**：

```bash
# 1. 先做無損最佳化（移除多餘 chunk、重排 filter）
oxipng -o 6 --strip safe docs/assets/screenshots/*.png

# 2. 若仍 >500KB，補一段有損量化（品質 80–95；遇到體積反而變大會跳過）
find docs/assets/screenshots -name '*.png' -size +500k \
  -exec pngquant --quality=80-95 --skip-if-larger --strip --force --ext .png {} +

# 3. 量化後再過一次 oxipng 把 IDAT 重壓
oxipng -o 6 --strip safe docs/assets/screenshots/*.png
```

壓縮完畢後肉眼快速檢視縮圖，比對字級、對話高亮、UI 邊框沒有可見破圖，顏色分布無明顯色帶。若 `writer-generate-flow.png` 之類的長截圖在管線跑完後仍超過 1MB，請改以 `capture: 'selector:<editor 容器>'` 重拍局部，而非保留 full_page 全頁圖，也不要靠調高 `--quality` 上限硬擠。

## 替代文字（alt）守則

替代文字寫在 Markdown 圖片連結的 `![]` 之中，要點如下：

- 以正體中文敘述「畫面內容」，非「畫面用途」。
- 長度 ≤ 30 字，半形與全形皆以 1 字元計。
- 不得為空、不得單獨等於「截圖」「畫面」「圖片」，也不得以這三個詞結尾。
- 不重複頁面標題或圖檔名；緊鄰的散文已提供脈絡。

### 好範例

- `Reader 章節閱讀面板，左側目錄、右側內文`
- `Writer 編輯模式，CodeMirror 顯示 Markdown 原始碼`
- `Template Editor 三欄佈局，檔案樹、編輯器與 preview`

### 反例

- `截圖`（純功能詞）
- `Reader UI 畫面`（以「畫面」結尾）
- `頁面圖片`（以「圖片」結尾）
- ` `（空白）

## 無障礙與隨圖散文

每張截圖周邊 5 行之內，須有非圖片、非配方註解的散文或 `>` 引言，說明該畫面對應的功能、狀態或操作意義。文件不得以截圖獨立替代散文敘述。

## SFW 故事來源限制

所有 in-app 截圖的配方 `url` 欄位都要以下列前綴之一開頭，否則不能用於文件：

1. 唯一許可的 SFW 故事章節頁（其 URL 形如 `http://localhost:8080/<series>/<story>/`，序列與故事 slug 對應儲存庫指定的 SFW 範例章節）
2. `http://localhost:8080/tools`、`http://localhost:8080/tools/new-series`、`http://localhost:8080/tools/import-character-card`
3. `http://localhost:8080/settings/`（含子路徑，如 `settings/template-editor`、`settings/plugins`）
4. `http://localhost:8080/`（首頁，僅在不顯示其他故事縮圖時）

畫面中側邊欄、最近開啟清單、章節下拉、列表縮圖等元素也不得出現上述許可 SFW 章節以外的故事或章節名稱。必要時於 `preconditions` 或 `steps` 中明文清除最近紀錄。

## 容器啟動程序

擷取截圖前請依下列程序啟動容器：

```bash
cd HeartReverie
scripts/podman-build-run.sh
```

服務啟動後於瀏覽器打開 `http://localhost:8080/`，輸入 `.env` 中的 `PASSPHRASE` 完成登入，再依配方導覽到目標 URL。`scripts/podman-build-run.sh` 會以正確的 Deno 權限旗標執行容器，缺少權限會在啟動期靜默失敗，請先檢查 `podman logs heartreverie` 確認無 `error`／`warn`。

## `agent-browser` 使用提示

文件站採用的 `agent-browser` CLI 已能執行 navigate、wait、click、fill、scroll 與 screenshot。常用模式：

```bash
agent-browser open <url>
agent-browser snapshot -i
agent-browser fill @e1 "$PASSPHRASE"
agent-browser click @e2
agent-browser wait --load networkidle
agent-browser set viewport 1440 900
agent-browser screenshot docs/assets/screenshots/<file>.png
```

- `set viewport 1440 900` 對應配方 `viewport: 1440x900`。行動截圖請改用 `set viewport 390 844`。
- 切換主題時建議用 `localStorage.setItem('heartReverie.themeId', '<default|light|dark>')` 再 reload，比拉下拉選單穩定。
- 截圖完畢請把 `localStorage` 與 cookie 還原到 default 主題，避免影響下一張截圖。

### 字型一致性

容器內字型固定，但若 `agent-browser` 在不同主機執行，CJK 字型 fallback 可能讓行寬出現細微差異。建議在固定主機或 CI 容器內重拍全套截圖，避免字型替換造成的 diff。

## 外掛延伸欄位指引

外掛儲存庫 `HeartReverie_Plugins` 額外定義 `status`、`surface`、`device_scale_factor`、`locale`、`plugin` 等欄位，並以 80 字上限的 alt 取代本頁的 30 字規則；外掛作者請改讀 [HeartReverie_Plugins 截圖配方指南][hrp-recipes]，本頁不再重述。

[hrp-recipes]: https://jim60105.github.io/HeartReverie_Plugins/#/contributing/screenshot-recipes "截圖配方（Screenshot Recipes）｜HeartReverie_Plugins"

## 修改 UI 元件時的工作流

修改任何 UI 元件後，請：

1. 找出引用該元件的截圖（`grep -REn 'assets/screenshots/' docs/`）。
2. 依配方重拍 `agent-browser` 流程，覆寫對應 PNG。
3. 更新配方註解的 `captured_at` 與 `app_commit`。
4. 在 PR 中說明哪些畫面被重新擷取。

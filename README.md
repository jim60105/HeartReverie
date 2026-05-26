# HeartReverie 浮心夜夢

[![codecov](https://codecov.io/gh/jim60105/HeartReverie/graph/badge.svg?token=1DJzsidNtp)](https://codecov.io/gh/jim60105/HeartReverie)
[![CI](https://github.com/jim60105/HeartReverie/actions/workflows/ci.yaml/badge.svg)](https://github.com/jim60105/HeartReverie/actions/workflows/ci.yaml)
[![GitHub release](https://img.shields.io/github/v/release/jim60105/HeartReverie)](https://github.com/jim60105/HeartReverie/releases)
[![License](https://img.shields.io/github/license/jim60105/HeartReverie)](./LICENSE)

<section align="center">
  <img src="assets/heart.webp"/>
</section>

HeartReverie 浮心夜夢 是一套 AI 互動小說引擎，把「讀小說」與「寫小說」綁在一起。你輸入幾句話來引導劇情走向，AI 接著把故事寫進章節檔案，你再像翻書一樣繼續往下讀。

與 [SillyTavern][sillytavern] 以「對話」為核心的設計不同，HeartReverie 的主軸是「發展故事」，你的輸入只作為引導，並不會直接寫進章節內容。

故事、提示詞、典籍系統全部以 `.md` 檔案儲存，可以用 VSCode 等熟悉的編輯器直接編輯、用 Git 做版本控制，適合喜歡掌控檔案的讀者與作者。客製化全部走外掛系統，搭配 [Agent Skill](#撰寫自訂外掛) 還能讓 AI 代理替你寫出整份外掛程式碼。

技術棧上，前端使用 [Vue 3][vue]、後端使用 [Hono][hono]，串接任何 OpenAI 相容的 LLM API，將回應逐字寫入章節檔案；提示詞骨架是一份 [Vento][vento] 模板 [`system.md`][system-md]，外掛可以注入 Markdown 片段作為模板變數。

## 🚀 快速開始

### 容器化部署

```bash
# 建立 .env（或複製 .env.example）
cat > .env << 'EOF'
LLM_API_KEY=your-api-key-here
PASSPHRASE=your-passphrase-here
EOF

podman run -d --name heartreverie \
  -p 8080:8080 \
  --env-file .env \
  -v ./playground:/app/playground:z \
  ghcr.io/jim60105/heartreverie:latest
```

預建置映像檔發佈於 GitHub Container Registry；如需從原始碼自行建置：

```bash
podman build -t heartreverie:latest .
```

建置完成後沿用上方的 `podman run` 指令，將映像檔名稱換成 `heartreverie:latest` 即可啟動本地映像。

### 本地部署

需要 [Deno][deno]。

```bash
# 建立 .env（或複製 .env.example）
cat > .env << 'EOF'
LLM_API_KEY=your-api-key-here
PASSPHRASE=your-passphrase-here
EOF

# 建置前端
deno install --lock=deno.lock
deno task build:reader

# 啟動
./scripts/serve.sh
```

伺服器預設跑在 `http://localhost:8080`，僅提供純 HTTP；若需要 TLS，請於上游反向代理或 Ingress controller 終結。

### 環境變數

| 變數 | 必要 | 預設值 | 說明 |
|------|:---:|--------|------|
| `LLM_API_KEY` | ✅ | — | LLM 提供者 API 金鑰 |
| `PASSPHRASE` | ✅ | — | 前端驗證用通關密語 |
| `PORT` | — | `8080` | 監聽埠號 |
| `LLM_MODEL` | — | `deepseek/deepseek-v4-pro` | LLM 模型 |
| `LLM_API_URL` | — | `https://openrouter.ai/api/v1/chat/completions` | LLM 聊天完成端點 |
| `LLM_TEMPERATURE` | — | `0.1` | 取樣溫度 |
| `LLM_FREQUENCY_PENALTY` | — | `0.13` | 頻率懲罰 |
| `LLM_PRESENCE_PENALTY` | — | `0.52` | 存在懲罰 |
| `LLM_TOP_K` | — | `10` | Top-K 取樣 |
| `LLM_TOP_P` | — | `0` | Top-P（nucleus）取樣 |
| `LLM_REPETITION_PENALTY` | — | `1.2` | 重複懲罰 |
| `LLM_MIN_P` | — | `0` | Min-P 取樣 |
| `LLM_TOP_A` | — | `1` | Top-A 取樣 |
| `LLM_MAX_COMPLETION_TOKENS` | — | （未設定 = 不限制） | 每次回應的 token 上限（傳給上游 `max_completion_tokens`）。留空表示不設應用層上限，由模型供應商決定；若要設定，必須為正整數 |
| `LLM_REASONING_ENABLED` | — | `true` | 是否在請求中附帶 `reasoning` 區塊 |
| `LLM_REASONING_EFFORT` | — | `xhigh` | `reasoning.effort` 等級（例如 `low`、`medium`、`high`、`xhigh`） |
| `LLM_REASONING_OMIT` | — | `false` | 設為 `true` 時完全省略 `reasoning` 區塊，適用於嚴格 OpenAI 相容後端 |
| `PLUGIN_DIR` | — | — | 外部外掛目錄（絕對路徑） |
| `PLAYGROUND_DIR` | — | `./playground` | 故事資料根目錄 |
| `READER_DIR` | — | `./reader-dist` | 前端靜態檔案根目錄 |
| `THEME_DIR` | — | `./themes/` | 主題檔案目錄 |
| `LOG_LEVEL` | — | `info` | 日誌等級：debug、info、warn、error |
| `LOG_FILE` | — | `playground/_logs/audit.jsonl` | 稽核日誌 JSON Lines 檔案路徑（空字串停用檔案日誌） |
| `LLM_LOG_FILE` | — | `playground/_logs/llm.jsonl` | LLM 互動日誌檔案路徑（完整紀錄請求與回應；空字串停用） |
| `PROMPT_FILE` | — | `playground/_prompts/system.md` | 自訂提示詞模板檔案路徑 |

### 主題系統

HeartReverie 支援透過 TOML 檔案自定義主題。主題檔案放在 `THEME_DIR` 指定的目錄下（預設 `./themes/`）。

內建三套主題：

| 浮心夜夢 (default) | 晴書紙本 (light) | 月硯墨靜 (dark) |
|:---:|:---:|:---:|
| ![浮心夜夢](assets/theme-default.png) | ![晴書紙本](assets/theme-light.png) | ![月硯墨靜](assets/theme-dark.png) |

#### 新增主題

建立一個 `.toml` 檔案，格式如下：

```toml
id = "my-theme"          # 必須與檔名相同（去除 .toml）
label = "我的主題"        # 下拉選單顯示名稱
colorScheme = "dark"     # "light" 或 "dark"
backgroundImage = ""     # 同源路徑或 data: URL，空字串表示無背景圖

[palette]
# 每個 CSS 自訂屬性（不含前綴 --）
panel-bg = "#1a1e24"
text-main = "rgba(220, 220, 215, 1)"
# ... 完整屬性請參考 themes/default.toml
```

重啟服務後新主題即可在「設定 → 主題」中選用。

## 🔌 外掛系統

每個外掛是一個資料夾加上一份 `plugin.json`，宣告它要做的事。系統提供下列擴展點：

1. **提示詞注入**：`promptFragments` 把 Markdown 檔案映射成 Vento 模板變數，渲染時自動塞進提示詞
2. **提示詞標籤移除**：`promptStripTags` 告訴引擎在組建提示詞時從 previousContext（已儲存章節內容）中移除哪些 XML 標籤
3. **顯示標籤移除**：`displayStripTags` 告訴前端在瀏覽器渲染時移除哪些 XML 標籤，讀者不會看到這些內部標記
4. **後端掛鉤**：`backendModule` 透過 context 物件（含 hooks 與 logger）介入 `prompt-assembly`、`response-stream`、`pre-write`、`post-response`、`pre-llm-fetch` 五個階段
5. **前端模組**：`frontendModule` 在瀏覽器端透過 Vue composable 與 `frontend-render` 掛鉤處理自訂區塊渲染
6. **前端樣式注入**：`frontendStyles` 宣告 CSS 樣式表路徑，在前端載入時自動注入為 `<link>` 元素
7. **自訂路由**：`backendModule` 可透過 `registerRoutes(ctx)` 註冊 RESTful API 端點，掛載在 `/api/plugins/<name>/` 下

完整文件請見 [`docs/plugin-system.md`][plugin-system-doc]。

### 內建外掛

| 外掛 | 說明 |
|------|------|
| `context-compaction` | 多層脈絡壓縮策略，控制送入 LLM 的歷史章節數量 |
| `dialogue-colorize` | CSS Custom Highlight API 對話引號高亮，不修改 DOM |
| `reading-progress` | 跨裝置閱讀進度同步：捲動位置追蹤、文字錨點書籤、跨章節恢復提示 |
| `polish` | 潤稿模式——對最後一章進行語法與文風修正 |
| `response-notify` | LLM 回應完成通知（Tab 隱藏時發送系統通知） |
| `start-hints` | 首輪對話引導提示 |
| `thinking` | 摺疊式 `<think>` 推理區塊 |
| `user-message` | 使用者訊息生命週期管理 |

所有內建外掛皆可透過讀者端的「外掛設定」頁面進行開關與參數調整，變更即時生效無需重新載入。

### 選用外掛（推薦）

> [!TIP]
> **強烈建議搭配 [HeartReverie_Plugins][heartreverie-plugins] 使用。**  
> 這組選用外掛提供變數狀態追蹤、角色狀態面板、選項面板、破限等進階功能，能大幅提升互動體驗與故事品質。外掛獨立於主專案維護，使用者可依需求自由搭配。

```bash
git clone https://codeberg.org/jim60105/HeartReverie_Plugins.git
```

複製後設定環境變數並複製提示詞模板即可啟用：

- `PLUGIN_DIR`：指向該目錄的絕對路徑
- 將該目錄中的 `system.md` 複製至本專案根目錄覆寫預設提示詞

使用容器部署者可直接建置含外掛的延伸映像檔，詳見 [HeartReverie_Plugins README][heartreverie-plugins]。

完整外掛系統文件請見 [`docs/plugin-system.md`][plugin-system-doc]。

### 撰寫自訂外掛

建議使用 AI 代理搭配 `heartreverie-create-plugin` skill 來建立外掛。使用以下指令安裝 skill：

```bash
npx skills add https://github.com/jim60105/HeartReverie -s heartreverie-create-plugin
```

安裝後，在 AI 代理中啟用 `heartreverie-create-plugin` skill，它會引導你完成類型選擇、manifest 建立、提示詞片段、後端/前端模組、標籤設定與 README 撰寫。

## 📖 典籍系統（Lore Codex）

以檔案為基礎的世界觀知識庫。受 SillyTavern 世界書啟發，專為檔案工作流程設計。

- **三層作用域**：全域（`_lore/`）、系列（`<系列>/_lore/`）、故事（`<系列>/<故事>/_lore/`）與故事資料並置
- **Markdown 篇章**：`.md` 檔案 + YAML frontmatter（`tags`、`priority`、`enabled`）
- **標籤系統**：frontmatter 標籤 + 目錄即標籤 + 檔名即標籤，自動注入為 Vento 模板變數（`{{ lore_<tag> }}`）

完整文件請見 [`docs/lore-codex.md`][lore-codex-doc]。

## 🧰 工具選單

頁首的 🧰 圖示開啟工具下拉選單（路由 `/tools`），目前提供兩項輔助工具：

- **快速新增**（`/tools/new-series`）：以單一表單建立新系列／故事，並可選擇性同步建立角色 lore 檔與世界篇章 lore 檔。
- **ST 角色卡轉換工具**（`/tools/import-character-card`）：解析 SillyTavern V2/V3 PNG 角色卡，將欄位轉為可編輯表單後寫入故事的 `_lore/` 範圍。

## ✏️ Template Editor

`/settings/template-editor` 是瀏覽器內的 Vento 模板 lint／preview／編輯工具，可即時驗證 `system.md`、plugin `promptFragments`（唯讀）、與三層典籍篇章；CodeMirror 6 編輯器附 Vento 自動完成，並提供三種 preview fixture mode（`default` / `inline` / `current`）。寫入採 atomic write + `.bak` 備份。完整說明見 [`docs/prompt-template.md` 的 Template Editor 章節](docs/prompt-template.md#template-editor)。

## 🧪 測試

```bash
deno task test                                    # 全部
deno task test:backend                            # 僅後端
deno task test:frontend                           # 僅前端
```

## ☸️ Helm 部署

Kubernetes 使用者可透過內附的 Helm chart 一鍵部署：

```bash
helm install hr ./helm/heart-reverie \
  --namespace heart-reverie --create-namespace \
  --set env.LLM_API_KEY=sk-... \
  --set env.PASSPHRASE=open-sesame
```

完整安裝指南、Ingress 範例（Traefik／nginx）、TLS／持續性／提示詞覆寫等進階情境請見：

- 中文指南：[`docs/helm-deployment.md`](docs/helm-deployment.md)
- Chart README（英文）：[`helm/heart-reverie/README.md`](helm/heart-reverie/README.md)

## 📄 授權

<img src="assets/AGPLv3_Logo.svg" alt="agplv3" width="300" />

[GNU AFFERO GENERAL PUBLIC LICENSE Version 3][license]

Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

[sillytavern]: https://github.com/SillyTavern/SillyTavern
[vento]: https://vento.js.org/
[hono]: https://hono.dev/
[vue]: https://vuejs.org/
[system-md]: system.md
[deno]: https://deno.com/
[plugin-system-doc]: docs/plugin-system.md
[heartreverie-plugins]: https://codeberg.org/jim60105/HeartReverie_Plugins
[lore-codex-doc]: docs/lore-codex.md
[license]: /LICENSE

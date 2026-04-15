# HeartReverie 浮心夜夢

<section align="center">
  <img src="assets/heart.webp"/>
</section>

面向開發者的 AI 互動小說引擎，以 Markdown 檔案與外掛系統為核心。

HeartReverie 以「發展故事」為主軸，有別於 [SillyTavern][sillytavern] 以「對話」為核心的設計。你的輸入作為引導故事走向的指示，本身不會寫入故事內容。

整個專案圍繞純文字檔案設計，故事內容、提示詞、典籍系統等全部以 `.md` 檔案儲存，適合習慣 VSCode 等編輯器的開發者。提示詞骨架是一個 [Vento][vento] 模板 [`system.md`](system.md)，可注入 Markdown 片段作為模板變數，所有客製化皆可透過外掛系統完成。提供 [Agent Skill](### 撰寫自訂外掛)，讓你用 AI 代理全自動產生外掛程式。

前端是 Vue 3 + TypeScript SPA；後端使用 TypeScript + [Hono][hono]，串接 OpenAI 相容 API，將回應逐步寫入章節檔案。

[sillytavern]: https://github.com/SillyTavern/SillyTavern
[vento]: https://vento.js.org/
[hono]: https://hono.dev/

## 🚀 快速開始

### 容器化部署（推薦）

```bash
podman run -d --name heartreverie \
  -p 8443:8443 \
  -e LLM_API_KEY=your-api-key \
  -e PASSPHRASE=your-passphrase \
  -v ./playground:/app/playground:z \
  heartreverie:latest
```

### 本地部署

需要 [Deno](https://deno.com/)。

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
zsh ./serve.zsh
```

伺服器預設跑在 `https://localhost:8443`。首次啟動會自動產生自簽 TLS 憑證。
設定 `HTTP_ONLY=true` 可關閉 TLS，適用於反向代理 / K8s 部署。

> [!NOTE]
> 前端使用 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) 讀取本機 `.md` 檔案，需要 HTTPS 安全環境

### 環境變數

| 變數 | 必要 | 預設值 | 說明 |
|------|:---:|--------|------|
| `LLM_API_KEY` | ✅ | — | LLM 提供者 API 金鑰 |
| `PASSPHRASE` | ✅ | — | 前端驗證用通關密語 |
| `PORT` | — | `8443` | 監聽埠號 |
| `LLM_MODEL` | — | `deepseek/deepseek-v3.2` | LLM 模型 |
| `LLM_API_URL` | — | `https://openrouter.ai/api/v1/chat/completions` | LLM 聊天完成端點 |
| `LLM_TEMPERATURE` | — | `0.1` | 取樣溫度 |
| `LLM_FREQUENCY_PENALTY` | — | `0.13` | 頻率懲罰 |
| `LLM_PRESENCE_PENALTY` | — | `0.52` | 存在懲罰 |
| `LLM_TOP_K` | — | `10` | Top-K 取樣 |
| `LLM_TOP_P` | — | `0` | Top-P（nucleus）取樣 |
| `LLM_REPETITION_PENALTY` | — | `1.2` | 重複懲罰 |
| `LLM_MIN_P` | — | `0` | Min-P 取樣 |
| `LLM_TOP_A` | — | `1` | Top-A 取樣 |
| `PLUGIN_DIR` | — | — | 外部外掛目錄（絕對路徑） |
| `PLAYGROUND_DIR` | — | `./playground` | 故事資料根目錄 |
| `READER_DIR` | — | `./reader-dist` | 前端靜態檔案根目錄 |
| `BACKGROUND_IMAGE` | — | `/assets/heart.webp` | 背景圖片 URL 路徑 |
| `PROMPT_FILE` | — | `playground/_prompts/system.md` | 自訂提示詞模板檔案路徑 |
| `HTTP_ONLY` | — | — | 設為 `true` 關閉 TLS（反向代理部署） |
| `CERT_FILE` | — | — | 自訂 TLS 憑證路徑 |
| `KEY_FILE` | — | — | 自訂 TLS 金鑰路徑 |

## 🔌 外掛系統

每個外掛是一個資料夾加上一份 `plugin.json`，宣告它要做的事。系統有五層擴展點：

1. **提示詞注入**：`promptFragments` 把 Markdown 檔案映射成 Vento 模板變數，渲染時自動塞進提示詞
2. **提示詞標籤移除**：`promptStripTags` 告訴引擎在組建提示詞時從 previousContext（已儲存章節內容）中移除哪些 XML 標籤
3. **顯示標籤移除**：`displayStripTags` 告訴前端在瀏覽器渲染時移除哪些 XML 標籤，讀者不會看到這些內部標記
4. **後端掛鉤**：`backendModule` 可以介入 `prompt-assembly`、`response-stream`、`pre-write`、`post-response`、`strip-tags` 五個階段
5. **前端模組**：`frontendModule` 在瀏覽器端透過 Vue composable 與 `frontend-render` 掛鉤處理自訂區塊渲染

完整文件請見 [`docs/plugin-system.md`](docs/plugin-system.md)。

### 撰寫自訂外掛

建議使用 AI 代理搭配 `heartreverie-create-plugin` skill 來建立外掛。使用以下指令安裝 skill：

```bash
npx skills add https://codeberg.org/jim60105/HeartReverie -s heartreverie-create-plugin
```

安裝後，在 AI 代理中啟用 `heartreverie-create-plugin` skill，它會引導你完成類型選擇、manifest 建立、提示詞片段、後端/前端模組、標籤設定與 README 撰寫。

## 📖 典籍系統（Lore Codex）

以檔案為基礎的世界觀知識庫。受 SillyTavern 世界書啟發，專為檔案工作流程設計。

- **三層作用域**：全域（`_lore/`）、系列（`<系列>/_lore/`）、故事（`<系列>/<故事>/_lore/`）與故事資料並置
- **Markdown 篇章**：`.md` 檔案 + YAML frontmatter（`tags`、`priority`、`enabled`）
- **標籤系統**：frontmatter 標籤 + 目錄即標籤 + 檔名即標籤，自動注入為 Vento 模板變數（`{{ lore_<tag> }}`）

完整文件請見 [`docs/lore-codex.md`](docs/lore-codex.md)。

## 🧪 測試

```bash
deno task test                                    # 全部
deno task test:backend                            # 僅後端
deno task test:frontend                           # 僅前端
```

## 🐳 容器部署

```bash
# 建置容器映像
podman build -t heartreverie:latest .

# 執行
podman run -d --name heartreverie \
  -p 8443:8443 \
  -e LLM_API_KEY=your-api-key \
  -e PASSPHRASE=your-passphrase \
  -v ./playground:/app/playground:z \
  heartreverie:latest
```

## 📄 授權

<img src="assets/AGPLv3_Logo.svg" alt="agplv3" width="300" />

[GNU AFFERO GENERAL PUBLIC LICENSE Version 3](/LICENSE)

Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

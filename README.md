# HeartReverie 浮心夜夢

<section align="center">
  <img src="assets/heart.webp"/>
</section>

面向開發者的 AI 互動小說引擎，作為 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 的替代方案。

提示詞的骨架是一個 [Vento](https://vento.js.org/) 模板（[`system.md`](system.md)），外掛透過 Markdown 片段注入自己的內容。後端透過任何 OpenAI 相容的 API 串接 LLM（預設使用 [OpenRouter](https://openrouter.ai/)），將回應逐步寫入章節檔案，前端透過 WebSocket 即時串流顯示（亦支援 HTTP 輪詢作為降級方案）。

所有客製化都透過外掛系統完成，撰寫外掛需要基本的程式能力。後端用 TypeScript + [Hono](https://hono.dev/)，前端是 Vue 3 + TypeScript SPA（以 [Vite](https://vite.dev/) 建置）。

## 🚀 快速開始

需要 [Deno](https://deno.com/) ≥ 2.0 和 [Node.js](https://nodejs.org/)。預建置的 `state-patches` 二進位檔已包含在倉庫中。

```bash
# 建立 .env（或複製 .env.example）
cat > .env << 'EOF'
LLM_API_KEY=your-api-key-here
PASSPHRASE=your-passphrase-here
EOF

# 建置前端
cd reader-src && npm install && cd ..
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
| `PROMPT_FILE` | — | `playground/prompts/system.md` | 自訂提示詞模板檔案路徑 |
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

內建外掛涵蓋角色狀態面板、選項按鈕、變數顯示、文風控制、去機器人化等。完整文件見 [`docs/plugin-system.md`](docs/plugin-system.md)。

### 撰寫自訂外掛

建議使用 AI 代理搭配 `heartreverie-create-plugin` skill 來建立外掛。先安裝 skill：

```bash
npx skills add https://codeberg.org/jim60105/HeartReverie -s heartreverie-create-plugin
```

安裝後，在 AI 代理中啟用 `heartreverie-create-plugin` skill，它會引導你完成類型選擇、manifest 建立、提示詞片段、後端/前端模組、標籤設定與 README 撰寫。

## 🧪 測試

```bash
deno task test                                    # 全部
deno task test:backend                            # 僅後端
deno task test:frontend                           # 僅前端
cd plugins/state-patches/rust && cargo test       # Rust 整合測試
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

若需重建 Rust 二進位檔（通常不需要，倉庫已包含預建置版本）：

```bash
cd plugins/state-patches
podman build --output=. --target=binary -f rust/Containerfile rust/
```

## 📄 授權

## LICENSE

<img src="assets/AGPLv3_Logo.svg" alt="agplv3" width="300" />

[GNU AFFERO GENERAL PUBLIC LICENSE Version 3](/LICENSE)

Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

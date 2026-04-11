# HeartReverie 浮心夜夢

<img src="assets/heart.webp" alt="HeartReverie" width="500" />

面向開發者的 AI 互動小說引擎，作為 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 的替代方案。

提示詞的骨架是一個 [Vento](https://vento.js.org/) 模板（[`system.md`](system.md)），外掛透過 Markdown 片段注入自己的內容。後端透過任何 OpenAI 相容的 API 串接 LLM（預設使用 [OpenRouter](https://openrouter.ai/)），將回應逐步寫入章節檔案，前端以輪詢偵測檔案變化並即時顯示。

所有客製化都透過外掛系統完成，撰寫外掛需要基本的程式能力。後端用 TypeScript + [Hono](https://hono.dev/)，前端是 Vanilla JS（無框架無建置步驟）。

## 🚀 快速開始

需要 [Deno](https://deno.com/) ≥ 2.0 和 [Rust](https://www.rust-lang.org/) 工具鏈。

```bash
# 建置 Rust CLI
cd plugins/state-patches/rust && cargo build --release && cd ../../..

# 建立 .env（或複製 .env.example）
cat > .env << 'EOF'
LLM_API_KEY=your-api-key-here
PASSPHRASE=your-passphrase-here
EOF

# 啟動
zsh ./serve.zsh
```

伺服器預設跑在 `https://localhost:8443`。首次啟動會自動產生自簽 TLS 憑證。

> [!NOTE]
> 前端使用 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)，只在 HTTPS 安全環境下運作

### 環境變數

| 變數 | 必要 | 預設值 | 說明 |
|------|:---:|--------|------|
| `LLM_API_KEY` | ✅ | — | LLM 提供者 API 金鑰 |
| `PASSPHRASE` | ✅ | — | 前端驗證用通關密語 |
| `PORT` | — | `8443` | 監聽埠號 |
| `LLM_MODEL` | — | `deepseek/deepseek-v3.2` | LLM 模型 |
| `LLM_API_URL` | — | `https://openrouter.ai/api/v1/chat/completions` | LLM 聊天完成端點 |
| `PLUGIN_DIR` | — | — | 外部外掛目錄（絕對路徑） |
| `PLAYGROUND_DIR` | — | `./playground` | 故事資料根目錄 |
| `READER_DIR` | — | `./reader` | 前端靜態檔案根目錄 |

## 🔌 外掛系統

每個外掛是一個資料夾加上一份 `plugin.json`，宣告它要做的事。系統有五層擴展點：

1. **提示詞注入**：`promptFragments` 把 Markdown 檔案映射成 Vento 模板變數，渲染時自動塞進提示詞
2. **提示詞標籤移除**：`promptStripTags` 告訴引擎在組建提示詞時從 previousContext（已儲存章節內容）中移除哪些 XML 標籤
3. **顯示標籤移除**：`displayStripTags` 告訴前端在瀏覽器渲染時移除哪些 XML 標籤，讀者不會看到這些內部標記
4. **後端掛鉤**：`backendModule` 可以介入 `prompt-assembly`、`response-stream`、`pre-write`、`post-response`、`strip-tags` 五個階段
5. **前端模組**：`frontendModule` 在瀏覽器端透過 `frontend-render` 掛鉤處理自訂區塊渲染

內建外掛涵蓋角色狀態面板、選項按鈕、變數顯示、文風控制、去機器人化等。完整文件見 [`docs/plugin-system.md`](docs/plugin-system.md)。

## 🧪 測試

```bash
deno task test                                    # 全部
deno task test:backend                            # 僅後端
deno task test:frontend                           # 僅前端
cd plugins/state-patches/rust && cargo test       # Rust 整合測試
```

## 📄 授權

[GPL-3.0-or-later](https://www.gnu.org/licenses/gpl-3.0.html)

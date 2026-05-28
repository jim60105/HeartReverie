# 設定字典

[HeartReverie 浮心夜夢][project] 透過環境變數設定。必填的只有 `LLM_API_KEY` 與 `PASSPHRASE`，其餘變數皆有合理預設值。設定的最常見做法是把變數寫進 `.env`，再以 `--env-file .env`、Helm value 或容器編排工具傳入。

## 必填

| 變數 | 說明 |
|------|------|
| `LLM_API_KEY` | LLM 提供者 API 金鑰 |
| `PASSPHRASE` | 前端驗證用通關密語 |

## LLM 連線

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `LLM_MODEL` | `deepseek/deepseek-v4-pro` | LLM 模型 |
| `LLM_API_URL` | `https://openrouter.ai/api/v1/chat/completions` | Chat Completions 端點 |
| `LLM_TEMPERATURE` | `0.1` | 取樣溫度 |
| `LLM_FREQUENCY_PENALTY` | `0.13` | 頻率懲罰 |
| `LLM_PRESENCE_PENALTY` | `0.52` | 存在懲罰 |
| `LLM_TOP_K` | `10` | Top-K |
| `LLM_TOP_P` | `0` | Top-P |
| `LLM_REPETITION_PENALTY` | `1.2` | 重複懲罰 |
| `LLM_MIN_P` | `0` | Min-P |
| `LLM_TOP_A` | `1` | Top-A |
| `LLM_MAX_COMPLETION_TOKENS` | 未設定 | 每次回應的 token 上限 |
| `LLM_REASONING_ENABLED` | `true` | 是否在請求中附 `reasoning` 區塊 |
| `LLM_REASONING_EFFORT` | `xhigh` | `reasoning.effort` 等級 |
| `LLM_REASONING_OMIT` | `false` | `true` 時完全省略 `reasoning` 區塊 |

## 伺服器

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `PORT` | `8080` | 監聽埠號 |
| `PLUGIN_DIR` | — | 外部外掛目錄（絕對路徑） |
| `PLAYGROUND_DIR` | `./playground` | 故事資料根目錄 |
| `READER_DIR` | `./reader-dist` | 前端靜態檔案根目錄 |
| `THEME_DIR` | `./themes/` | 主題檔案目錄 |
| `LOG_LEVEL` | `info` | 日誌等級：debug／info／warn／error |
| `LOG_FILE` | `playground/_logs/audit.jsonl` | 稽核日誌路徑（空字串停用） |
| `LLM_LOG_FILE` | `playground/_logs/llm.jsonl` | LLM 互動日誌路徑 |
| `PROMPT_FILE` | `playground/_prompts/system.md` | 自訂提示詞模板路徑 |

[project]: https://github.com/jim60105/HeartReverie

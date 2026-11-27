# 外接 OpenAI 相容 LLM

[HeartReverie 浮心夜夢][project] 後端會將聊天請求轉發至任何 OpenAI 相容端點。本頁說明如何切換上游 LLM 提供者、走自架代理或自架 OpenAI 相容伺服器。

## 基本變數

| 變數 | 用途 |
|------|------|
| `LLM_API_BASE_URL` | 上游 API 基底 URL（OpenAI SDK 風格；**不要**包含 `/chat/completions` 或 `/responses`，引擎會自行接上 transport 路徑） |
| `LLM_API_MODE` | 傳輸協定：`auto`（預設）、`responses`、`chat-completions` |
| `LLM_API_KEY` | 上游 API 金鑰，作為 `Authorization: Bearer …` header；選填——無金鑰的本機/私有 provider 可省略 |
| `LLM_MODEL` | 上游模型 ID |

完整取樣參數請見[參考 → 設定字典][reference]。

## 傳輸模式與自動回退

`LLM_API_MODE=auto`（預設）會先以 Responses API（`<LLM_API_BASE_URL>/responses`）送出請求；若上游以 `404`、`405` 或 `501` 回應，代表該服務未實作 Responses API，引擎會在同一輪生成改用 Chat Completions（`<LLM_API_BASE_URL>/chat/completions`）重試一次。回退成功後，同一組 base URL + model 的後續請求會直接走 Chat Completions，直到行程重啟。

- `LLM_API_MODE=responses`：只走 Responses API；`404`/`405`/`501` 直接失敗，不再回退。
- `LLM_API_MODE=chat-completions`：只走 Chat Completions，`auto` 的回退探測完全不發生。若你需要 `repetition_penalty`、`min_p`、`top_a` 這些 OpenRouter 專屬取樣參數，或上游對 Responses 請求回 400，請明確設定此值。
- `continue-last-chapter`（續寫）在 `auto` 下固定走 Chat Completions，因為它依賴尾端 assistant prefill 行為。

`LLM_API_URL`（舊的完整端點變數）已移除：啟動時若仍設定，伺服器會記錄錯誤並以非零狀態結束，不會開始監聽。`LLM_API_BASE_URL` 也必須是絕對的 http(s) URL，且不得包含 query string 或 fragment。

## 範例：無金鑰的本機 provider（Ollama / vLLM / LM Studio）

本機或私有 OpenAI 相容伺服器通常不需要 API 金鑰。**省略 `LLM_API_KEY`（或留空）即可**——此時上游請求不帶 `Authorization` header：

```env
LLM_API_BASE_URL=http://127.0.0.1:11434/v1
# LLM_API_KEY 不設定
LLM_MODEL=llama3.1
```

未設定 `LLM_API_KEY` 時，伺服器啟動時會警告雲端 provider 會拒絕未驗證請求——若 `LLM_API_BASE_URL` 仍指向需要金鑰的雲端端點（如 OpenRouter），請求會以 401/403 失敗，這屬預期行為。

## 範例：OpenRouter

```env
LLM_API_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...
LLM_MODEL=deepseek/deepseek-v4-pro
```

## 範例：自架 LiteLLM / vLLM

```env
LLM_API_BASE_URL=http://litellm.internal:4000/v1
LLM_API_KEY=sk-fake
LLM_MODEL=local/llama-3-70b-instruct
```

若該代理尚未支援 Responses API，`auto` 會自動回退；也可直接設定 `LLM_API_MODE=chat-completions` 省去一次探測。

## 範例：DeepSeek 官方

```env
LLM_API_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-chat
```

## 注意事項

- 後端會在 `LLM_API_BASE_URL` 後接上 `/responses` 或 `/chat/completions`；請只填基底路徑，勿自行加上端點路徑（若已含這些路徑，啟動檢查會直接拒絕）。
- 若 LLM 不支援 `reasoning` 區塊，請設定 `LLM_REASONING_OMIT=true`，避免請求被上游 422 拒絕。
- 後端走串流（SSE），請避免在前置代理切掉長連線（如反向代理需要關閉 buffering）。

[project]: https://github.com/jim60105/HeartReverie
[reference]: ../reference/configuration.md

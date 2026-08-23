# 外接 OpenAI 相容 LLM

[HeartReverie 浮心夜夢][project] 後端會將聊天請求轉發至任何 OpenAI Chat Completions 相容的端點。本頁說明如何切換上游 LLM 提供者、走自架代理或自架 OpenAI 相容伺服器。

## 基本變數

| 變數 | 用途 |
|------|------|
| `LLM_API_URL` | 上游 Chat Completions 完整 URL（含 `/v1/chat/completions` 路徑） |
| `LLM_API_KEY` | 上游 API 金鑰，作為 `Authorization: Bearer …` header；選填——無金鑰的本機/私有 provider 可省略 |
| `LLM_MODEL` | 上游模型 ID |

完整取樣參數請見[參考 → 設定字典][reference]。

## 範例：無金鑰的本機 provider（Ollama / vLLM / LM Studio）

本機或私有 OpenAI 相容伺服器通常不需要 API 金鑰。**省略 `LLM_API_KEY`（或留空）即可**——此時上游請求不帶 `Authorization` header：

```env
LLM_API_URL=http://127.0.0.1:11434/v1/chat/completions
# LLM_API_KEY 不設定
LLM_MODEL=llama3.1
```

未設定 `LLM_API_KEY` 時，伺服器啟動時會警告雲端 provider 會拒絕未驗證請求——若 `LLM_API_URL` 仍指向需要金鑰的雲端端點（如 OpenRouter），請求會以 401/403 失敗，這屬預期行為。

## 範例：OpenRouter

```env
LLM_API_URL=https://openrouter.ai/api/v1/chat/completions
LLM_API_KEY=sk-or-...
LLM_MODEL=deepseek/deepseek-v4-pro
```

## 範例：自架 LiteLLM / vLLM

```env
LLM_API_URL=http://litellm.internal:4000/v1/chat/completions
LLM_API_KEY=sk-fake
LLM_MODEL=local/llama-3-70b-instruct
```

## 範例：DeepSeek 官方

```env
LLM_API_URL=https://api.deepseek.com/v1/chat/completions
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-chat
```

## 注意事項

- 後端不會幫使用者重寫 `LLM_API_URL`，請保留完整路徑。
- 若 LLM 不支援 `reasoning` 區塊，請設定 `LLM_REASONING_OMIT=true`，避免請求被上游 422 拒絕。
- 後端走串流（SSE），請避免在前置代理切掉長連線（如反向代理需要關閉 buffering）。

[project]: https://github.com/jim60105/HeartReverie
[reference]: ../reference/configuration.md

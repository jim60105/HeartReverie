# 設定

HeartReverie 透過環境變數設定。必要的變數只有 `PASSPHRASE`，其餘變數都有合理的預設值。設定最常見的做法是把變數寫進 `.env` 檔，再以 `--env-file .env` 或 Helm value 傳入容器。

## 必要環境變數

| 變數 | 說明 |
|------|------|
| `PASSPHRASE` | 前端驗證用通關密語 |

`LLM_API_KEY` 是選填：雲端 provider（如 OpenRouter）需要金鑰；接無金鑰的本機/私有 provider（Ollama、vLLM、LM Studio）時省略即可。

## 完整設定字典

LLM 連線、伺服器路徑、日誌、主題系統等所有環境變數的完整說明，請參閱[參考 → 設定字典][reference-config]。

[reference-config]: ../reference/configuration.md

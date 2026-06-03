# 設定

HeartReverie 透過環境變數設定。必要的兩個變數是 `LLM_API_KEY` 與 `PASSPHRASE`，其餘變數都有合理的預設值。設定最常見的做法是把變數寫進 `.env` 檔，再以 `--env-file .env` 或 Helm value 傳入容器。

## 必要環境變數

| 變數 | 說明 |
|------|------|
| `LLM_API_KEY` | LLM 提供者 API 金鑰 |
| `PASSPHRASE` | 前端驗證用通關密語 |

## 完整設定字典

LLM 連線、伺服器路徑、日誌、主題系統等所有環境變數的完整說明，請參閱[參考 → 設定字典][reference-config]。

[reference-config]: ../reference/configuration.md

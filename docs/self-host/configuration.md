# 環境變數與 PLUGIN_DIR

本頁面向自架站管理員，整理跑 [HeartReverie 浮心夜夢][project] 容器時最常調整的環境變數。完整字典請見[參考 → 設定字典][reference]。

## 必填變數

| 變數 | 說明 |
|------|------|
| `LLM_API_KEY` | LLM 提供者 API 金鑰 |
| `PASSPHRASE` | 前端驗證用通關密語 |

## 路徑變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `PLAYGROUND_DIR` | `./playground` | 故事資料根目錄；容器內掛載點 `/app/playground` |
| `PLUGIN_DIR` | — | 外部外掛目錄絕對路徑 |
| `THEME_DIR` | `./themes/` | 主題檔案目錄 |
| `READER_DIR` | `./reader-dist` | 前端靜態檔案根目錄（容器映像已內建） |

### PLUGIN_DIR 使用方式

把外部外掛儲存庫（如 [HeartReverie_Plugins][hrp]）掛載至容器，再以 `PLUGIN_DIR` 指向掛載點：

```bash
podman run -d --name heartreverie \
  -p 8080:8080 \
  --env-file .env \
  -e PLUGIN_DIR=/app/external-plugins \
  -v ./playground:/app/playground:z \
  -v ./HeartReverie_Plugins:/app/external-plugins:z \
  ghcr.io/jim60105/heartreverie:latest
```

外掛探索與載入順序、安全約束請見[外掛開發者 → 外部外掛][external-plugins]。

## 日誌

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `LOG_LEVEL` | `info` | debug／info／warn／error |
| `LOG_FILE` | `playground/_logs/audit.jsonl` | 稽核日誌（空字串停用檔案日誌） |
| `LLM_LOG_FILE` | `playground/_logs/llm.jsonl` | LLM 互動日誌 |

[project]: https://github.com/jim60105/HeartReverie
[reference]: ../reference/configuration.md
[hrp]: https://codeberg.org/jim60105/HeartReverie_Plugins
[external-plugins]: ../plugin-dev/external-plugins.md

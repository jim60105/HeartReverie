# CLI 腳本

`HeartReverie/scripts/` 收錄開發、CI 與本地預覽用的腳本。本頁列出每個腳本用途，便於查找。

| 腳本 | 類型 | 用途 |
|------|------|------|
| `serve.sh` | shell | 以 Deno 啟動主後端服務於 `localhost:8080`，掛載 `playground/` |
| `serve-docs.sh` | shell | 以 docsify-cli 啟動文件預覽於 `localhost:3001`，自動 watch 變更 |
| `podman-build-run.sh` | shell | 重建容器映像並啟動 `heartreverie` 容器，整合測試流程依此啟動 |
| `coverage.ts` | Deno | 跑後端測試並輸出 lcov 與 HTML 覆蓋率報告 |
| `check-vento-helpers.ts` | Deno | 校驗 `VENTO_HELPERS` 常數與後端註冊的 filter 一致 |
| `introspect-hooks.ts` | Deno | 列出所有後端 hook 階段及其在程式碼中註冊處，協助補完文件 |

執行方式：所有 `.sh` 腳本可直接 `./scripts/<name>.sh` 執行；`.ts` 腳本以 `deno run --allow-* scripts/<name>.ts` 執行（必要權限參見腳本檔首註解）。

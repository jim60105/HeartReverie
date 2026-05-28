# 貢獻者總覽

歡迎為 [HeartReverie 浮心夜夢][project] 提交改進。本頁是新貢獻者的入口導覽，依序帶你把本機環境跑起來、做出可驗證的變更、循 [OpenSpec workflow][openspec] 提案，再依[文件站截圖規範][screenshot-recipes] 補拍畫面。

## 取得程式碼與本機跑起來

```bash
git clone https://github.com/jim60105/HeartReverie.git
cd HeartReverie
cp .env.example .env   # 設定 PASSPHRASE 等變數
```

建議的本機開發方式是直接走容器，避免 host 與容器 Deno 權限旗標的落差：

```bash
scripts/podman-build-run.sh
```

腳本會重建映像、以正確的 `--allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi` 旗標啟動 `heartreverie` 容器，並掛載 `playground/`。預設服務於 `http://localhost:8080/`，以 `.env` 內的 `PASSPHRASE` 登入。

文件站的本機預覽：

```bash
scripts/serve-docs.sh   # http://localhost:3001
```

腳本一覽請見[CLI 腳本][cli-scripts]。

## 測試變更

任何觸及執行階段（後端路由、prompt 渲染、外掛載入、前端互動）的變更，提交前 SHALL：

1. 以 `scripts/podman-build-run.sh` 重建容器。
2. 檢查 `podman logs heartreverie` 啟動 log 無 `error` 或 `warn`。
3. 以 `curl -H "X-Passphrase: $PASSPHRASE" http://localhost:8080/...` 觸發新行為，比對預期輸出或落盤檔案。

只改文件、註解、純測試的 PR 可豁免容器驗證，但仍須通過 lint。詳細的容器整合驗收規範收錄於儲存庫根的 AI 代理指引（給以 AI 輔助工具撰寫程式碼的貢獻者參考；不是新人入門讀物）。

## 程式碼風格速覽

- 後端為 Deno + TypeScript，遵守 `deno.json` 內的 fmt 與 lint 設定，`deno task lint && deno task fmt --check` 應通過。
- 前端為 Vue 3 + Vite，元件以 `<script setup lang="ts">` 撰寫；型別與樣式遵守 `HeartReverie/AGENTS.md`。
- 文件以正體中文（zh-TW）撰寫，採 docsify 渲染；連結優先使用 reference-style，集中於檔案尾端。
- 永遠不要吞掉錯誤：所有 `catch` 區塊必須記錄訊息或回報診斷資訊，初始化函式回 `{ ok, error? }` 而非 bare boolean。

## 提出變更：OpenSpec workflow

跨檔案、會動到對外行為或 spec 的變更，請先走 [OpenSpec workflow][openspec]：

1. 在 `openspec/changes/<change-id>/` 下開 `proposal.md`、`design.md`、`tasks.md` 與 delta `specs/`。
2. 以 `openspec validate <change-id> --strict` 驗證一輪後，把實作 PR 與該 change 綁在一起。
3. 合併後由 reviewer 執行歸檔流程，把 delta 套回主 specs。

純錯字、樣式、文件補強等小型修補不必走 OpenSpec，直接開 PR 即可，但 PR 描述仍須說明動機與驗證方式。

## 補拍與更新截圖

文件站的截圖採 schema v1 配方制：每張圖前面緊鄰 `<!-- screenshot-recipe ... -->` 註解，紀錄重拍所需的 URL、viewport、preconditions、steps、`captured_at`、`app_commit`。修改 UI 元件後，請：

1. 找出引用該元件的圖：`grep -REn 'assets/screenshots/' docs/`。
2. 依配方以 `agent-browser` 重跑互動，覆寫 PNG。
3. 更新配方的 `captured_at` 與 `app_commit`。

詳細欄位、檔名規則、壓縮流程與 alt 文字守則請見[文件站截圖規範][screenshot-recipes]。

## 流程入口速查

| 想做的事 | 起點 |
|----------|------|
| 提報 bug 或功能請求 | [GitHub Issues][issues] |
| 提交程式碼／文件變更 | Fork → branch → PR，附容器驗證紀錄 |
| 規劃跨檔案的變更 | [OpenSpec workflow][openspec]：先提案、再實作 |
| 補拍／更新截圖 | [文件站截圖規範][screenshot-recipes] |
| 找腳本 | [CLI 腳本][cli-scripts] |
| 寫文件 | 依本文件站的 persona-based IA（入門／自架站／作者／外掛開發者／參考／貢獻者）放置新頁面 |

[project]: https://github.com/jim60105/HeartReverie
[issues]: https://github.com/jim60105/HeartReverie/issues
[openspec]: openspec.md
[screenshot-recipes]: screenshot-recipes.md
[cli-scripts]: cli-scripts.md

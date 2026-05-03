# CI 跨儲存庫觸發

`docker-publish-latest.yaml` 在成功發布 `latest` 多架構映像檔後，會自動透過 Forgejo workflow dispatch API 觸發 [HeartReverie_Plugins](https://codeberg.org/jim60105/HeartReverie_Plugins) 的建置工作流程。

## 所需 Secrets 與 Variables

| 名稱 | 類型 | 說明 |
|------|------|------|
| `FORGEJO_API_TOKEN` | secret | Forgejo 個人存取權杖，須具備觸發 Actions 的寫入權限 |
| `FORGEJO_BASE_URL` | variable | Forgejo 實例 API 基底 URL（例如 `https://codeberg.org/api/v1`） |
| `FORGEJO_PLUGINS_REPO` | variable | 目標儲存庫路徑（例如 `jim60105/HeartReverie_Plugins`） |
| `FORGEJO_PLUGINS_WORKFLOW` | variable | 工作流程檔名（例如 `build-push.yaml`） |
| `FORGEJO_PLUGINS_REF` | variable | 觸發用的 git ref（例如 `refs/heads/master`） |

## 觸發流程

1. `docker-publish-latest.yaml` 的 `merge` 工作完成（含多架構 manifest 與 attestations）
2. `dispatch-forgejo-plugins` 工作自動執行
3. 傳送 dispatch 請求至 Forgejo API，帶有以下 inputs：
   - `trigger_source=github-docker-publish-latest`
   - `trigger_tag=latest`
   - `trigger_run_id`（本次 GitHub Actions run ID）
   - `trigger_sha`（觸發 commit SHA）
4. 若 Forgejo 回傳非 2xx 狀態，工作流程標記為失敗

> [!NOTE]
> 下游 Forgejo 工作流程須宣告 `workflow_dispatch` 並接受上述 input 欄位，方可正確接收觸發。

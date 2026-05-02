# Helm 部署指南

本指南說明如何使用本專案內附的 Helm chart（位於 `helm/heart-reverie/`）將 HeartReverie 浮心夜夢部署到 Kubernetes 叢集。chart 將官方 OCI 映像（`ghcr.io/jim60105/heartreverie`）打包為標準 Helm release，內含 Deployment、Service、Secret、PVC、選用的 Ingress 與選用的 ServiceAccount／提示詞 ConfigMap。

英文版 chart README 位於 [`helm/heart-reverie/README.md`](../helm/heart-reverie/README.md)，記錄完整的 values 介面對照表；本文件聚焦於台灣／繁體中文使用者最常遇到的情境與錯誤排除。

## 前置需求

- Helm ≥ 3.10
- Kubernetes ≥ 1.27（Ingress 使用 `networking.k8s.io/v1`）
- 一組 OpenAI 相容的 LLM 服務 API 金鑰（如 OpenRouter、OpenAI、DeepSeek 等）
- 叢集需有預設 `StorageClass`，或於 `persistence.storageClass` 明確指定

## 快速安裝

最小可用安裝（CLI 直接帶入金鑰，僅建議用於開發環境）：

```bash
helm install hr ./helm/heart-reverie \
  --namespace heart-reverie --create-namespace \
  --set env.LLM_API_KEY=sk-... \
  --set env.PASSPHRASE=open-sesame
```

預設會建立：

- Deployment（單一 Pod，運行 `ghcr.io/jim60105/heartreverie:latest`）
- Service（ClusterIP，port 8443）
- Secret（包含 `LLM_API_KEY`、`PASSPHRASE`、自動注入的 `PORT`）
- PersistentVolumeClaim（10 GiB，存放 `playground/` 故事資料）
- 自簽 TLS 憑證於 Pod 內 `/certs` 自動產生（除非設定 `HTTP_ONLY=true`）

## 為何只允許單一 Pod

HeartReverie 將章節、典籍、token 用量等所有資料直接寫入 Pod 本機檔案系統，沒有跨 Pod 鎖／協調機制。**使用 ≥ 2 個 replica 共享同一 RWO PVC 必會發生資料毀損**。chart 預設 `replicaCount: 1`、`strategy.type: Recreate`，請勿覆寫。

## 憑證資訊處理（推薦順序）

依安全性高低排序：

### 1. `secret.existingSecret` — 最安全

由其他工具（ExternalSecrets、sealed-secrets、cert-manager + Vault）管理 Secret，chart 不再渲染自己的 Secret：

```bash
kubectl create secret generic hr-creds \
  --namespace heart-reverie \
  --from-literal=LLM_API_KEY=sk-... \
  --from-literal=PASSPHRASE=open-sesame

helm install hr ./helm/heart-reverie \
  --namespace heart-reverie --create-namespace \
  --set secret.existingSecret=hr-creds
```

> 注意：使用 `existingSecret` 時 chart 不會自動把 `app.port` 注入為 `PORT` 環境變數。若你覆寫了 `app.port`，請在外部 Secret 中加上對應的 `PORT` key。

### 2. `--set-file` — 從檔案讀取

避免金鑰落入 shell history／CI 紀錄：

```bash
helm install hr ./helm/heart-reverie \
  --namespace heart-reverie --create-namespace \
  --set-file env.LLM_API_KEY=./secrets/llm.txt \
  --set-file env.PASSPHRASE=./secrets/passphrase.txt
```

### 3. `--set` — 僅限 placeholder／開發

值會落入 shell history 與 CI 日誌。除錯使用即可，不建議生產環境採用。

## 環境變數

`env:` 為扁平 UPPER_SNAKE map，每個 key 直接對應 `AGENTS.md` 中記載的環境變數。chart 會把所有非空值渲染進單一 Secret，並透過 `envFrom` 注入容器。

新增任意環境變數無需修改 template：

```bash
--set env.LLM_MODEL=deepseek/deepseek-v4-pro
--set env.LOG_LEVEL=debug
```

布林（`false`）與數值（`0`）會以字串形式（`"false"`、`"0"`）保留，不會被誤判為空值。空字串會從 Secret 中省略。

## TLS 憑證設定

HeartReverie 預設啟用 TLS 以加密 Passphrase 與章節內容的傳輸；TLS 屬於建議的安全強化預設，而非任何前端功能的硬性需求。chart 預設以「Pod 內自簽憑證」方式提供 HTTPS；若部署於已終結 TLS 的反向代理之後，可改用純 HTTP（設定 `env.HTTP_ONLY=true`）。

### 模式 1：預設自簽憑證（適合測試）

`entrypoint.sh` 啟動時會在 `emptyDir` 掛載點 `/certs` 自動產生自簽憑證。Ingress controller 必須能容忍上游自簽憑證（見下方 ingress-nginx 範例）。

### 模式 2：使用 cert-manager 簽發的真實憑證

設定 `tls.existingSecret` 指向一個 `kubernetes.io/tls` 型別的 Secret。chart 會把該 Secret 的 `tls.crt`／`tls.key` 投影到 `/certs/cert.pem`／`/certs/key.pem`：

```yaml
tls:
  existingSecret: hr-tls
  # certKey: tls.crt   # 預設值
  # keyKey: tls.key    # 預設值
```

若你的 Secret 使用其他 key 名稱（例如 `server.crt`／`server.key`），請覆寫 `tls.certKey`／`tls.keyKey`。

### 模式 3：在 Ingress 終止 TLS、Pod 內走純 HTTP

設定 `env.HTTP_ONLY=true`（**完全小寫**，與 `entrypoint.sh` 與 `writer/server.ts` 的執行期判斷一致）。chart 會跳過 `/certs` 掛載：

```yaml
env:
  HTTP_ONLY: "true"
```

## Ingress 設定範例

chart 內附兩份範例 values 檔，可直接以 `-f` 套用後再以 `--set` 帶入金鑰。

### Traefik（HTTP_ONLY 模式，推薦）

```bash
helm install hr ./helm/heart-reverie \
  --namespace heart-reverie --create-namespace \
  -f ./helm/heart-reverie/examples/values-traefik.yaml \
  --set env.LLM_API_KEY=sk-... \
  --set env.PASSPHRASE=open-sesame
```

範例採用 HTTP_ONLY 模式，避免為了讓 Traefik 信任 Pod 自簽憑證而需要建立 `ServersTransport` CRD。範例檔開頭的註解區塊提供了「在 Pod 內保留 HTTPS」的替代方案。

### ingress-nginx（上游 HTTPS）

ingress-nginx 透過 annotation 即可跳過上游 TLS 驗證：

```bash
helm install hr ./helm/heart-reverie \
  --namespace heart-reverie --create-namespace \
  -f ./helm/heart-reverie/examples/values-nginx.yaml \
  --set env.LLM_API_KEY=sk-... \
  --set env.PASSPHRASE=open-sesame
```

## 故事資料持續性

PVC 帶有 `helm.sh/resource-policy: keep` annotation，`helm uninstall` **不會**刪除故事資料。完整移除流程：

```bash
helm uninstall hr -n heart-reverie
kubectl delete pvc -n heart-reverie -l app.kubernetes.io/instance=hr
kubectl delete namespace heart-reverie    # 選用
```

跨 release／namespace 遷移：在新 release 上設定 `persistence.existingClaim: <舊 PVC 名稱>`，重新 `helm install` 即會掛載舊資料繼續運作。

## 進階：自訂系統提示詞（唯讀）

若希望以 ConfigMap 部署自訂的 `system.md`：

```bash
helm install hr ./helm/heart-reverie \
  --namespace heart-reverie --create-namespace \
  --set prompts.enabled=true \
  --set-file 'prompts.files.system\.md=./my-system.md' \
  --set env.LLM_API_KEY=sk-... \
  --set env.PASSPHRASE=open-sesame
```

ConfigMap 會掛載至 `/app/prompt-overrides/`（**位於 playground PVC 之外**），chart 自動注入 `PROMPT_FILE` 指向第一個檔名。

> **限制**：ConfigMap 掛載為唯讀，啟用後 reader UI 內的「提示詞編輯器」儲存按鈕會在執行期失敗。若需要可編輯的 system prompt，請保持 `prompts.enabled: false`，改以 `kubectl cp` 將 `system.md` 複製到 playground PVC。

## ServiceAccount

預設 `serviceAccount.create: false`、`automount: false`——HeartReverie 不需要呼叫 Kubernetes API，預設禁用 token 投影以縮小攻擊面。若你需要為 Pod 接上雲端身分（IRSA、Workload Identity、GKE Workload Identity 等），改為：

```yaml
serviceAccount:
  create: true
  name: heart-reverie-sa
  automount: true
```

並在 ServiceAccount 上加上對應的 cloud provider annotation（chart 不代為渲染雲端 annotation）。

## 常見錯誤排除

- **`stringData` 中找不到 `LLM_TEMPERATURE`**：可能是值設成空字串。chart 會把空字串視為「未設定」並省略。請確認該 key 確實有值。
- **Pod 啟動失敗、Liveness probe 一直失敗**：檢查 `app.port` 與你實際讓 server 監聽的 port 是否一致。chart 把 `app.port` 同步到 `containerPort`、`Service.targetPort`、probe 與 Secret 中的 `PORT`，但若你又透過 `env.PORT` 覆寫了 PORT，可能造成兩端 port 不一致。
- **多個 Pod 同時啟動造成資料異常**：確認 `replicaCount` 為 1、`strategy.type` 為 `Recreate`。請勿改成 `RollingUpdate`。
- **`storageClassName` 找不到**：明確設定 `persistence.storageClass=<your-class>`，或先建立叢集預設 `StorageClass`。

## 參考

- 完整 values 表：[`helm/heart-reverie/README.md`](../helm/heart-reverie/README.md)
- 環境變數總表：專案根目錄的 `AGENTS.md` 「Environment Variables」章節
- 應用本身的設定載入邏輯：`writer/lib/config.ts`、`entrypoint.sh`

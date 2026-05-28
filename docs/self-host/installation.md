# 安裝

HeartReverie 支援兩種啟動方式，分別是容器化部署與本地部署。第一次嘗試建議從容器化部署開始，因為不需安裝 Deno，也不必另外建置前端。

## 容器化部署

```bash
 # 建立 .env（或複製 .env.example）
cat > .env << 'EOF'
LLM_API_KEY=your-api-key-here
PASSPHRASE=your-passphrase-here
EOF

podman run -d --name heartreverie \
  -p 8080:8080 \
  --env-file .env \
  -v ./playground:/app/playground:z \
  ghcr.io/jim60105/heartreverie:latest
```

預建置映像檔發佈於 GitHub Container Registry。如需從原始碼自行建置：

```bash
podman build -t heartreverie:latest .
```

建置完成後沿用上方的 `podman run` 指令，將映像檔名稱換成 `heartreverie:latest` 即可啟動本地映像。

## 本地部署

本地部署需要 [Deno](https://deno.com/)。

```bash
 # 建立 .env（或複製 .env.example）
cat > .env << 'EOF'
LLM_API_KEY=your-api-key-here
PASSPHRASE=your-passphrase-here
EOF

 # 建置前端
deno install --lock=deno.lock
deno task build:reader

 # 啟動
./scripts/serve.sh
```

伺服器預設跑在 `http://localhost:8080`，僅提供純 HTTP。本頁聚焦於把服務在單機跑起來；對外公開、HTTPS 終結、多副本協調與資料持續性等正式環境議題不在本頁範圍，請見下方「進階部署」轉至 Helm 指南。

## 進階部署

Kubernetes 使用者可以透過內附的 Helm chart 一鍵部署，完整安裝指南、Ingress 設定範例、上游 TLS 終結策略（Ingress controller／service mesh／雲端 LB）與資料持續性等情境請見[Helm 部署](helm.md)。單機環境若需要對外公開或加上 HTTPS，相同的 TLS 終結策略亦適用，可參考該頁「TLS 終結」一節挑選對應方案。

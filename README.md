# HeartReverie 浮心夜夢

[![codecov](https://codecov.io/gh/jim60105/HeartReverie/graph/badge.svg?token=1DJzsidNtp)](https://codecov.io/gh/jim60105/HeartReverie)
[![CI](https://github.com/jim60105/HeartReverie/actions/workflows/ci.yaml/badge.svg)](https://github.com/jim60105/HeartReverie/actions/workflows/ci.yaml)
[![GitHub release](https://img.shields.io/github/v/release/jim60105/HeartReverie)](https://github.com/jim60105/HeartReverie/releases)
[![License](https://img.shields.io/github/license/jim60105/HeartReverie)](./LICENSE)

<section align="center">
  <img src="assets/heart.webp"/>
</section>

HeartReverie 浮心夜夢 是一套 AI 互動小說引擎，把「讀小說」與「寫小說」綁在一起。你輸入幾句話來引導劇情走向，AI 接著把故事寫進章節檔案，你再像翻書一樣繼續往下讀。

與 [SillyTavern][sillytavern] 以「對話」為核心的設計不同，HeartReverie 的主軸是「發展故事」，你的輸入只作為引導，並不會直接寫進章節內容。

故事、提示詞、典籍系統全部以 `.md` 檔案儲存，你可以用 VSCode 等熟悉的編輯器直接編輯、用 Git 做版本控制。客製化全部走外掛系統，搭配 Agent Skill 還能讓 AI 代理替你寫出整份外掛程式碼。

技術棧上，前端使用 [Vue 3][vue]、後端使用 [Hono][hono]，串接任何 OpenAI 相容的 LLM API，將回應逐字寫入章節檔案。提示詞骨架是一份 [Vento][vento] 模板 `system.md`，外掛可以注入 Markdown 片段作為模板變數。

## 📚 完整文件

詳細的安裝、設定、外掛開發、典籍系統、Helm 部署等說明，全部整理在文件站。

- 線上文件，[`https://jim60105.github.io/HeartReverie/`](https://jim60105.github.io/HeartReverie/)
- 本機預覽，在 `HeartReverie/` 目錄下執行 `./scripts/serve-docs.sh`，預設於 `http://localhost:3001/` 開啟

## 🚀 快速開始

最快的啟動方式是容器化部署，預建置映像檔發佈於 GitHub Container Registry。

```bash
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

預設於 `http://localhost:8080` 提供純 HTTP 服務，若需要 TLS 請在上游反向代理或 Ingress controller 終結。

本地部署、自行建置映像、完整環境變數清單、主題客製化請見 [入門指南](https://jim60105.github.io/HeartReverie/#/getting-started/installation)。

## 🔌 外掛與生態

外掛是一個資料夾加上 `plugin.json`，可以注入提示詞片段、移除標籤、掛接後端 hook、註冊前端 Vue composable、提供自訂 API 路由，以及附加 CSS 樣式。內建 8 個外掛（脈絡壓縮、對話高亮、閱讀進度、潤稿、回應通知、起手提示、思考摺疊、使用者訊息管理），啟用後直接出現在讀者端的外掛設定頁。

> [!TIP]
> **強烈建議搭配 [HeartReverie_Plugins][heartreverie-plugins] 使用。**
> 這組選用外掛提供變數狀態追蹤、角色狀態面板、選項面板、破限等進階功能，能大幅提升互動體驗與故事品質。

外掛機制完整說明、自訂外掛撰寫指南、AI 代理輔助開發流程請見 [外掛系統文件](https://jim60105.github.io/HeartReverie/#/plugin-system/overview)。

## 📖 典籍系統 Lore Codex

以檔案為基礎的世界觀知識庫，受 SillyTavern 世界書啟發，專為檔案工作流程設計。Markdown 篇章搭配 YAML frontmatter，透過 frontmatter 標籤、目錄即標籤與檔名即標籤三條規則注入為 Vento 模板變數。詳細目錄結構、篇章格式、模板變數請見 [典籍系統文件](https://jim60105.github.io/HeartReverie/#/lore-codex/overview)。

## ☸️ Helm 部署

Kubernetes 使用者可透過內附的 Helm chart 一鍵部署。

```bash
helm install hr ./helm/heart-reverie \
  --namespace heart-reverie --create-namespace \
  --set env.LLM_API_KEY=sk-... \
  --set env.PASSPHRASE=open-sesame
```

完整安裝指南、Ingress 範例（Traefik／nginx）、TLS／持續性／提示詞覆寫等進階情境請見 [Helm 部署文件](https://jim60105.github.io/HeartReverie/#/deployment/helm)。

## 📄 授權

<img src="assets/AGPLv3_Logo.svg" alt="agplv3" width="300" />

[GNU AFFERO GENERAL PUBLIC LICENSE Version 3][license]

Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

[sillytavern]: https://github.com/SillyTavern/SillyTavern
[vento]: https://vento.js.org/
[hono]: https://hono.dev/
[vue]: https://vuejs.org/
[heartreverie-plugins]: https://codeberg.org/jim60105/HeartReverie_Plugins
[license]: /LICENSE

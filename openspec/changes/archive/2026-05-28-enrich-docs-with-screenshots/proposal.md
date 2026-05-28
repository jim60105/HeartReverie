## Why

目前的 docsify 文件站僅有少量視覺素材（封面用 `assets/heart.webp`），整個側邊欄列出的 Reader、Writer、Tools、Template Editor、Plugin 系統、典籍系統等頁面皆以純文字描述介面。讀者沒辦法在閱讀前先掌握實際畫面，貢獻者也缺少視覺基準以對齊新功能與既有設計。為了讓文件能呈現產品全貌，需要在文件站系統性加入截圖，並建立可重現的截圖規格，避免日後改版時畫面與描述脫節。

## What Changes

- 在 `docs/assets/` 下新增 `screenshots/` 子目錄，存放所有 UI 截圖；既有的 `heart.webp` 維持原位。
- 為每張截圖定義一段 docsify HTML 註解格式的「截圖配方」（screenshot recipe），紀錄 URL、視窗尺寸、前置條件、互動步驟、擷取範圍、輸出檔名、擷取日期、應用版本/commit SHA、主題等欄位，使截圖能被自動化工具重跑。
- 新增一份配方撰寫指南頁面 `docs/contributing/screenshot-recipes.md`，定義配方欄位語意、檔名規則、PNG/WebP 使用時機、檔案寬度上限（PNG ≤ 2048px）、替代文字（alt text）寫法、無障礙建議，以及容器啟動程序（`scripts/podman-build-run.sh`）。
- 在側邊欄合適位置（使用指南、Plugin 系統、典籍系統、Template Editor、Tools 選單、Lore Codex）加入截圖，並以 docsify 標準語法 `![alt](path)` 嵌入。
- 對應每頁的截圖清單（page → screenshot mapping）寫入 design.md 與 tasks.md，由實作階段照表完成。
- 明文限制：所有 in-app 截圖只能取自 SFW 故事 `http://localhost:8080/悠奈悠花姊妹大冒險/放學後/`；playground 中其他故事屬 NSFW，不得用於文件截圖。
- 提案 artifact 本身不擷取畫面，但本 change 的實作階段（tasks 第 4 節）會在同一份提交中完成所有截圖；每張圖的配方註解、Markdown 圖片連結與實際 PNG 檔必須同步合入，禁止留下「有配方無圖」或「captured_at/app_commit = TBD」的中間狀態。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `docs-site`：新增截圖資產目錄、截圖配方格式、配方撰寫指南頁、頁面與截圖對應規則、SFW 故事來源限制與替代文字規範。

## Impact

- 影響檔案：`docs/_sidebar.md`、`docs/contributing/screenshot-recipes.md`（新增，並列為「貢獻者文件」獨立區段，不放在面向終端使用者的「使用指南」之下）、各既有子頁面（嵌入截圖與配方註解）、`docs/assets/screenshots/`（新增目錄）。
- 不變動：`docs/index.html`、`deno.json`、`.github/workflows/docs-pages.yaml`、執行期依賴；不影響 GitHub Pages 部署流程。
- 對貢獻者：需要在本機啟動容器（`scripts/podman-build-run.sh`）並使用 `agent-browser` 技能依配方擷取截圖，提交時一併更新配方註解中的 `captured_at` 與 `app_commit` 欄位。
- 對讀者：頁面載入時間略增（PNG 圖檔），以寬度上限與每頁圖數控制；無 API 變動。

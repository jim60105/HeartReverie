# 架構概覽

```
writer/
├── server.ts                  ← 主伺服器，初始化 plugin 與 hook
└── lib/
    ├── plugin-manager.ts      ← PluginManager 類別：探索、載入、管理 plugin
    └── hooks.ts               ← HookDispatcher 類別：後端 hook 註冊與分派

plugins/                       ← 內建 plugin 目錄
├── _shared/
│   └── utils.js               ← 前端模組共用工具
├── context-compaction/
│   ├── plugin.json
│   └── handler.js
├── response-notify/
│   ├── plugin.json
│   ├── handler.js
│   └── frontend.js
├── thinking/
│   ├── plugin.json
│   ├── frontend.js
│   └── prompt-fragments/
│       └── think-before-reply.md
└── ...（共 8 個 plugin）
```

Plugin 與伺服器的互動分為六個層面，分別對應 manifest 中的不同欄位：

- **提示詞注入**：透過 `promptFragments` 將 Markdown 片段載入為 Vento 模板變數
- **動態變數**：透過 `backendModule` 匯出 `getDynamicVariables()` 函式，在渲染提示詞時動態提供模板變數
- **提示詞標籤清除**：透過 `promptStripTags` 宣告需要從 previousContext（已儲存章節內容）中移除的 XML 標籤或正規表達式，在組建提示詞時生效
- **顯示標籤清除**：透過 `displayStripTags` 宣告需要從前端顯示中移除的 XML 標籤或正規表達式，在瀏覽器渲染時生效
- **後端 hook**：透過 `backendModule` 註冊伺服器端生命週期事件的處理函式
- **前端模組**：透過 `frontendModule` 提供瀏覽器端的自訂標籤渲染邏輯
- **前端樣式注入**：透過 `frontendStyles` 宣告 CSS 樣式表路徑，系統在前端初始化時自動注入 `<link rel="stylesheet">` 至 `<head>`
- **動作按鈕**：透過 `actionButtons` 宣告閱讀器 UI 上的互動按鈕，搭配前端 `action-button:click` hook 與後端 `POST /api/plugins/:pluginName/run-prompt` 路由，可觸發自訂提示詞並把回應接回章節檔，詳見「[動作按鈕（Action Buttons）](action-buttons.md)」章節
- **可設定項目**：透過 `settingsSchema` 宣告 JSON Schema，系統自動提供 `GET/PUT /api/plugins/:name/settings` 端點與閱讀器內的設定頁，詳見「[Plugin Settings](settings.md)」章節
- **自訂 API 路由**：後端模組可額外匯出 `registerRoutes(context)`，將自家路由掛載於 `/api/plugins/:name/*` 命名空間下並共用 passphrase 驗證，詳見「[Plugin 自訂 API 路由](custom-api-routes.md)」章節

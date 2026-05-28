# 外掛範本骨架

本頁收錄 prompt-only 與 full-stack 兩類外掛的最小可用骨架，方便直接複製套用。完整撰寫流程請見 [Plugin 系統總覽][overview]；逐步引導與 manifest 細節請見 [Manifest 規格][manifest]、[Hook 系統][hooks]、[Settings 開發指南][settings]。

[overview]: overview.md
[manifest]: manifest.md
[hooks]: hooks.md
[settings]: settings.md

## 最小範例：prompt-only

建立 `plugins/my-plugin/` 目錄，加入兩個檔案：

**plugin.json**

```json
{
  "name": "my-plugin",
  "displayName": "我的外掛",
  "version": "1.0.0",
  "description": "自訂提示詞指令",
  "type": "prompt-only",
  "promptFragments": [
    { "file": "./instructions.md", "variable": "my_instructions", "priority": 100 }
  ]
}
```

**instructions.md**

```markdown
以下是自訂指令的內容，會在渲染時注入模板中的 {{ my_instructions }} 位置。
```

接著在 `system.md` 模板中加入 `{{ my_instructions }}` 即可。

## 完整範例：full-stack

一個同時包含提示詞片段、後端 hook、前端模組的 plugin：

**plugin.json**

```json
{
  "name": "my-fullstack",
  "displayName": "我的全端外掛",
  "version": "1.0.0",
  "description": "完整功能 plugin 範例",
  "type": "full-stack",
  "promptFragments": [
    { "file": "./prompt.md", "variable": "my_var", "priority": 100 }
  ],
  "backendModule": "./handler.js",
  "frontendModule": "./frontend.js",
  "tags": ["mytag"],
  "promptStripTags": ["mytag"],
  "displayStripTags": ["mytag"]
}
```

**handler.js**

```javascript
export function register({ hooks, logger }) {
  logger.info('Plugin initialized');

  hooks.register('post-response', async (ctx) => {
    const log = ctx.logger ?? logger;
    // ctx 為 deep-frozen PostResponsePayload — 切勿修改
    log.info('章節已寫入', {
      correlationId: ctx.correlationId,
      chapter: ctx.chapterNumber,
      source: ctx.source,                      // "chat" | "continue" | "plugin-action"
      pluginName: ctx.pluginName ?? null,      // 僅 source === "plugin-action" 才存在
      endpoint: ctx.endpoint,                  // 解析後的上游 URL
      tokens: ctx.usage?.totalTokens ?? null,
      upstreamCostUsd: ctx.usage?.upstreamCostUsd ?? null,
    });
  }, 100);
}
```

**frontend.js**

```javascript
export function register(hooks) {
  hooks.register('frontend-render', (context) => {
    // 自訂渲染邏輯
  }, 100);
}
```

## 使用外部 plugin 目錄

將 `PLUGIN_DIR` 環境變數設為外部目錄的絕對路徑，系統會在啟動時額外掃描該目錄。外部 plugin 與內建 plugin 同名時，外部版本會覆蓋內建版本。

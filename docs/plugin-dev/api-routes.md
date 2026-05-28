# Plugin 自訂 API 路由

後端模組可在 `register`／`getDynamicVariables` 之外，額外匯出 `registerRoutes(context)` 函式。系統會在 `createApp()` 期間呼叫一次，並把該 plugin 自家的 Hono routes 掛載到 `/api/plugins/:name/*` 命名空間下；所有路由自動共用 passphrase 認證 middleware。

## 簽章

```typescript
// writer/types.ts
export interface PluginRouteContext {
  readonly app: Hono;            // 整個 Hono app；plugin 應只在自己的 basePath 下註冊
  readonly basePath: string;     // "/api/plugins/<pluginName>"
  readonly logger: Logger;       // 已綁定 plugin 名稱的結構化 logger
  readonly getSettings: () => Promise<Record<string, unknown>>;
  readonly saveSettings: (settings: Record<string, unknown>) => Promise<void>;
  readonly config: AppConfig;    // 唯讀的全域設定（PLAYGROUND_DIR 等）
}
```

`registerRoutes` 可為同步或非同步。若回傳 Promise，系統會在 `initPluginRoutes(app)` 中等待所有 plugin 完成註冊後才開放服務。

## 範例

```typescript
// handler.ts
import type { PluginRegisterContext, PluginRouteContext } from "../../writer/types.ts";

export function register({ hooks, logger }: PluginRegisterContext): void {
  // ...一般 hook 註冊
}

export async function registerRoutes(ctx: PluginRouteContext): Promise<void> {
  const { app, basePath, logger, getSettings } = ctx;

  // 代理 SD WebUI 的 /sdapi/v1/sd-models，將結果作為 settingsSchema 的 x-options-url 候選
  app.get(`${basePath}/proxy/sd-models`, async (c) => {
    const settings = await getSettings();
    const endpoint = String(settings.endpoint ?? "http://localhost:7860");
    try {
      const res = await fetch(`${endpoint}/sdapi/v1/sd-models`);
      if (!res.ok) return c.json([], 200);
      const models = (await res.json()) as Array<{ title: string }>;
      return c.json(models.map((m) => m.title));
    } catch (err) {
      logger.warn("sd-webui proxy failed", { error: String(err) });
      return c.json([]);
    }
  });

  // 觸發圖片生成；寫入 PLAYGROUND_DIR/<series>/<story>/_images/ 後由 story-image-serving 路由提供出去
  app.post(`${basePath}/generate`, async (c) => {
    // ...
    return c.json({ ok: true });
  });
}
```

## 限制與安全

- 路由只能掛載於自家 `basePath` 之下；註冊在 `basePath` 之外的 path 雖然技術上可達，但會遭路徑檢查或前端 `/plugins/...` 命名空間阻擋。Plugin 應永遠以 `${basePath}/...` 為前綴。
- 所有 `/api/plugins/:name/*` 路徑共用全域 passphrase 認證——plugin 不需自行驗證 passphrase。
- `registerRoutes` 例外或 `Promise` reject 會被記錄但不會阻止伺服器啟動；其他 plugin 仍會繼續初始化。
- 路由命名建議冪等的 REST 風格（`proxy/...`、`generate`、`status` 等），避免與既有 `settings`／`settings-schema`／`run-prompt` 等系統路徑衝突。

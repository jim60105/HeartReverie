# API 端點

系統提供下列與 plugin 相關的 API 端點。除非另有說明，所有端點皆受 passphrase 認證 middleware 保護。

## GET /api/plugins

回傳所有已載入 plugin 的 metadata 陣列：

```json
[
  {
    "name": "thinking",
    "displayName": "思維鏈",
    "version": "1.0.0",
    "description": "Think before reply and fold thinking tags",
    "type": "full-stack",
    "tags": ["thinking", "think"],
    "displayStripTags": [],
    "hasFrontendModule": true,
    "hasSettings": true,
    "settings": { "enabled": true },
    "frontendStyles": [],
    "actionButtons": []
  }
]
```

`hasSettings` 為 `true` 時，前端會在設定頁側欄列出該 plugin 的設定分頁（路由：`/settings/plugins/:name`）。

## GET /api/plugins/action-buttons

回傳所有目前可見的 plugin action buttons，並在每個項目附加 `pluginName`。若 owning plugin 的 resolved `enabled === false`，該 plugin 的所有按鈕會被省略。

## GET /api/plugins/parameters

回傳所有可用的 Vento 模板參數（包含核心參數與 plugin 參數）：

```json
[
  { "name": "lore_all", "type": "string", "source": "lore", "description": "..." },
  { "name": "think_before_reply", "type": "string", "source": "thinking", "description": "..." }
]
```

此端點供前端的提示詞編輯器使用，讓使用者在編輯模板時查看可用變數。

## Plugin Settings 端點

詳見「[Plugin Settings](settings.md)」章節：

- `GET /api/plugins/:name/settings-schema` — 取得 plugin 的 JSON Schema
- `GET /api/plugins/:name/settings` — 取得已合併預設值的目前設定
- `PUT /api/plugins/:name/settings` — 驗證並儲存新設定

## Story Image Serving 端點

供 plugin（例如 sd-webui-image-gen）使用，將生成的圖片從故事目錄下的 `_images/` 子目錄提供出來。詳細規格見 [`openspec/specs/story-image-serving/spec.md`](https://github.com/jim60105/HeartReverie/blob/master/openspec/specs/story-image-serving/spec.md)。

| 端點 | 說明 |
|------|------|
| `GET /api/stories/:series/:story/images/:filename` | 提供 `PLAYGROUND_DIR/<series>/<story>/_images/<filename>` 的二進位圖片。`filename` 必須符合 `^[\w\-\.]+$`，並排除任何含 `..` 的請求。Content-Type 依副檔名推導（`.avif`／`.webp`／`.png`／`.jpg`／`.jpeg`／`.gif`／`.svg`），並附 `Cache-Control: public, immutable`。 |
| `GET /api/stories/:series/:story/image-metadata?chapter=<N>` | 回傳 `{ images: [...] }`，從 `_images/_metadata.json` 讀取，可選 `chapter` 查詢參數過濾單章。檔案不存在時回 `{ images: [] }`。 |

`/api/*` 的 body limit 為 10 MB，以容納 sd-webui 等服務回傳的 base64 圖片。

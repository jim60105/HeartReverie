# API 端點

[HeartReverie 浮心夜夢][project] 後端提供下列 REST API。除非另有說明，所有端點皆受 passphrase 認證 middleware 保護（`X-Passphrase` header 或 WebSocket 認證）。

## 故事與章節

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/stories` | 列出所有系列 |
| GET | `/api/stories/:series` | 列出系列下故事 |
| GET | `/api/stories/:series/:story/chapters` | 列出故事章節 |
| GET | `/api/stories/:series/:story/chapters/:n` | 讀取單一章節 |
| PUT | `/api/stories/:series/:story/chapters/:n` | 寫入章節 |
| POST | `/api/stories/:series/:story/chat` | 串流發起 LLM 回合 |

## Story Image Serving

供外掛（例如 `sd-webui-image-gen`）將生成的圖片從故事目錄下的 `_images/` 子目錄提供出來。

| 端點 | 說明 |
|------|------|
| `GET /api/stories/:series/:story/images/:filename` | 提供 `PLAYGROUND_DIR/<series>/<story>/_images/<filename>` 的二進位圖片。`filename` 須符合 `^[\w\-\.]+$`，排除含 `..` 的請求。Content-Type 依副檔名推導（`.avif` / `.webp` / `.png` / `.jpg` / `.jpeg` / `.gif` / `.svg`），附 `Cache-Control: public, immutable` |
| `GET /api/stories/:series/:story/image-metadata?chapter=<N>` | 回傳 `{ images: [...] }`，從 `_images/_metadata.json` 讀取；可選 `chapter` 過濾單章。檔案不存在時回 `{ images: [] }` |

`/api/*` 的 body limit 為 10 MB，以容納 sd-webui 等服務回傳的 base64 圖片。

## 模板

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/template` | 取得目前 `system.md` |
| PUT | `/api/template` | 寫入 `system.md`（atomic + `.bak`） |
| POST | `/api/templates/lint` | Lint 模板來源 |
| POST | `/api/templates/preview` | 預覽渲染後 messages |
| GET | `/api/templates/variables` | 列出可用變數 catalog |

## 典籍 Lore

所有端點皆需通過認證（`X-Passphrase` header 或 WebSocket 認證）。概念與資料結構請見[作者 → 典籍系統][lore-codex]。

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/lore/tags` | 列出所有標籤 |
| GET | `/api/lore/global` | 列出全域篇章 |
| GET | `/api/lore/series/:series` | 列出系列篇章 |
| GET | `/api/lore/story/:series/:story` | 列出故事篇章 |
| GET | `/api/lore/global/:path{.+}` | 讀取單一全域篇章 |
| GET | `/api/lore/series/:series/:path{.+}` | 讀取單一系列篇章 |
| GET | `/api/lore/story/:series/:story/:path{.+}` | 讀取單一故事篇章 |
| PUT | `/api/lore/global/:path{.+}` | 建立或更新全域篇章 |
| PUT | `/api/lore/series/:series/:path{.+}` | 建立或更新系列篇章 |
| PUT | `/api/lore/story/:series/:story/:path{.+}` | 建立或更新故事篇章 |
| DELETE | `/api/lore/global/:path{.+}` | 刪除全域篇章 |
| DELETE | `/api/lore/series/:series/:path{.+}` | 刪除系列篇章 |
| DELETE | `/api/lore/story/:series/:story/:path{.+}` | 刪除故事篇章 |

列表端點支援 `?tag=` 參數以有效標籤過濾。

### 回應格式

列表項目：

```json
[
  {
    "filename": "hero.md",
    "directory": "characters",
    "tags": ["protagonist", "characters", "hero"],
    "priority": 100,
    "enabled": true,
    "scope": "global"
  }
]
```

單一篇章：

```json
{
  "frontmatter": { "tags": ["protagonist"], "priority": 100, "enabled": true },
  "content": "Markdown 內容"
}
```

PUT 請求主體格式與單一篇章回應格式相同。建立新篇章回傳 `201`，更新現有篇章回傳 `200`，刪除回傳 `204`。`:path{.+}` 參數必須以 `.md` 結尾。

## 外掛

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/plugins` | 列出所有已載入外掛 metadata |
| GET | `/api/plugins/action-buttons` | 列出當前可見的動作按鈕 |
| GET | `/api/plugins/parameters` | 列出可用模板參數 |
| GET | `/api/plugins/:name/settings-schema` | 取得 JSON Schema |
| GET | `/api/plugins/:name/settings` | 取得已合併預設值的設定 |
| PUT | `/api/plugins/:name/settings` | 驗證並儲存新設定 |
| POST | `/api/plugins/:pluginName/run-prompt` | 由動作按鈕觸發 LLM 回合 |
| ANY | `/api/plugins/:name/*` | 外掛自訂路由命名空間 |

## 主題

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/themes` | 列出 `THEME_DIR` 內所有主題 |
| GET | `/api/themes/:id` | 取得單一主題 TOML 內容 |

## 認證與健康檢查

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/auth` | 通關密語驗證 |
| GET | `/api/health` | 健康檢查（不需驗證） |

[project]: https://github.com/jim60105/HeartReverie
[lore-codex]: ../author/lore-codex.md

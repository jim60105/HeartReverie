# 外掛 Settings 開發指南

本頁說明外掛開發者如何透過 manifest 的 `settingsSchema` 宣告可調設定，並由系統自動提供 API 與 UI。讀者面向的呈現方式請見[作者 → 外掛設定][author-settings]。

> 提示：撰寫 manifest 時可使用 [`heartreverie-create-plugin`][skill] Agent Skill 自動產生樣板。

## 宣告 `settingsSchema`

`settingsSchema` 為 JSON Schema 子集（HeartReverie 自有方言；hand-rolled validator）。它必須是物件型 schema（`type: "object"`、帶 `properties`）且**必須宣告 `x-schema-version: 1`**。Plugin 載入時 PluginManager 會驗證頂層結構與 `x-*` 擴充欄位的硬性規則；不符規格者會被拒絕並記錄錯誤。

```json
{
  "name": "sd-webui-image-gen",
  "displayName": "SD WebUI 配圖",
  "version": "1.0.0",
  "description": "Generate scene images via Automatic1111 / Stable Diffusion WebUI",
  "type": "full-stack",
  "backendModule": "./handler.ts",
  "settingsSchema": {
    "type": "object",
    "x-schema-version": 1,
    "properties": {
      "endpoint": {
        "type": "string",
        "title": "WebUI Endpoint",
        "format": "url",
        "default": "http://localhost:7860"
      },
      "apiKey": {
        "type": "string",
        "title": "API Key",
        "writeOnly": true
      },
      "model": {
        "type": "string",
        "title": "Checkpoint",
        "x-options-url": "/api/plugins/sd-webui-image-gen/proxy/sd-models"
      },
      "samplers": {
        "type": "array",
        "title": "Allowed Samplers",
        "items": { "type": "string" },
        "x-options-url": "/api/plugins/sd-webui-image-gen/proxy/samplers"
      },
      "savePath": {
        "type": "string",
        "title": "Save Directory",
        "format": "path",
        "x-path-roots": ["playground/_plugins/sd-webui-image-gen/"]
      },
      "enabled": { "type": "boolean", "default": true }
    }
  }
}
```

宣告 `settingsSchema` 後，系統自動：

- 暴露 `GET /api/plugins/:name/settings-schema`，回傳 JSON Schema 給前端渲染表單。
- 暴露 `GET /api/plugins/:name/settings`，回傳合併預設值後的目前設定。
- 暴露 `PUT /api/plugins/:name/settings`，以內建 validator 驗證後寫入 `playground/_plugins/<name>/config.json`。
- 在閱讀器內「設定 → LLM 設定」左側選單列出該外掛的設定分頁（路由 `/settings/plugins/:name`）。

### 支援的關鍵字

| 類別 | 關鍵字 |
|------|------|
| Type | `string`、`number`、`integer`、`boolean`、`array`、`object`、`null` |
| Numeric | `minimum`、`maximum`、`exclusiveMinimum`、`exclusiveMaximum`、`multipleOf` |
| String | `minLength`、`maxLength`、`pattern`（ECMAScript regex）、`format` |
| Array | `items`、`minItems`、`maxItems`、`uniqueItems` |
| Object | `properties`、`required`、`additionalProperties`（僅 boolean） |
| Composition | `enum`、`const` |
| Annotation | `title`、`description`（純文字）、`default`、`writeOnly` |

`format` 白名單僅含 `path`、`color`、`url`、`email`、`uuid`。其他值不會觸發驗證錯誤（silent ignore）。**機密欄位應使用 `writeOnly: true`，不要透過 `format` 表達**。

### `x-*` 擴充欄位

| 關鍵字 | 用途 |
|------|------|
| `x-schema-version: 1` | **必填**。Schema 方言版本；未來主版本升級時的硬性圍籬 |
| `x-show-when` | 條件可見性。形式 `{ field, equals \| notEquals \| in }`；`field` 必須是同層 sibling property，且該 property 不能同時出現在 `required` 中 |
| `x-options-url` | `select` / `multi-select` / `combobox` widget 從這個 URL 抓取選項。回應 shape：`{ options: [{ value, label }] }` |
| `x-path-roots` | 限縮 `format: "path"` 欄位的允許根目錄。**只能縮小**硬編碼集合（`playground/lore/`、`playground/chapters/`、`playground/_plugins/<pluginName>/`），不能擴張。空交集會在載入時被拒絕 |
| `x-previous-names` | 欄位重新命名遷移；`GET` 時以記憶體內方式把舊鍵值搬到新名稱，後續成功 `PUT` 才落盤 |
| `x-legacy: true` | 頂層旗標。允許 `config.json` 內保留 schema 未描述的舊鍵，落盤時會被搬到頂層 `x-legacy: {...}` 命名空間。`x-legacy` 命名空間永不外洩給前端 |

`writeOnly: true` 的欄位：`GET` 回應遮蔽為 `null`；`PUT` 收到 `null` 表示「保留現值」（短路在型別檢查之前），`""` 表示「清空」，其他值正常驗證後寫入。

## Settings 端點

| 端點 | 說明 |
|------|------|
| `GET /api/plugins/:name/settings-schema` | 回傳完整 JSON Schema（含所有 `x-*` 關鍵字）。未宣告時 404 |
| `GET /api/plugins/:name/settings` | 預設值 + `config.json` 合併。`writeOnly` 欄位遮蔽為 `null`；`x-previous-names` 在記憶體內遷移；若 disk 有違反目前 schema 的舊值，會附帶 `x-legacy-warnings: ValidationError[]` 不阻擋 GET |
| `PUT /api/plugins/:name/settings` | 結構化驗證；接收選填的頂層 `_changedPaths: string[]` 欄位做兩階段驗證 |
| `POST /api/plugins/:name/settings/validate` | 純驗證，永不落盤；永遠回 200 + envelope |
| `GET /api/plugins/:name/settings/schema-meta` | 回傳 `{ schemaVersion, pathRoots, formats }` |

所有端點皆受 passphrase middleware 保護；reader-only 部署（`HEARTREVERIE_READER_ONLY=1`）時全部回 404。

### 結構化錯誤封套

`PUT` 的成功與失敗回應都含 `{ errors: ValidationError[], warnings: ValidationError[] }`。`ValidationError` shape：

```
{ "path": "items[0].name", "keyword": "pattern", "messageKey": "pattern", "params": { "pattern": "^[a-z]+$" } }
```

`messageKey` 用於前端 i18n 查表；前端找不到時 fallback 為 `keyword` + `params` 的通用訊息。

### 兩階段驗證（`_changedPaths`）

`PUT` body 頂層可加上 `_changedPaths: string[]`（不會被持久化）。Server 永遠額外計算 `incoming ⊝ disk` 的實際 diff。**阻擋範圍** = `actualDiff ∪ _changedPaths`。錯誤的 `path` 落在阻擋範圍之內 → 400 阻擋；之外 → 200 + 列為 `warnings`。

效果：使用者只修了 A 欄位，但 disk 內 B 欄位有舊有違規 → 仍可存檔（B 變 warning）；但若使用者誤把 `_changedPaths` 設成空陣列又動到了 A 的無效值 → server 仍會偵測到實際 diff 並阻擋。`_changedPaths` 是給前端做 UX 用，不是 trust boundary。

`writeOnly: true` + `null` 短路機制讓「未修改密碼」的 round-trip 不需要把明文送回 server。

## 設定頁與 widget registry

閱讀器在 `/settings/plugins/:name` 路由顯示自動產生的表單。`PluginSettingsPage` 透過 `<SchemaField>` 遞迴渲染，每個欄位由 `WidgetRegistry` 依 schema 比對解析出最高優先序的 widget。

Phase 1 內建 widget 集合（priority 高 → 低）：

| Widget | match 條件 |
|------|------|
| `multi-select` | `type: array` 且 `items.enum` 或 `items.x-options-url` |
| `repeater` | `type: array` 且 `items.type: object` |
| `path-picker` | `format: "path"` |
| `range-number` | `type: number\|integer` 且同時有 `minimum` 與 `maximum` |
| `masked-secret` | `writeOnly: true` |
| `combobox` | `type: string` 且 `x-options-url`（無 `enum`） |
| `select` | `enum` 在 `type: string` 上 |
| `color` | `format: "color"` |
| `tags` | `type: array` 且 `items.type: string`（無 `enum`、無 object/array items） |
| `object-fieldset` | `type: object` |
| `checkbox` | `type: boolean` |
| `number` | `type: number\|integer` |
| `text` | fallback |

**Phase 1 不允許 plugin 註冊自訂 widget**；前端 `register(context)` 不會新增 widget API。`x-options-url` 維持原樣，由 `select` / `multi-select` / `combobox` 在掛載時抓取選項（passphrase 標頭一併送出），失敗時降級到 `enum` 並顯示 inline 錯誤。

`x-show-when` 在前端評估：條件為 false 時欄位以 `v-if` 從 DOM 移除；模型值仍保留在 form 狀態中，重新顯示時恢復。隱藏欄位的 path 會從 `_changedPaths` 中排除，使其違規不會阻擋存檔。

## 在後端取用設定

外掛後端模組可在 `registerRoutes(context)` 中以 `context.getSettings()` / `context.saveSettings(...)` 讀寫自身設定。一般 `register(context)` 取得的 context 也提供 `getSettings()`，可在 hook handler 執行時讀取最新設定；不要在模組載入時永久快取設定。`getDynamicVariables(context)` 則可使用 `context.getSettings?.()` 讀取自身設定。

`enabled` 是內建的通用慣例：engine 會在 `getPromptVariables()` 與 `getDynamicVariables()` 中中央化跳過 disabled plugin 的提示詞與動態變數，並在 action-button API 過濾按鈕。Plugin 自身仍須在前端 hook 與後端 hook 中讀取設定並自行 no-op。`promptStripTags` 與 `displayStripTags` 不受 `enabled` 影響，這是刻意設計，使 plugin 停用後歷史章節中的標籤仍能被清除。

[author-settings]: ../author/plugin-settings.md
[skill]: overview.md#agent-skill

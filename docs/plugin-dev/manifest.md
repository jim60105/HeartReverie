# 外掛 Manifest 規格

> 起手不必手寫；可直接用 [`heartreverie-create-plugin`][skill] Agent Skill 產出 manifest 骨架，再做局部調整。

每個外掛目錄下必須包含一個 `plugin.json`，其 `name` 欄位必須與目錄名稱一致。以下是完整的欄位定義：

[skill]: overview.md#agent-skill

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `name` | `string` | ✅ | Plugin 的唯一識別名稱，必須與目錄名稱相同 |
| `displayName` | `string` | ✅ | 顯示用名稱（任何 Unicode 字串，非空白），用於閱讀器側邊欄與設定頁標題；UI 應呈現此值而非 slug |
| `version` | `string` | ❌ | 語意化版本號（例如 `"1.0.0"`） |
| `description` | `string` | ❌ | 簡短描述 |
| `type` | `string` | ❌ | Plugin 類型，見下方說明 |
| `promptFragments` | `array` | ❌ | 提示詞片段宣告，見「提示詞片段」章節 |
| `backendModule` | `string` | ❌ | 後端模組路徑（相對於 plugin 目錄） |
| `frontendModule` | `string` | ❌ | 前端模組路徑（相對於 plugin 目錄） |
| `tags` | `array` | ❌ | 此 plugin 管理的 XML 標籤名稱列表 |
| `promptStripTags` | `array` | ❌ | 組建提示詞時從 previousContext 中移除的標籤或正規表達式 |
| `displayStripTags` | `array` | ❌ | 前端顯示時移除的標籤或正規表達式 |
| `frontendStyles` | `array` | ❌ | 前端 CSS 樣式表路徑列表（相對於 plugin 目錄），見「前端樣式注入」章節 |
| `actionButtons` | `array` | ❌ | 動作按鈕宣告，見「[動作按鈕（Action Buttons）](action-buttons.md)」章節 |
| `settingsSchema` | `object` | ❌ | JSON Schema（draft-07）描述 plugin 可設定項目，見「[Plugin Settings](settings.md)」章節 |
| `parameters` | `array` | ❌ | 自訂 Vento 模板參數宣告 |
| `hooks` | `array` | ❌ | Plugin 註冊的 hook 階段宣告（用於 Hook Inspector 與啟動期一致性驗證），見「[Hook Inspector](hook-inspector.md)」章節 |

## Plugin 類型

`type` 欄位決定 plugin 的功能範圍：

| 類型 | 說明 | 範例 |
|------|------|------|
| `prompt-only` | 僅提供提示詞片段，不包含後端或前端邏輯 | start-hints、writestyle |
| `hook-only` | 僅透過後端 hook 參與生命週期，不提供提示詞 | — |
| `full-stack` | 同時包含提示詞片段、後端模組、前端模組 | context-compaction、thinking |
| `frontend-only` | 僅提供前端模組 | — |

類型宣告目前作為語意標註使用，系統不會依據類型限制 plugin 的實際能力。一個宣告為 `prompt-only` 的 plugin 若同時提供 `frontendModule`，系統仍會正常載入。

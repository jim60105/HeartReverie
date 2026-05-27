# 安全機制

Plugin 系統在多個層面實施安全防護：

## 路徑包含檢查

`backendModule`、`promptFragments`、`frontendModule` 的路徑在解析後必須位於 plugin 目錄內部。任何嘗試透過相對路徑（如 `../../etc/passwd`）存取外部檔案的行為都會被攔截。

## Plugin 名稱驗證

`isValidPluginName()` 函式拒絕包含 `..`、null byte、斜線等特殊字元的名稱。此外，manifest 中的 `name` 欄位必須與目錄名稱一致，防止 plugin 透過偽造名稱來覆蓋其他 plugin。

## 模板注入防護（SSTI Prevention）

使用者可透過前端編輯器自訂提示詞模板，這些模板在伺服器端由 Vento 引擎執行。`validateTemplate()` 函式以白名單方式解析模板中的 Vento 表達式，僅允許以下語法：

- 簡單變數引用（`{{ variable_name }}`）
- `for ... of` 迴圈
- `if` / `else` 條件判斷
- Pipe filter（`|> trim`）
- 註解（`{{# comment #}}`）

函式呼叫、屬性存取（`.`）、`process.env` 等運算式一律被拒絕，模板大小限制為 500KB。

## 前端模組靜態服務

`/plugins/:name/:file` 路由僅提供 manifest 中宣告的 `frontendModule` 檔案，不允許存取 plugin 目錄下的任意檔案。

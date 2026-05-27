# 模板變數

典籍系統在渲染提示詞時自動產生以下模板變數：

| 變數 | 型別 | 說明 |
|------|------|------|
| `{{ lore_all }}` | `string` | 所有啟用篇章的內容，依 priority 降冪排列後串接 |
| `{{ lore_<tag> }}` | `string` | 具有該有效標籤的啟用篇章，依 priority 降冪排列後串接 |
| `{{ lore_tags }}` | `string[]` | 所有已發現的標籤名稱陣列 |

## 行為細節

篇章依 priority 降冪排序，同 priority 則依檔名字母順序排列。多個篇章串接時以 `\n\n---\n\n` 作為分隔符。

標籤名稱經正規化後用於變數名稱，例如標籤 `world-building` 對應變數 `{{ lore_world_building }}`。若某個標籤未匹配到任何篇章，其變數值為空字串而非 undefined，因此可在模板中安全引用。

停用的篇章（`enabled: false`）不會出現在任何變數的內容中，但其標籤仍會被發現並產生對應的空變數。

## 使用範例

在 `system.md` 模板中引用：

```vento
{{ lore_scenario }}

{{ if lore_characters }}
<characters>
{{ lore_characters }}
</characters>
{{ /if }}
```

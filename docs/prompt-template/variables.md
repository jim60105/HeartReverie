# 模板變數

伺服器在渲染模板時傳入以下核心變數：

| 變數名稱 | 型別 | 說明 |
|---|---|---|
| `previous_context` | `string[]` | 已存在的章節內容陣列，按章節編號順序排列。內容經 `stripPromptTags()` 移除外掛定義的 XML 標籤後傳入 |
| `user_input` | `string` | 使用者在聊天請求中發送的原始訊息 |
| `isFirstRound` | `boolean` | 當所有章節內容皆為空時為 `true`，表示這是故事的第一回合 |
| `series_name` | `string` | 目前所選系列的名稱（與系列目錄名稱相同） |
| `story_name` | `string` | 目前所選故事的名稱（與故事目錄名稱相同） |
| `plugin_fragments` | `string[]` | 外掛透過 `promptFragments` 提供的內容片段陣列 |
| `lore_all` | `string` | 所有啟用的典籍篇章，依 priority 降冪排列後串接（由典籍系統提供） |
| `lore_<tag>` | `string` | 具有該有效標籤的啟用篇章（如 `lore_scenario`、`lore_characters`，由典籍系統提供） |
| `lore_tags` | `string[]` | 所有已發現的標籤名稱陣列（由典籍系統提供） |

除上述核心變數外，外掛亦可透過 `promptFragments` 提供額外的具名變數。外掛後端模組也可匯出 `getDynamicVariables()` 提供動態變數，一併傳入模板。

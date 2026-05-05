# Quick Add Tool — Delta Spec

> Target: `openspec/specs/quick-add-tool/spec.md`

## MODIFIED Requirement: Quick-add page form layout and structure

All UI labels, status messages, and error messages referencing "典籍" SHALL be renamed to "篇章":

- "角色典籍" → "角色篇章"
- "世界典籍" → "世界篇章"
- "世界典籍名稱" → "世界篇章名稱"
- "世界典籍檔案名稱" → "世界篇章檔案名稱"
- "世界典籍內容" → "世界篇章內容"
- "世界典籍（選填）" → "世界篇章（選填）"
- "建立世界典籍失敗" → "建立世界篇章失敗"
- "建立角色典籍失敗" → "建立角色篇章失敗"
- "建立中… 世界典籍" → "建立中… 世界篇章"
- "建立中… 角色典籍" → "建立中… 角色篇章"

The TypeScript union type `groupLabel: "角色典籍" | "世界典籍"` SHALL become `groupLabel: "角色篇章" | "世界篇章"`.

### MODIFIED Scenario: World_info lore PUT failure surfaces error
- **WHEN** the world_info lore PUT returns a non-2xx response
- **THEN** the page SHALL surface the error inline with the message "建立世界篇章失敗：\<server message\>"

### MODIFIED Scenario: Character lore PUT failure surfaces error
- **WHEN** the character lore PUT returns a non-2xx response
- **THEN** the page SHALL surface the error inline with the message "建立角色篇章失敗：\<server message\>", and SHALL NOT issue the world_info PUT

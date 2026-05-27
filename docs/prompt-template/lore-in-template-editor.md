# Lore 篇章可在 Template Editor 中編輯

典籍篇章（`.md` 檔，位於 `playground/_lore/`、`playground/<series>/_lore/`、或 `playground/<series>/<story>/_lore/`）可在 Template Editor 中編輯。檔案樹會依 scope 分組列出三類條目，內部路徑形式如下：

| 路徑格式 | Scope | 實際檔案位置 |
|----------|-------|--------------|
| `lore:global:<rel>` | 全域 | `${PLAYGROUND_DIR}/_lore/<rel>` |
| `lore:series:<series>:<rel>` | 系列 | `${PLAYGROUND_DIR}/<series>/_lore/<rel>` |
| `lore:story:<series>:<story>:<rel>` | 故事 | `${PLAYGROUND_DIR}/<series>/<story>/_lore/<rel>` |

所有路徑解析後都會經過 `realpath` 與目錄包含檢查，並拒收 symlink 與不合法的 `<series>`／`<story>` 段。

## 受限的變數 catalog

Lore 篇章在引擎中**早於** plugin fragment 渲染，因此 lint catalog 只包含「第一輪 snapshot」變數：

- 所有 `lore_*` 變數（`lore_all`、`lore_<tag>`、`lore_tags`）
- `series_name`
- `story_name`

**不包含** plugin 提供的任何變數（無論是 `promptFragments` 具名變數或 `getDynamicVariables()` 動態變數），也不包含 `user_input`、`previous_context`、`plugin_fragments`、`isFirstRound`。在 lore 篇章中引用 plugin 變數會被標為 `vento.unknown-variable`。

## Preview 模式

對 lore 條目，`POST /api/templates/preview` 回傳 `kind: "markdown"` 與渲染後的字串，**不會**回傳 `messages[]` 陣列——lore 篇章本身不參與多訊息組裝，僅作為被注入到 `lore_*` 變數中的純文字內容。

[plugin-system]: ../plugin-system/overview.md

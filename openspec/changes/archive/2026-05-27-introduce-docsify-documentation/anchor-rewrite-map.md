# Anchor rewrite map for plugin-system.md & prompt-template.md split

## plugin-system.md

| Legacy anchor | New target |
|---|---|
| `#hook-inspector` | `hook-inspector.md` |
| `#plugin-settings` | `settings.md` |
| `#plugin-自訂-api-路由` | `custom-api-routes.md` |
| `#動作按鈕action-buttons` | `action-buttons.md` |
| `#post-response-payloaddeep-frozen` | (intra) `hooks.md#post-response-payloaddeep-frozen` |
| `#tokenusagerecord` | (intra) `hooks.md#tokenusagerecord` |
| `#typed-events` | (intra) `hook-inspector.md#typed-event-hook-inspectorreport` |

## prompt-template.md

No `](#...)` intra-file anchor links were found in the legacy `prompt-template.md` body (grep returned zero matches). No rewrites needed for the prompt-template split.

## Cross-file references in migrated bodies after split

When a subpage links to an H2-level target that became its own subpage, the cross-file form is just the bare filename (relative to the current section), e.g. `action-buttons.md`. When the target stays intra-page (H3/H4 inside the same subpage), the link is rewritten to a `#anchor` form without the file prefix.

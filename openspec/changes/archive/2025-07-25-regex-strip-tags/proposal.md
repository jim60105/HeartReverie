## Why

The current `stripTags` system in plugin manifests only supports plain tag names (e.g., `"T-task"`). The plugin manager constructs a regex pattern `<T-task>[\s\S]*?</T-task>` from each name. However, some tags include attributes in their opening element — for example, `<T-task type="think">...</T-task>`. These are not matched by the auto-generated pattern because `<T-task type="think">` ≠ `<T-task>`. Plugins need the ability to specify custom regex patterns for more precise tag stripping.

## What Changes

- **Extend `stripTags` to accept regex pattern strings** in addition to plain tag names. A regex pattern is identified by a leading `/` character (e.g., `"/<T-task\\b[^>]*>[\\s\\S]*?<\\/T-task>/g"`). Plain tag names continue to work unchanged.
- **Update `t-task/plugin.json`** to use the regex pattern `/<T-task\b[^>]*>[\s\S]*?<\/T-task>/g` so that `<T-task type="think">...</T-task>` is properly stripped.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `plugin-core`: `stripTags` array entries can now be regex pattern strings (identified by leading `/`), in addition to plain tag names

## Impact

- `writer/lib/plugin-manager.js` — `getStripTagPatterns()` must parse regex strings vs plain names
- `plugins/t-task/plugin.json` — update `stripTags` to use regex pattern
- No frontend changes needed — frontend strip tags are handled via hooks, not the `stripTags` manifest field

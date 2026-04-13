## 1. Backend — Plugin manager regex support

- [x] 1.1 In `writer/lib/plugin-manager.js` `getStripTagPatterns()`, detect regex pattern entries (leading `/`) and extract the inner pattern instead of wrapping with `escapeRegex`
- [x] 1.2 Add try-catch around regex pattern parsing to handle invalid patterns gracefully (log warning, skip entry)
- [x] 1.3 Verify existing plain tag names (`disclaimer`, `options`, `status`, `user_message`, `UpdateVariable`) continue to work unchanged

## 2. Plugin manifest update

- [x] 2.1 Update `plugins/t-task/plugin.json` `stripTags` to use regex: `"/<T-task\\b[^>]*>[\\s\\S]*?<\\/T-task>/g"`
- [x] 2.2 Verify T-task tags with attributes (e.g., `<T-task type="think">`) are stripped correctly by the backend

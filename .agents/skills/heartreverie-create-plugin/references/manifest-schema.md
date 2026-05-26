# Plugin Manifest Schema (`plugin.json`)

## Table of Contents

- [Required Fields](#required-fields)
- [Plugin Types](#plugin-types)
- [Optional Fields](#optional-fields)
- [Prompt Fragments](#prompt-fragments)
- [Tag Strip Patterns](#tag-strip-patterns)
- [Parameters](#parameters)
- [Plugin Settings](#plugin-settings)
- [Security Constraints](#security-constraints)
- [Complete Examples by Type](#complete-examples-by-type)

---

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique identifier. **Must match directory name exactly.** |
| `displayName` | `string` | Human-readable label rendered in the reader sidebar and `/settings/plugins/<name>` heading. Any non-empty Unicode string (trim must not yield `""`). The loader rejects manifests where `displayName` is missing, non-string, or whitespace-only. |
| `version` | `string` | Semver (e.g., `"1.0.0"`) |
| `description` | `string` | Brief description of the plugin's purpose |
| `type` | `string` | One of: `prompt-only`, `full-stack`, `hook-only`, `frontend-only` |

## Plugin Types

| Type | When to Use | Has Prompt? | Has Backend? | Has Frontend? |
|------|-------------|:-----------:|:------------:|:-------------:|
| `prompt-only` | Only injects text into the LLM system prompt | ✅ | ❌ | ❌ |
| `full-stack` | Needs prompt fragments + backend processing + frontend rendering (or any combination) | ✅/❌ | ✅/❌ | ✅/❌ |
| `hook-only` | Only backend lifecycle hooks, no prompt injection | ❌ | ✅ | ❌ |
| `frontend-only` | Only browser-side rendering | ❌ | ❌ | ✅ |

> **Note:** The `type` field is a semantic annotation. The system does not enforce capability restrictions based on type — a `prompt-only` plugin with a `frontendModule` will still load. Use type accurately for documentation purposes.

## Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `promptFragments` | `array` | Markdown files to inject as Vento template variables |
| `backendModule` | `string` | Path to backend module (relative to plugin dir), e.g., `"./handler.js"` or `"./handler.ts"` |
| `frontendModule` | `string` | Path to frontend ES module, relative to plugin dir. The backend resolves the declared path inside the plugin directory and serves it at `/plugins/<name>/<path>`. **However, the reader currently auto-imports `/plugins/<name>/frontend.js`** — so for the frontend module to actually load you must use `"./frontend.js"`. The declared path field is honored by the static server but not yet by the auto-loader. |
| `frontendStyles` | `array<string>` | Relative paths to CSS files injected into the frontend `<head>` as `<link rel="stylesheet">` elements. Each entry must end with `.css`, must not be absolute, and must not contain `..` segments. |
| `frontendImports` | `array<string>` | Relative paths to sibling `.js` modules that `frontendModule` statically imports. Required for the static-server allowlist: the wildcard `.js` route only serves files declared in `frontendModule` ∪ `frontendImports`. See [Frontend Imports (allowlist)](#frontend-imports-allowlist). |
| `tags` | `array<string>` | XML tag names managed by this plugin (used for metadata/API response) |
| `promptStripTags` | `array` | Tags/regex to strip from `previousContext` when building prompts |
| `displayStripTags` | `array` | Tags/regex to strip from frontend display |
| `parameters` | `array` | Custom Vento template parameters exposed to the template editor |
| `actionButtons` | `array` | Reader-mounted action buttons (each with `id`, `label`, optional `icon`, `tooltip`, `priority`, `visibleWhen`). Renders in `PluginActionBar` between `UsagePanel` and `ChatInput`; clicks dispatch the `action-button:click` frontend hook. See [`hook-api.md`](./hook-api.md#action-button-click-context) for the full click-context contract and [`docs/plugin-system.md`](../../../../docs/plugin-system.md#動作按鈕action-buttons) for the manifest field reference. |
| `hooks` | `array` | Parallel dispatch declarations for backend hook stages. Each entry specifies a `stage` and opt-in parallel fields. See [Hooks Parallel Dispatch](#hooks-parallel-dispatch). |
| `settingsSchema` | `object` | HeartReverie schema dialect describing user-configurable settings (must be `type: "object"` with `properties` AND `x-schema-version: 1`). When present, the system exposes settings endpoints and a settings page in the reader. See [Plugin Settings](#plugin-settings). |

## Prompt Fragments

Each entry in the `promptFragments` array:

```json
{ "file": "./my-instructions.md", "variable": "my_var", "priority": 100 }
```

| Property | Required | Description |
|----------|----------|-------------|
| `file` | ✅ | Path to Markdown file, relative to plugin directory |
| `variable` | ❌ | Vento variable name — accessible as `{{ my_var }}` in `system.md` |
| `priority` | ❌ | Sort order (default: 100). Lower = earlier in prompt |

### Variable vs No Variable

- **With `variable`**: Becomes a named Vento variable. Use `{{ variable_name }}` in `system.md`.
- **Without `variable`**: Added to the `plugin_fragments` array. Access via `{{ for item of plugin_fragments }}`.

### Priority Conventions

| Priority | Purpose |
|----------|---------|
| 10 | Start of prompt — framing instructions |
| 100 | Normal — standard instructions (default) |
| 800 | Reinforcement — re-emphasize at end of prompt |
| 900 | End of prompt — final instructions |

### Adding to system.md

After creating a prompt fragment with a named variable, add `{{ variable_name }}` to `system.md` at the desired position. The template engine replaces it with the file content at render time.

## Tag Strip Patterns

Both `promptStripTags` and `displayStripTags` accept the same two formats:

### Plain Text (Simple Tags)

Provide the tag name as a string. The system auto-wraps it as `<tagname>[\s\S]*?</tagname>`:

```json
{
  "promptStripTags": ["options", "status"],
  "displayStripTags": ["user_message", "imgthink"]
}
```

Use for tags without attributes (e.g., `<options>...</options>`).

### Regex (Tags with Attributes)

Start the pattern with `/` and end with `/flags`. The system parses it as a `RegExp`:

```json
{
  "promptStripTags": ["/<T-task\\b[^>]+>[\\s\\S]*?<\\/T-task>/g"],
  "displayStripTags": ["/<T-task\\b[^>]+>[\\s\\S]*?<\\/T-task>/g"]
}
```

Use when tags may have attributes (e.g., `<T-task type="think">`).

**Safety notes:**
- Empty patterns (`//g`) are skipped with a warning
- Invalid regex syntax is caught and skipped
- Frontend `displayStripTags` undergo ReDoS safety checks; dangerous patterns are skipped

### When to Use Each

| Tag Pattern | Format | Example |
|-------------|--------|---------|
| `<mytag>content</mytag>` | Plain text: `"mytag"` | options, status, user_message |
| `<mytag attr="val">content</mytag>` | Regex: `"/<mytag\\b[^>]+>...`  | T-task |

## Frontend Styles

The `frontendStyles` array lists CSS files to inject into the frontend `<head>` as `<link rel="stylesheet">` elements. Styles are loaded **before** JS modules so component rendering sees the correct styles on first paint.

- **Format**: Array of paths relative to the plugin directory (e.g., `"./styles/panel.css"`)
- **Serving**: Each file is served at `/plugins/<name>/<path>` and injected as a `<link>` tag
- **Load order**: Injected before JS frontend modules
- **Validation**:
  - Each entry must end with `.css`
  - Absolute paths are rejected
  - `..` segments are rejected
  - The resolved path must remain within the plugin directory

Example:

```json
{
  "frontendStyles": ["./styles/panel.css", "./styles/toast.css"]
}
```

## Frontend Imports (allowlist)

The `frontendImports` array declares **every sibling `.js` module** that `frontendModule` (or any module reachable from it) statically `import`s. The server consults this list — together with `frontendModule` — to build a per-plugin allowlist consumed by the wildcard route `GET /plugins/:plugin/:path{.+\.js}`. Any `.js` file that physically exists in the plugin directory but is **not** declared here returns `404` instead of being served as `application/javascript`.

- **Format**: Array of paths relative to the plugin directory (forward slashes, e.g. `"./lightbox.js"` or `"sub/helper.js"`). The validator normalizes entries to forward-slash form with no leading `./`.
- **When to declare**: Any time `frontend.js` (or a file it imports) contains `import ... from './something.js'`, add `"./something.js"` here. Imports from `/plugins/_shared/*` do **not** need to be declared (the shared route is independent of this allowlist).
- **Validation** (entries that fail any check are logged with `log.warn` and silently dropped; the plugin still loads):
  - Must be a non-empty string ending in `.js` (case-insensitive)
  - Must not be absolute
  - Must not contain `..` segments (under `/` or `\`)
  - Must not contain `\`, `#`, `?`, or `%`
  - Must not contain dotfile segments (segments starting with `.`)
  - Must resolve to an existing regular file inside the plugin directory
  - Symlinks whose `realPath` lies outside the plugin directory are rejected
- **Deduplication**: Entries resolving to the same absolute path are collapsed.

Example:

```json
{
  "name": "image-gen",
  "displayName": "圖片生成",
  "frontendModule": "./frontend.js",
  "frontendImports": ["./frontend-lightbox.js", "./util/exif.js"]
}
```

In `frontend.js`:

```js
import { openLightbox } from './frontend-lightbox.js';
import { readExif } from './util/exif.js';
```

Without the `frontendImports` declaration, the browser's `import` request for `/plugins/image-gen/frontend-lightbox.js` would return `404` and the module would fail to load.

## Parameters

The `parameters` array declares custom Vento template parameters that appear in the frontend template editor:

```json
{
  "parameters": [
    { "name": "my_param", "type": "string", "description": "Description for the editor" }
  ]
}
```

| Property | Required | Description |
|----------|----------|-------------|
| `name` | ✅ | Parameter name (used in Vento templates as `{{ name }}`) |
| `type` | ❌ | Data type (default: `"string"`) |
| `description` | ❌ | Shown in the frontend template editor |

> Note: Prompt fragment variables are automatically registered as parameters. Only use the `parameters` field for non-fragment variables that your backend hook injects into the template context.

## Plugin Settings

A plugin declares user-configurable settings by adding a `settingsSchema` object to its manifest. The schema MUST be an object schema (`type: "object"` with a `properties` record) AND MUST declare `x-schema-version: 1` at its root. Any other shape — or any unsupported `x-schema-version` — is rejected at load time.

When `settingsSchema` is present:

- `GET /api/plugins` reports `hasSettings: true` for the plugin.
- The reader shows a settings tab at `/settings/plugins/<name>` with an auto-generated form (writer mode only; reader-only deployments respond 404).
- `GET /api/plugins/<name>/settings-schema` returns the full schema (including every `x-*` keyword, passed through unchanged).
- `GET /api/plugins/<name>/settings` returns `{ ...defaults from schema, ...saved values }`, with `writeOnly` fields masked to `null` and any `x-previous-names` migration applied in-memory. If the on-disk file violates the current schema, a non-blocking `x-legacy-warnings: ValidationError[]` field is included.
- `PUT /api/plugins/<name>/settings` validates with two-phase validation (see below) and writes to `playground/_plugins/<name>/config.json`.
- `POST /api/plugins/<name>/settings/validate` runs validation only, never writes — always 200.
- `GET /api/plugins/<name>/settings/schema-meta` returns `{ schemaVersion, pathRoots, formats }`.

### Supported Keywords

| Category | Keywords |
|----------|----------|
| Type | `string`, `number`, `integer`, `boolean`, `array`, `object`, `null` |
| Numeric | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` |
| String | `minLength`, `maxLength`, `pattern` (ECMAScript regex), `format` |
| Array | `items`, `minItems`, `maxItems`, `uniqueItems` |
| Object | `properties`, `required`, `additionalProperties` (boolean only) |
| Composition | `enum`, `const` |
| Annotation | `title`, `description` (plain text, **never** Markdown), `default`, `writeOnly` |

The `format` whitelist is exactly `path`, `color`, `url`, `email`, `uuid`. Any other `format` value is silently ignored by the validator. **Model secrets with `writeOnly: true`, NOT a `format` keyword.**

### HeartReverie `x-*` Extensions

| Keyword | Purpose |
|---------|---------|
| `x-schema-version: 1` | **Mandatory.** Schema dialect version. Phase 1 accepts only `1`. Absent = auto-migrate with a one-time warn log. Other values cause settings to degrade to schema defaults; `PUT` returns 409. |
| `x-show-when` | Conditional visibility. Shape: `{ field: string, equals \| notEquals \| in: JSONValue \| JSONValue[] }`. `field` MUST be a sibling property in the same object. The property MUST NOT also appear in the parent's `required` array (dead config). Validator ignores this keyword; it is UI-only. |
| `x-options-url` | `select` / `multi-select` / `combobox` widgets fetch options from this URL with passphrase headers. Response shape: `{ options: [{ value, label }] }`. Failure falls back to declared `enum`. |
| `x-path-roots` | Narrows `format: "path"` allowlist for one field. **Subset-only** of the hard-coded set (`playground/lore/`, `playground/chapters/`, `playground/_plugins/<pluginName>/`). Empty intersection is rejected at load time. |
| `x-previous-names: string[]` | Field rename migration. `GET` maps old key → new key in-memory; first successful `PUT` persists the new layout. Cannot collide across two properties. Cannot list the property's own current name. |
| `x-legacy: true` | Top-level flag. Lets `config.json` keep keys not described by the current schema; they are relocated under a top-level `x-legacy` namespace on next successful PUT. The `x-legacy` namespace is never returned in any HTTP response. |

`writeOnly: true` semantics: `GET` responds with `null` for masked fields; `PUT` short-circuits a `null` value to "keep existing" BEFORE any type check (so the round-trip does not require resending the secret). `""` clears the value; other values are validated and persisted.

### Authoring Rules

- **Always declare `x-schema-version: 1`.** Don't rely on auto-migration.
- **Plain-text `description` only.** No Markdown, no `x-description-md` variant.
- **Mark every credential `writeOnly: true`.** Never use `format: "password"` — it is not on the whitelist and would be silently ignored.
- **Never combine `required` and `x-show-when`** on the same property — load-time rejection.
- **`x-show-when.field` must be a sibling.** No dotted paths, no `$ref`.
- **`x-path-roots` only narrows**, never widens. Empty intersection breaks the plugin at load.
- **Use `enum` for single-choice** (`type: string`); **`type: array, items: { enum: [...] }` for multi-choice**; **`type: array, items: { type: string }` for free-form tags**.
- **Default the plugin's own sandbox** in `x-path-roots`: `["playground/_plugins/<pluginName>/"]` rather than relying on the implicit hard-coded list.

### Widget Resolution

The reader's `<SchemaField>` resolves a widget per property via `WidgetRegistry`. Resolution uses priority-based matching; the highest non-zero match wins. Built-in widgets (high → low priority):

| Widget | Match |
|--------|-------|
| `multi-select` | `type: array` + `items.enum` OR `items.x-options-url` |
| `repeater` | `type: array` + `items.type: object` |
| `path-picker` | `format: "path"` |
| `range-number` | `type: number\|integer` + both `minimum` AND `maximum` |
| `masked-secret` | `writeOnly: true` |
| `combobox` | `type: string` + `x-options-url` (no `enum`) |
| `select` | `type: string` + `enum` |
| `color` | `format: "color"` |
| `tags` | `type: array` + `items.type: string` (no `enum`, no object/array items) |
| `object-fieldset` | `type: object` |
| `checkbox` | `type: boolean` |
| `number` | `type: number\|integer` |
| `text` | fallback |

**Plugins cannot register custom widgets in phase 1.** Future phases may expose a widget registry API; for now, design your schema around the built-in widget set.

### Two-Phase Validation (`_changedPaths`)

`PUT` body may include a top-level reserved `_changedPaths: string[]` field (stripped before persisting). The server **always** also computes a diff between the incoming body and the on-disk `config.json`. The blocking scope is the union of the actual diff paths and the provided `_changedPaths`. Errors at-or-under the blocking scope are blocking (400); other errors degrade to non-blocking warnings (200 + `warnings`). The frontend uses this to let the user save Field A even if Field B already had a pre-existing schema violation on disk.

### Error Envelope

Both 200 and 400 responses share the shape `{ errors: ValidationError[], warnings: ValidationError[] }`. `ValidationError` = `{ path: "items[0].name", keyword: "pattern", messageKey: "pattern", params: {...} }`. `messageKey` is for client-side i18n; the project ships a zh-TW table for every emitted key.

### Example: settings-aware plugin

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
      "negativeKeywords": {
        "type": "array",
        "title": "Negative Prompt Keywords",
        "items": { "type": "string" }
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

Backend handlers can read/write the saved settings through `registerRoutes`'s `getSettings` / `saveSettings` helpers — see [`hook-api.md`](./hook-api.md#registerroutes-export).

### Hooks Parallel Dispatch

The `hooks` array declares per-stage parallel dispatch behavior for backend hooks. Each entry maps to a lifecycle stage and opts in to parallel execution under a `readOnly` contract.

| Property | Type | Required | Description |
|----------|------|:--------:|-------------|
| `stage` | `string` | ✅ | Target stage. Enum: `prompt-assembly`, `pre-llm-fetch`, `post-response`, `response-stream` |
| `parallel` | `boolean` | ❌ | Enable parallel dispatch. Default `false` (but `readOnly:true` implies `true` — see Track B) |
| `readOnly` | `boolean` | ❌ | Declares the handler does not write to context (parallel-safety contract) |
| `concurrency` | `integer` | ❌ | Max parallel limit. The dispatcher takes `Math.min(...)` across all entries in the same stage |
| `dependsOn` | `string[]` | ❌ | Plugin names this entry depends on. Topological sort within the same stage; cycles or unknown names fall back to priority-only |

**Track B default-on**: An entry with `readOnly: true` and no explicit `parallel` is treated as `parallel: true`. Opt out with `"parallel": false`.

**Stage restrictions**: Only `prompt-assembly`, `pre-llm-fetch`, `post-response`, and `response-stream` are parallel-eligible. `pre-write` and `strip-tags` are always serial (and `strip-tags` is rejected entirely at load time — see manifest schema). For `response-stream`, `parallel: true` **must** be accompanied by `readOnly: true` — otherwise the entry is rejected (not coerced). `pre-llm-fetch` is observation-only; its `messages` and `requestMetadata` are deep-frozen at dispatch, so `readOnly: true` is the natural fit.

Example:

```json
{
  "name": "my-analytics",
  "displayName": "分析儀",
  "version": "1.0.0",
  "description": "Post-response analytics via external API",
  "type": "hook-only",
  "backendModule": "./handler.ts",
  "hooks": [
    { "stage": "post-response", "parallel": true, "readOnly": true },
    { "stage": "prompt-assembly", "readOnly": true, "dependsOn": ["context-compaction"] }
  ]
}
```

### Name Validation

- Must not contain: `..`, `\0`, `/`, `\`
- Must match the directory name exactly
- Validated by `isValidPluginName()` on load

### Path Containment

All file paths (`promptFragments[].file`, `backendModule`, `frontendModule`) are resolved with `path.resolve()` and must remain within the plugin directory. Paths like `../../etc/passwd` are rejected.

### Frontend Module Access

The wildcard `.js` route `GET /plugins/:plugin/:path{.+\.js}` only serves files that appear in the per-plugin allowlist — the normalized union of `frontendModule` and each validated entry in `frontendImports`. Any `.js` file physically present in the plugin directory but not declared in the manifest returns `404` without touching disk. Request paths containing a literal backslash, dotfile segments, or `..` traversal are also rejected before any filesystem access. See [Frontend Imports (allowlist)](#frontend-imports-allowlist).

---

## Complete Examples by Type

### prompt-only — Simple (single fragment)

```json
{
  "name": "de-robotization",
  "displayName": "去機械化",
  "version": "1.0.0",
  "description": "De-robotization prompt fragment",
  "type": "prompt-only",
  "promptFragments": [
    { "file": "./de-robotization.md", "variable": "de_robotization", "priority": 100 }
  ]
}
```

### prompt-only — Multi-fragment with Reinforcement

```json
{
  "name": "writestyle",
  "displayName": "寫作風格",
  "version": "1.0.0",
  "description": "Writing style instructions for the LLM",
  "type": "prompt-only",
  "promptFragments": [
    { "file": "./writestyle.md", "variable": "writestyle", "priority": 100 },
    { "file": "./writestyle-reinforce.md", "variable": "writestyle_reinforce", "priority": 800 }
  ]
}
```

### prompt-only — With Tag Stripping (Regex)

```json
{
  "name": "t-task",
  "displayName": "質感任務",
  "version": "1.0.0",
  "description": "T-task prompt fragment with frontend tag stripping",
  "type": "prompt-only",
  "promptFragments": [
    { "file": "./T-task.md", "variable": "t_task", "priority": 100 },
    { "file": "./T-task_think_format.md", "variable": "t_task_think_format", "priority": 100 }
  ],
  "displayStripTags": ["/<T-task\\b[^>]+>[\\s\\S]*?<\\/T-task>/g"],
  "tags": ["T-task"],
  "promptStripTags": ["/<T-task\\b[^>]+>[\\s\\S]*?<\\/T-task>/g"]
}
```

### full-stack — Prompt + Frontend + Tags

```json
{
  "name": "options",
  "displayName": "選項面板",
  "version": "1.0.0",
  "description": "Options panel extraction, rendering, and prompt fragment",
  "type": "full-stack",
  "promptFragments": [
    { "file": "./options.md", "variable": "options", "priority": 100 }
  ],
  "frontendModule": "./frontend.js",
  "tags": ["options"],
  "promptStripTags": ["options"]
}
```

### full-stack — Backend + Frontend + Tags + Prompt

```json
{
  "name": "state",
  "displayName": "狀態追蹤",
  "version": "1.0.0",
  "description": "A complete state tracking system.",
  "type": "full-stack",
  "backendModule": "./handler.js",
  "frontendModule": "./frontend.js",
  "tags": ["UpdateVariable", "update"],
  "promptStripTags": ["UpdateVariable"],
  "promptFragments": [
    { "file": "./state.md", "variable": "state", "priority": 100 }
  ]
}
```

### full-stack — Backend + Tags + Display Stripping (No Prompt, No Frontend)

```json
{
  "name": "user-message",
  "displayName": "使用者訊息",
  "version": "1.0.0",
  "description": "User message lifecycle: wrap input in tags, strip from context and display",
  "type": "full-stack",
  "backendModule": "./handler.ts",
  "displayStripTags": ["user_message"],
  "tags": ["user_message"],
  "promptStripTags": ["user_message"]
}
```

### frontend-only

```json
{
  "name": "response-notify",
  "displayName": "回應通知",
  "version": "1.0.0",
  "description": "Browser notification when LLM response generation completes",
  "type": "frontend-only",
  "frontendModule": "./frontend.js"
}
```

### full-stack — Prompt + Backend + Both Strip Types

```json
{
  "name": "context-compaction",
  "displayName": "脈絡壓縮",
  "version": "1.0.0",
  "description": "Tiered context compaction via inline chapter summaries",
  "type": "full-stack",
  "promptFragments": [
    { "file": "./chapter-summary-instruction.md", "variable": "context_compaction", "priority": 800 }
  ],
  "promptStripTags": ["chapter_summary"],
  "displayStripTags": ["chapter_summary"],
  "backendModule": "./handler.ts"
}
```

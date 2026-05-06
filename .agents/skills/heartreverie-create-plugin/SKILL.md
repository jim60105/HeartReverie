---
name: heartreverie-create-plugin
description: Create a new plugin for the HeartReverie plugin system. Use when the user wants to create a plugin, add a new plugin, scaffold a plugin, or build a plugin for this project. Guides through plugin type selection, manifest creation, prompt fragments, backend/frontend modules, tag configuration, and README generation.
---

# Create Plugin

Create a new plugin for the manifest-driven plugin system. Plugins live in `plugins/<name>/` with a `plugin.json` manifest that declares capabilities.

For full manifest field reference, read `references/manifest-schema.md`.

---

## Step 1: Understand the Plugin

Determine what the plugin does. Derive:

- **Name**: kebab-case, e.g., `my-plugin`. Must be valid: no `..`, `\0`, `/`, `\`.
- **Directory**: `plugins/<name>/`
- **Purpose**: What it adds to the system

## Step 2: Determine Plugin Type

Select type based on what the plugin needs:

| Type | Use When |
|------|----------|
| `prompt-only` | Only injects text into the LLM system prompt |
| `full-stack` | Needs any combination of: prompt fragments, backend hooks, frontend rendering |
| `hook-only` | Only needs backend lifecycle hooks (no prompt injection) |
| `frontend-only` | Only browser-side rendering |

When uncertain, ask the user to choose from the four types.

## Step 3: Create the Manifest

Create `plugins/<name>/plugin.json` with required fields:

```json
{
  "name": "<name>",
  "version": "1.0.0",
  "description": "Brief description",
  "type": "<type>"
}
```

Then add type-appropriate optional fields per the patterns below.

### Pattern: prompt-only

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My prompt instructions",
  "type": "prompt-only",
  "promptFragments": [
    { "file": "./instructions.md", "variable": "my_plugin", "priority": 100 }
  ]
}
```

### Pattern: full-stack (prompt + frontend + tags)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My full-stack plugin",
  "type": "full-stack",
  "promptFragments": [
    { "file": "./instructions.md", "variable": "my_plugin", "priority": 100 }
  ],
  "frontendModule": "./frontend.js",
  "tags": ["mytag"],
  "promptStripTags": ["mytag"],
  "displayStripTags": ["mytag"]
}
```

### Pattern: full-stack (backend + frontend + tags, no prompt)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My processing plugin",
  "type": "full-stack",
  "backendModule": "./handler.js",
  "frontendModule": "./frontend.js",
  "tags": ["mytag"],
  "promptStripTags": ["mytag"]
}
```

### Pattern: hook-only

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My backend hook plugin",
  "type": "hook-only",
  "backendModule": "./handler.js"
}
```

**Critical**: The `name` field must match the directory name exactly.

For all fields and detailed examples, read `references/manifest-schema.md`.

## Step 4: Create Prompt Fragments (if applicable)

For plugins with `promptFragments`:

1. Create each Markdown file declared in the manifest (e.g., `plugins/<name>/instructions.md`)
2. Write the LLM instructions content
3. If the fragment has a `variable`, add `{{ variable_name }}` to `system.md` at the desired position

Priority guide:
- `10` — Start of prompt (framing)
- `100` — Normal (default)
- `800` — Reinforcement (re-emphasize late in prompt)
- `900` — End of prompt (final instructions)

For reinforcement patterns (two fragments at different priorities), see the writestyle plugin in `references/manifest-schema.md`.

## Step 5: Configure Tags (if applicable)

If the LLM outputs custom XML tags (e.g., `<mytag>...</mytag>`):

1. Add tag names to `tags` array
2. Add to `promptStripTags` — strip from `previousContext` so tags don't echo back to LLM
3. Add to `displayStripTags` — strip from frontend display (only if the tag should not be visible to readers)

**Plain text** for simple tags: `"mytag"` → auto-wrapped as `<mytag>[\s\S]*?</mytag>`

**Regex** for tags with attributes:

```json
"/<mytag\\b[^>]+>[\\s\\S]*?<\\/mytag>/g"
```

Usually `promptStripTags` and `displayStripTags` use the same patterns. They differ when a tag should be stripped from the LLM prompt but kept visible in the reader (or vice versa).

## Step 6: Create Backend Module (if applicable)

For plugins with `backendModule`, create the handler file. Backend modules register handlers via a context object. The module must export a `register` function that receives `{ hooks, logger }` — a `PluginHooks` wrapper and a scoped `Logger`.

**JavaScript (`handler.js`):**

```javascript
export function register({ hooks, logger }) {
  hooks.register("post-response", async (context) => {
    const log = context.logger ?? logger;
    const { content, storyDir, rootDir } = context;
    log.info("Processing response", { contentLength: content.length });
    // Process the LLM response
  }, 100);
}
```

**TypeScript (`handler.ts`):**

```typescript
import type { PluginRegisterContext } from "../../writer/types.ts";

export function register({ hooks, logger }: PluginRegisterContext): void {
  hooks.register("post-response", async (context) => {
    const log = context.logger ?? logger;
    const content = context.content as string;
    log.info("Processing response", { contentLength: content.length });
    // Process the LLM response
  }, 100);
}
```

For the 3 active hook stages and their context parameters, read `references/hook-api.md`.

Backend code style: ESM, **double quotes**, semicolons, `async/await`, JSDoc comments. Use `context.logger ?? logger` pattern in hook handlers for request-scoped logging.

The same module MAY additionally export `registerRoutes(context)` (sync or async) to mount custom HTTP endpoints under `/api/plugins/<name>/*` — useful for proxying external services or backing `x-options-url` dropdowns in the settings page. See [`references/hook-api.md`](./references/hook-api.md#registerroutes-export) for the full `PluginRouteContext` contract.

## Step 7: Create Frontend Module (if applicable)

For plugins with `frontendModule`, create the module using the Extract → Placeholder → Reinsert pattern:

```javascript
export function register(hooks) {
  hooks.register('frontend-render', (context) => {
    let index = 0;
    context.text = context.text.replace(
      /<mytag>([\s\S]*?)<\/mytag>/gi,
      (_match, inner) => {
        const placeholder = `<!--MYTAG_BLOCK_${index++}-->`;
        const html = renderMyTag(inner);
        context.placeholderMap.set(placeholder, html);
        return placeholder;
      }
    );
  }, 100);
}

function renderMyTag(content) {
  return `<div class="my-component">${escapeHtml(content)}</div>`;
}
```

Key points:
- Frontend handlers are **synchronous** (no `async`)
- Use unique placeholder names (include plugin name prefix)
- Import `escapeHtml` from `'/js/utils.js'` for safe rendering
- Frontend code style: ESM, **single quotes**, no build step, no framework

### Notification Hook

Frontend modules can also register a `notification` hook, dispatched by the system on events such as `chat:done`. The context is `{ event, data, notify }`:

- `event` (string): Event name (e.g., `'chat:done'`)
- `data` (object): Event-specific data
- `notify` (function): Call to show a notification — accepts `{ title, body?, level?, position?, channel?, duration? }`

Example (from the `response-notify` plugin):

```javascript
export function register(hooks) {
  hooks.register('notification', (context) => {
    if (context.event !== 'chat:done') return;
    if (typeof context.notify !== 'function') return;

    const channel = document.visibilityState === 'hidden' ? 'auto' : 'in-app';
    context.notify({
      title: '故事生成完成',
      body: '新的章節已經寫入完成',
      level: 'success',
      channel,
    });
  }, 100);
}
```

For the full frontend hook API, read `references/hook-api.md`.

## Step 8: Add an Action Button (optional)

Action buttons let a plugin contribute an interactive button to the reader's main layout (between `UsagePanel` and `ChatInput`). Clicking the button dispatches the `action-button:click` frontend hook for the owning plugin, where the handler typically calls `context.runPluginPrompt(...)` to run a plugin-owned prompt file through the same LLM pipeline as normal chat — optionally appending the response (wrapped in a tag) to the latest chapter.

Ask the user whether the plugin should expose an action button. If **no**, skip this step. If **yes**, gather:

- **Button id** (kebab-case, matching `^[a-z0-9-]+$`, unique within the plugin) — e.g. `recompute-state`
- **Label** (1..40 chars, often emoji + zh-TW text) — e.g. `🧮 重算狀態`
- **`visibleWhen`** — choose `"last-chapter-backend"` (only on the last chapter while in backend mode; default) or `"backend-only"` (any backend-mode chapter)
- **Prompt file name** (optional, but typical) — e.g. `recompute.md`. Required when the handler will call `runPluginPrompt`.
- **`appendTag`** (optional) — XML tag name used when appending the response to the chapter (matching `^[a-zA-Z][a-zA-Z0-9_-]{0,30}$`). Required when the handler passes `{ append: true, ... }` to `runPluginPrompt`.

Then emit the following stubs:

### 8a. Manifest descriptor

Add an `actionButtons` entry to `plugin.json`:

```json
{
  "actionButtons": [
    {
      "id": "<button-id>",
      "label": "<label>",
      "tooltip": "<short tooltip>",
      "priority": 100,
      "visibleWhen": "last-chapter-backend"
    }
  ]
}
```

The button id must be unique within the plugin; duplicates are dropped by the loader with a warning.

### 8b. Click handler in `frontend.js`

Extend the plugin's `register(hooks)` with an `action-button:click` handler. Always filter by `buttonId` so the handler only runs for its own button — even though the dispatcher already filters by plugin, an explicit guard keeps the code safe if the plugin later adds a second button:

```javascript
hooks.register('action-button:click', async (context) => {
  if (context.buttonId !== '<button-id>') return;

  try {
    await context.runPluginPrompt('<prompt-file>.md', {
      append: true,
      appendTag: '<AppendTag>',
    });
    context.reload();
    context.notify({
      title: '<完成標題>',
      level: 'info',
    });
  } catch (err) {
    context.notify({
      title: '<失敗標題>',
      body: err?.message ?? String(err),
      level: 'error',
    });
  }
}, 100);
```

Notes:

- The `pluginName` for `runPluginPrompt` is auto-curried into `context`; the handler MUST NOT pass it.
- `context` does **not** expose `appendToLastChapter`. To write to the chapter file, use `runPluginPrompt({ append: true, appendTag })` and let the backend handle the atomic append + `post-response` dispatch.
- Frontend handlers for this stage are **async** — feel free to `await` inside.

### 8c. Stub prompt file

Create `plugins/<name>/<prompt-file>.md`. The template MUST emit at least one `{{ message "user" }}…{{ /message }}` block (plain text in front of any `{{ message }}` block is treated as `system`). Minimal stub:

```vento
{{ message "system" }}
<!-- Describe the task for the LLM here. -->
{{ /message }}

{{ message "user" }}
<!-- Reference the latest chapter via {{ previous_context }} or any plugin variable. -->
Latest chapter:
{{ previous_context }}
{{ /message }}
```

Available variables include the core set (`previous_context`, `user_input` (defaults to `""` for plugin actions), `isFirstRound`, `series_name`, `story_name`, `plugin_fragments`), all `lore_*` variables, and any dynamic variables exported by `getDynamicVariables()` from any plugin's backend module. If you need extra inputs from the click handler, pass them through `runPluginPrompt`'s `extraVariables: { ... }` option (scalar values only).

### 8d. README mention

Add a short usage paragraph to the plugin's `README.md` describing what the button does and when it appears.

## Step 8.5: Add Plugin Settings (optional)

If the plugin needs user-configurable values (API endpoints, secret keys, dropdown selections, allow-lists), declare a `settingsSchema` in the manifest. The reader auto-renders a settings page at `/settings/plugins/<name>` and exposes `GET`/`PUT /api/plugins/<name>/settings` plus `GET /api/plugins/<name>/settings-schema`. Saved values land in `playground/_plugins/<name>/config.json`.

Ask: **Does the user need to change anything at runtime without editing the plugin source?** If yes, add a `settingsSchema`.

The schema MUST be `type: "object"` with a `properties` record (other shapes are rejected at load time). Each property maps to an input widget — see the field-type table in [`references/manifest-schema.md`](./references/manifest-schema.md#plugin-settings).

```json
"settingsSchema": {
  "type": "object",
  "properties": {
    "endpoint":   { "type": "string",  "title": "API Endpoint", "default": "https://api.example.com" },
    "apiKey":     { "type": "string",  "title": "API Key", "format": "password" },
    "model":      { "type": "string",  "title": "Model", "enum": ["small", "medium", "large"] },
    "samplers":   { "type": "array",   "title": "Allowed Samplers", "items": { "type": "string" }, "x-options-url": "/api/plugins/<name>/proxy/samplers" },
    "blocklist":  { "type": "array",   "title": "Blocked Keywords", "items": { "type": "string" } },
    "enabled":    { "type": "boolean", "default": true }
  }
}
```

Backend handlers read settings via the `getSettings()` helper inside `registerRoutes(context)`; mutations go through `saveSettings(...)` (it validates against the schema before writing).

Hooks running outside `registerRoutes` (e.g. `post-response`) can fetch settings through the same `PluginManager` API the routes use — typically by calling a small helper your plugin exposes, or by reading the JSON file directly under `<rootDir>/playground/_plugins/<name>/config.json`.

## Step 9: Generate README.md

Create `plugins/<name>/README.md` in Traditional Chinese (zh-TW):

- Use full-width punctuation（，、。：；「」）
- Add space between Chinese and alphanumeric characters
- Sections: `概述`、`manifest 欄位說明`、`檔案說明`、`使用方式` or `運作方式`

Template:

```markdown
# <name>

## 概述

<Description in zh-TW>

## manifest 欄位說明

| 欄位 | 說明 |
|------|------|
| ... | ... |

## 檔案說明

| 檔案 | 說明 |
|------|------|
| `plugin.json` | Plugin manifest |
| ... | ... |

## 使用方式

<Usage instructions in zh-TW>
```

## Step 10: Validate

Run these checks before considering the plugin complete:

1. **Name match**: `plugin.json` `name` field matches directory name
2. **Valid JSON**: `plugin.json` parses without errors
3. **File existence**: All files referenced in manifest exist (`promptFragments[].file`, `backendModule`, `frontendModule`)
4. **Path safety**: All file paths resolve within `plugins/<name>/` (no `../` traversal)
5. **system.md integration**: If prompt fragments use named variables, confirm `{{ variable_name }}` exists in `system.md`
6. **`settingsSchema` validity** (if present): top-level must be `type: "object"` with a `properties` record; otherwise it is silently ignored at load time
7. **Run tests**: `deno test --allow-read --allow-write --allow-env --allow-net` to verify nothing is broken

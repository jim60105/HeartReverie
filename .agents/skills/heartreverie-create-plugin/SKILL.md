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
  "displayStripTags": ["mytag"],
  "hooks": [
    { "stage": "frontend-render", "reads": ["text"], "writes": ["text", "placeholderMap"] }
  ]
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
  "promptStripTags": ["mytag"],
  "hooks": [
    { "stage": "post-response", "writes": ["content"] },
    { "stage": "frontend-render" }
  ]
}
```

### Pattern: hook-only

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My backend hook plugin",
  "type": "hook-only",
  "backendModule": "./handler.js",
  "hooks": [
    { "stage": "post-response", "writes": ["content"] }
  ]
}
```

**Critical**: The `name` field must match the directory name exactly.

**`hooks` is mandatory for new plugins.** Enumerate every `hooks.register("<stage>", ...)` call in `register()` here. The loader compares manifest vs runtime registration on startup and **rolls back the plugin load with a `declaredOnly`/`registeredOnly` error** on mismatch. The check also powers the Hook Inspector page (`/settings/hook-inspector`) and the `deno task introspect:hooks` CLI. Use `reads`/`writes` to participate in conflict detection (C1: two plugins writing the same field; C2: read with no writer). Omitting `hooks` entirely puts the plugin in legacy mode (no validation) — only use this for unmaintained third-party plugins during migration.

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

For plugins with `backendModule`, create the handler file. Backend modules register handlers via a context object. The module must export a `register` function that receives `{ hooks, logger, getSettings }` — a `PluginHooks` wrapper, a scoped `Logger`, and a **zero-arg** `getSettings()` (own-plugin only). The same own-plugin `getSettings()` is also present on the `getDynamicVariables(context)` context. `registerRoutes(context)` additionally exposes `saveSettings(values)` (validates against the schema then persists). Backend `getSettings` is NOT cross-plugin — only the frontend `hooks.getSettings(name?)` / `context.getSettings(name?)` can read other plugins' settings.

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

For the active hook stages and their context parameters, read `references/hook-api.md`.

Backend code style: ESM, **double quotes**, semicolons, `async/await`, JSDoc comments. Use `context.logger ?? logger` pattern in hook handlers for request-scoped logging.

The same module MAY additionally export `registerRoutes(context)` (sync or async) to mount custom HTTP endpoints under `/api/plugins/<name>/*` — useful for proxying external services or backing `x-options-url` dropdowns in the settings page. See [`references/hook-api.md`](./references/hook-api.md#registerroutes-export) for the full `PluginRouteContext` contract.

## Step 7: Create Frontend Module (if applicable)

For plugins with `frontendModule`, create the module. The `register` function receives **two** arguments — a per-plugin `hooks` proxy and a `context` object:

```javascript
import { escapeHtml } from '../_shared/utils.js';

export function register(hooks, context) {
  hooks.register('frontend-render', (ctx) => {
    const settings = hooks.getSettings();
    if (settings.enabled === false) return;

    let index = 0;
    ctx.text = ctx.text.replace(
      /<mytag>([\s\S]*?)<\/mytag>/gi,
      (_match, inner) => {
        const placeholder = `<!--MYTAG_BLOCK_${index++}-->`;
        ctx.placeholderMap.set(placeholder, `<div class="my-component">${escapeHtml(inner)}</div>`);
        return placeholder;
      }
    );
  }, 100);
}
```

Key points:

- `register(hooks, context)` — both args are provided. Older plugins that only declare `register(hooks)` keep working.
- `hooks.getSettings(name?)` and `context.getSettings(name?)` both return the live settings snapshot for `name` (defaults to the calling plugin). The reader hydrates settings on boot and, after a ~50 ms debounce on `plugin-settings:changed`, bumps the chapter render epoch — that re-runs render-pipeline hooks (`frontend-render`, `chapter:render:after`, `chapter:dom:ready`) and re-applies `displayStripTags`. The `notification` hook is NOT re-dispatched on settings change.
- `register` MAY be `async` (the loader awaits it before flipping `pluginsReady`).
- `hooks.register(stage, handler, priority?)` — the `originPluginName` is auto-curried by the loader proxy; do NOT pass it manually.
- Frontend handlers are **synchronous** for most stages; `action-button:click` is the exception (async dispatch). Async handlers on synchronous stages are **rejected** by the dispatcher and surface a startup mismatch in Hook Inspector. If you must `await` something inside a sync stage, fire-and-forget via an IIFE:

  ```javascript
  hooks.register('frontend-render', (ctx) => {
    // Sync work that affects ctx must happen here, synchronously.
    queueMicrotask(async () => {
      // Side-effects that don't block the render pipeline.
      await refreshCacheElsewhere();
    });
  });
  ```
- Use unique placeholder names that include the plugin name to avoid collisions.
- Shared utilities live under `/plugins/_shared/`. Import them via relative paths (e.g. `import { escapeHtml } from '../_shared/utils.js';`); the server only serves files under `_shared/` and each plugin's declared `frontendModule` / `frontendStyles`.
- Frontend code style: ESM, **single quotes**, no build step, no framework — plugins ship as raw JS even though the reader itself is a Vue 3 + Vite SPA.

### Frontend Hook Stages (quick reference)

| Stage | Mode | When |
|-------|------|------|
| `frontend-render` | sync | Custom XML extraction → placeholder map (Markdown not yet parsed) |
| `chapter:render:after` | sync | Post-process the rendered token array (chapter HTML chunks); new/edited `html` tokens are re-sanitized by DOMPurify. Context: `{ tokens, rawMarkdown, options }` — story metadata lives in `ctx.options.series` / `ctx.options.story` / `ctx.options.chapterNumber`. **Token shape**: `RenderToken = { type: 'html', content: string } \| { type: 'vento-error', data: ... }` — there are NO markdown-it `text`/`paragraph` tokens here; markdown is already rendered to HTML chunks. To inspect plain text, parse `ctx.rawMarkdown` (the original chapter source) instead of walking tokens. |
| `chapter:dom:ready` | sync | After Vue commits the rendered chapter to the live DOM. Receives `{ container, tokens, rawMarkdown, chapterIndex, series?, story?, chapterNumber? }`. Fires once on mount and again on every `[tokens, renderEpoch, isEditing]` change — handlers MUST be idempotent (clear prior per-container state at the top). Skipped while the chapter editor is open. |
| `chapter:dom:dispose` | sync | Only fires when the previous chapter container is unmounted. NOT one-to-one with `chapter:dom:ready` (no dispose between successive ready events on the same container). Use for final unmount cleanup of long-lived references (Highlight ranges, observers). |
| `chat:send:before` | sync (pipeline) | Before a user message is sent. Context: `{ message, series, story, mode }`. Return a `string` to replace `ctx.message`; return empty string to drop. `ctx.mode` is `'send'` or `'resend'`. |
| `notification` | sync | Lifecycle events (`chat:done`, `chat:error`). Receives `{ event, data, notify }`. |
| `story:switch` / `chapter:change` | sync (informational) | Navigation events; cannot cancel. |
| `action-button:click` | **async** | Triggered by `PluginActionBar`; dispatcher only invokes handlers owned by the button's plugin. |

For the full context-parameter table, settings-aware patterns, and DOMPurify re-sanitization rules, read [`references/hook-api.md`](./references/hook-api.md#frontend-hooks).

### Notification Hook

Frontend modules can register a `notification` hook, dispatched on events like `chat:done`. Context: `{ event, data, notify }`. `notify({ title, body?, level?, position?, channel?, duration? })` shows a toast.

```javascript
export function register(hooks) {
  hooks.register('notification', (ctx) => {
    if (ctx.event !== 'chat:done') return;
    const channel = document.visibilityState === 'hidden' ? 'auto' : 'in-app';
    ctx.notify({ title: '故事生成完成', level: 'success', channel });
  }, 100);
}
```

## Step 8: Add an Action Button (optional)

Action buttons let a plugin contribute an interactive button to the reader's main layout (between `UsagePanel` and `ChatInput`). Clicking the button dispatches the `action-button:click` frontend hook for the owning plugin, where the handler typically calls `context.runPluginPrompt(...)` to run a plugin-owned prompt file through the same LLM pipeline as normal chat — optionally appending the response (wrapped in a tag) to the latest chapter.

Ask the user whether the plugin should expose an action button. If **no**, skip this step. If **yes**, gather:

- **Button id** (kebab-case, matching `^[a-z0-9-]+$`, unique within the plugin) — e.g. `recompute-state`
- **Label** (1..40 chars, often emoji + zh-TW text) — e.g. `🧮 重算狀態`
- **`visibleWhen`** — `"last-chapter-backend"` (default; only on the last chapter while in backend mode) or `"backend-only"` (any backend-mode position where the action bar is mounted). NOTE: the action bar itself is only mounted when chat input would render — i.e. `isBackendMode && (isLastChapter || chapters.length === 0)`. So `"backend-only"` does NOT make a button appear on historical chapters; it only bypasses the per-button last-chapter filter inside that already-mounted bar.
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

Extend the plugin's `register(hooks, context)` with an `action-button:click` handler. The dispatcher already filters handlers by owning plugin, but always guard on `buttonId` so a future second button doesn't trigger the wrong handler:

```javascript
hooks.register('action-button:click', async (ctx) => {
  if (ctx.buttonId !== '<button-id>') return;

  // Optional: stale-cache safety net for the universal `enabled` setting.
  if (hooks.getSettings?.().enabled === false) return;

  // Append/replace require an existing chapter file. On a fresh story
  // (`lastChapterIndex === null`) both modes will reject — bail with a
  // user-visible warning instead of letting runPluginPrompt throw.
  if (ctx.lastChapterIndex === null) {
    ctx.notify({ title: '尚無章節可更新', level: 'warning' });
    return;
  }

  try {
    await ctx.runPluginPrompt('<prompt-file>.md', {
      append: true,
      appendTag: '<AppendTag>',
      // OR: replace: true,                              // mutually exclusive with append
      // OR: extraVariables: { mode: 'fast', count: 3 }, // scalar values only
    });
    await ctx.reload();
    ctx.notify({ title: '<完成標題>', level: 'info' });
  } catch (err) {
    ctx.notify({
      title: '<失敗標題>',
      body: err?.message ?? String(err),
      level: 'error',
    });
    // Do NOT re-throw — the dispatcher always emits its own default
    // error toast on uncaught throws, which would duplicate this notice.
  }
}, 100);
```

Action-button click context (`ctx`):

| Field | Description |
|-------|-------------|
| `buttonId`, `pluginName` | The clicked button's id and owning plugin |
| `series`, `name` | Active story identifiers (always present in backend mode) |
| `storyDir` | Frontend story identifier formatted as `"${series}/${name}"` — relative path-like string, NOT a filesystem path |
| `lastChapterIndex` | 0-based index of the latest chapter (= `chapters.length - 1`), or `null` if no chapters yet |
| `runPluginPrompt(file, opts?)` | Auto-curried with this plugin's name. Returns `{ content, usage, chapterUpdated, chapterReplaced, appendedTag }`. |
| `notify(opts)` | Action-button-specific notify: forwards ONLY `title`, `body`, `level`. `level` allows `'info' \| 'warning' \| 'error'` (NOT `'success'`); `position`, `channel`, and `duration` are dropped — unlike the broader `notification` hook's `notify`. |
| `reload()` | Calls `useChapterNav.reloadToLast()` |

`runPluginPrompt` write modes:

- `{ append: true, appendTag }` — atomic append into the highest-numbered chapter, wrapped as `<appendTag>…</appendTag>`. Result `chapterUpdated: true`, `appendedTag` echoes the tag.
- `{ replace: true }` — atomic overwrite of the highest-numbered chapter (byte-for-byte rollback on abort/error). Result `chapterReplaced: true`. The chapter's pre-write content is exposed to the prompt as the reserved Vento variable `{{ draft }}`. `replace` is mutually exclusive with `append` and rejects when `appendTag` is also set.
- Neither flag — runs the LLM and returns the raw content; the chapter file is untouched.

Notes:

- `pluginName` for `runPluginPrompt` is auto-curried — the handler MUST NOT pass it.
- Action buttons are also gated by the universal `enabled` setting at the API level (`/api/plugins/action-buttons` filters out disabled plugins) and the click path re-checks settings to no-op stale clicks. The explicit `getSettings().enabled === false` check above is still recommended as a safety net.
- `extraVariables` accepts only scalar values (string / number / boolean) and MUST NOT clash with reserved names (`previousContext`, any `lore_*`, `status_data`, `draft`).
- For the full append/replace lifecycle (WS envelope, `post-response` dispatch, rate limit, concurrency lock), see [`docs/plugin-system.md`](../../../docs/plugin-system.md#動作按鈕action-buttons).

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

Backend handlers read settings via the `getSettings()` helper present on every backend register context: `register({ hooks, logger, getSettings })`, `registerRoutes(context)`, and `getDynamicVariables(context)` all receive it. Backend `getSettings()` is **zero-arg, own-plugin only** — it cannot read other plugins' settings. Mutations go through `saveSettings(...)` which is exposed ONLY on `registerRoutes(context)` (it validates against the schema before writing); `register()` and `getDynamicVariables()` cannot persist settings. Avoid reading `playground/_plugins/<name>/config.json` directly — only fall back to it as a last-resort legacy path.

Frontend modules read live settings synchronously via `hooks.getSettings(name?)` or `context.getSettings(name?)` (see [Step 7](#step-7-create-frontend-module-if-applicable)). A successful `PUT /api/plugins/:name/settings` broadcasts `plugin-settings:changed`; after a ~50 ms debounce the reader bumps the chapter render epoch, re-running `frontend-render`, `chapter:render:after`, and `chapter:dom:ready` and re-applying `displayStripTags`. `notification` is not re-dispatched on settings change.

### Universal `enabled` checklist

When a plugin exposes settings, add an `enabled` boolean with `default: true` unless there is a strong reason not to. Then verify:

- Frontend hooks call `hooks.getSettings?.()` (or `context.getSettings?.()`) at each invocation and return early when `enabled === false`.
- Backend hooks call `getSettings?.()` at execution time and no-op when disabled.
- Prompt fragments may rely on the engine to suppress `promptFragments[]` when disabled. If a setting changes fragment text (not just enable/disable), implement `getDynamicVariables()` instead of a static fragment.
- Action buttons are filtered by the engine, but click handlers should still check `enabled` as a stale-cache safety net.
- Do **not** rely on `enabled` to suppress `promptStripTags` or `displayStripTags`; strip-tag declarations intentionally remain active for historical content.

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

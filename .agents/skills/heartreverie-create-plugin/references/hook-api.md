# Hook API Reference

## Table of Contents

- [Backend Hooks](#backend-hooks)
  - [Hook Stages](#hook-stages)
  - [Registration Pattern](#registration-pattern)
  - [Stage Details](#stage-details)
  - [Priority System](#priority-system)
  - [Error Handling](#error-handling)
  - [Plugin Logger](#plugin-logger)
  - [`registerRoutes` Export](#registerroutes-export)
- [Frontend Hooks](#frontend-hooks)
  - [Frontend Hook Stages](#frontend-hook-stages)
  - [Frontend Registration Pattern](#frontend-registration-pattern)
  - [`chat:send:before` Pipeline Contract](#chatsendbefore-pipeline-contract)
  - [`chapter:render:after` Post-Processing + Re-Sanitization](#chapterrenderafter-post-processing--re-sanitization)
  - [`chapter:dom:ready` and `chapter:dom:dispose` (DOM-Aware Hooks)](#chapterdomready-and-chapterdomdispose-dom-aware-hooks)
  - [`story:switch` and `chapter:change` (Informational)](#storyswitch-and-chapterchange-informational)
  - [The Placeholder Pattern](#the-placeholder-pattern)
  - [Notification Hook](#notification-hook)
  - [Action Button Click Context](#action-button-click-context)
- [Security Notes](#security-notes)
- [Code Style](#code-style)

---

## Backend Hooks

Backend modules register handlers via a context object. The module must export a `register` function that receives `{ hooks, logger, getSettings }` — a `PluginHooks` interface for hook registration, a pre-scoped `Logger` for structured logging, and a **zero-arg** `getSettings()` that returns the live settings snapshot for THIS plugin only (backend `getSettings` cannot read other plugins' settings — that is a frontend-only feature).

In addition to `register`, a backend module MAY export:

- `getDynamicVariables(context)` — supplies values for variables declared in `parameters`. The `context` here ALSO carries `getSettings`. See `manifest-schema.md`.
- `registerRoutes(context)` — mounts custom HTTP endpoints for the plugin under `/api/plugins/<name>/*`. The `context` here ALSO carries `getSettings`. See [`registerRoutes` Export](#registerroutes-export).

### Hook Stages

| Stage | When Fired | Context Parameters |
|-------|-----------|-------------------|
| `prompt-assembly` | During system prompt rendering | `{ previousContext, rawChapters, storyDir, series, name }` |
| `response-stream` | For each delta chunk during chat / continue-last-chapter writes (NOT plugin-action append/replace) | `{ correlationId, chunk, series, name, storyDir, chapterPath, chapterNumber }` — **mutate `context.chunk`** to transform/redact the streamed text before it is written |
| `pre-write` | Before opening/truncating a NEW chapter file (chat `write-new-chapter` only) — runs BEFORE any LLM streaming, so the LLM response is NOT yet available | `{ message, chapterPath, storyDir, series, name, preContent }` — set `context.preContent` to a string that will be written to the chapter BEFORE the streamed deltas |
| `post-response` | After the LLM response is complete and written | `{ content, storyDir, series, name, rootDir, correlationId, chapterNumber, chapterPath, source, pluginName?, appendedTag? }` — `source` is one of `"chat"`, `"continue"`, `"plugin-action"`; `pluginName` and `appendedTag` are set only when `source === "plugin-action"` |

> **Note:** `strip-tags` is a valid stage name in the dispatcher but is not currently dispatched by any code path. Plugins registered on it will load without error but their handlers will never fire.

> **Plugin-action lifecycle (runPluginPrompt):** `append` and `replace` modes do NOT dispatch `pre-write` or `response-stream` (the engine streams to a buffer, then performs the atomic file mutation in one shot). Only `post-response` fires after a successful write, with `source: "plugin-action"`. Discard mode (no `append`/`replace`) dispatches NO backend hooks at all.

### Registration Pattern

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
    const storyDir = context.storyDir as string;
    log.info("Processing response", { contentLength: content.length });
    // Process the LLM response
  }, 100);
}
```

### Stage Details

#### `prompt-assembly`

Runs during system prompt rendering. Use to modify `previousContext` or inject dynamic content.

```typescript
hooks.register("prompt-assembly", async (context) => {
  const log = context.logger;
  const previousContext = context.previousContext as string[];
  const storyDir = context.storyDir as string;
  const name = context.name as string;
  // Modify previousContext in-place or read rawChapters for unstripped content
}, 100);
```

Context is mutable — modify arrays in-place (e.g., `previousContext.length = 0; previousContext.push(...newItems)`).

#### `pre-write`

Runs ONLY for chat `write-new-chapter` (i.e. starting a brand-new chapter). It fires **before** the LLM streaming begins and before the chapter file is opened — at this point the LLM response is NOT yet available. Use `context.message` (the user prompt) to compute metadata that should be written to the chapter BEFORE the streamed deltas, and assign that to `context.preContent`. The string in `preContent` is written as-is at the start of the chapter file. Use `response-stream` (per-delta) or `post-response` (after completion) when you need the model output.

```typescript
hooks.register("pre-write", async (context) => {
  const message = context.message as string;
  if (typeof message === "string" && message.length > 0) {
    // Prepend metadata before the streamed LLM response in the chapter file
    context.preContent = `<my_tag>\n${message}\n</my_tag>\n\n`;
  }
}, 100);
```

#### `response-stream`

Fires once per streamed delta during chat `write-new-chapter` and `continue-last-chapter`. Mutate `context.chunk` to transform/redact text before it is written to the chapter file. NOT dispatched for `runPluginPrompt` append/replace.

```typescript
hooks.register("response-stream", async (context) => {
  context.chunk = (context.chunk as string).replace(/badword/gi, "***");
}, 100);
```

#### `post-response`

Runs after the LLM response is complete and written. Use for side effects: running external tools, updating state files, logging.

```javascript
hooks.register("post-response", async (context) => {
  const log = context.logger;
  const { content, storyDir, rootDir } = context;
  // Run external binary, update files, etc.
}, 100);
```

### Priority System

```
hooks.register(stage, handler, priority)
```

- **Lower priority number = runs first**
- Default: `100`
- Multiple handlers on the same stage run sequentially in priority order
- Typical values: `50` (early), `100` (normal), `200` (late)

### Error Handling

- Each handler runs in a try/catch
- Exceptions are **logged via the structured logger** but **do not block** other handlers
- A failing handler does not prevent subsequent handlers from executing
- The (possibly mutated) context is returned regardless of errors

```
// From HookDispatcher.dispatch():
// for (const { handler } of handlers) {
//   try { await handler(context); }
//   // Errors are logged via the structured logger (category: "plugin") but do not block other handlers
// }
```

### Plugin Logger

Each plugin receives a pre-scoped `Logger` instance via the register context. The logger has `{ plugin: "<name>" }` in its `baseData`, so all log entries automatically include the plugin name.

During hook dispatch, `context.logger` is always injected — it is derived from the plugin's base logger with a `correlationId` when available (from chat requests). Use the pattern:

```javascript
const log = context.logger ?? logger;
```

Logger methods: `debug(message, data?)`, `info(message, data?)`, `warn(message, data?)`, `error(message, data?)`, `withContext(ctx)`.

```javascript
log.info("Compaction applied", { chapters: 5, removed: 2 });
log.debug("Processing chapter", { index: 3 });
log.warn("Binary not found", { path: "/usr/bin/tool" });
log.error("Execution failed", { exitCode: 1, stderr: "..." });
```

### `registerRoutes` Export

A backend module may also export `registerRoutes(context)` to mount custom HTTP endpoints under `/api/plugins/<name>/*`. The function may be `async` (the server awaits all pending plugin route registrations during `initPluginRoutes(app)` before serving traffic).

**Context (`PluginRouteContext`):**

| Field | Type | Description |
|-------|------|-------------|
| `app` | `Hono` | The plugin's own Hono sub-app. Routes registered here are mounted at `basePath`. |
| `basePath` | `string` | The mount prefix, e.g. `/api/plugins/sd-webui-image-gen`. |
| `logger` | `Logger` | Pre-scoped logger for this plugin. |
| `getSettings` | `() => Promise<Record<string, unknown>>` | Reads the merged saved settings (defaults from `settingsSchema` ∪ values from `playground/_plugins/<name>/config.json`). Returns `{}` if the plugin declares no `settingsSchema`. |
| `saveSettings` | `(settings) => Promise<void>` | Validates against the schema (if any) then writes the file. Throws on validation failure. |
| `config` | `AppConfig` | The shared app config (passphrase mode, paths, etc.). |

**TypeScript example:**

```typescript
import type { PluginRouteContext } from "../../writer/types.ts";

export async function registerRoutes(context: PluginRouteContext): Promise<void> {
  const { app, logger, getSettings } = context;

  // Proxy that returns a string array for x-options-url consumption.
  app.get("/proxy/sd-models", async (c) => {
    const settings = await getSettings();
    const endpoint = (settings.endpoint as string) ?? "http://localhost:7860";
    try {
      const res = await fetch(`${endpoint}/sdapi/v1/sd-models`);
      if (!res.ok) return c.json([], 200);
      const models = (await res.json()) as Array<{ title: string }>;
      return c.json(models.map((m) => m.title));
    } catch (err) {
      logger.warn("sd-models proxy failed", { error: String(err) });
      return c.json([], 200);
    }
  });
}
```

**Security notes:**

- Routes inherit the global passphrase middleware — clients must send the same authentication header used by the rest of `/api/*`.
- The body limit on `/api/*` is 10 MB (raised from 1 MB to support base64 image payloads).
- Plugin routes MUST stay within their own `basePath`. Do not attempt to register routes outside it; the runtime mounts the sub-app under the prefix.
- Treat saved settings as untrusted input on the wire path — always re-validate before forwarding to external services.

---

## Frontend Hooks

Frontend modules are ES modules loaded by the browser. They register synchronous handlers via `FrontendHookDispatcher`.

### Frontend Hook Stages

| Stage | Mode | Purpose | Context Parameters |
|-------|------|---------|-------------------|
| `frontend-render` | sync | Custom tag extraction → placeholder map (BEFORE Markdown parsing) | `{ text, placeholderMap, options, series?, story?, chapterNumber? }` |
| `chapter:render:after` | sync | Post-process the rendered token array (chapter HTML chunks) AFTER Markdown + initial DOMPurify | `{ tokens, rawMarkdown, options }` — story metadata is nested as `ctx.options.series` / `ctx.options.story` / `ctx.options.chapterNumber`. See [`chapter:render:after` Post-Processing](#chapterrenderafter-post-processing--re-sanitization) below for the `RenderToken` shape. |
| `chapter:dom:ready` | sync | After Vue commits the rendered chapter to the live DOM (DOM nodes available). Fires once on mount and again on every render-epoch change for the same container — handlers must be idempotent | `{ container, tokens, rawMarkdown, chapterIndex, series?, story?, chapterNumber? }` |
| `chapter:dom:dispose` | sync | Before the chapter container is unmounted. Only fires on actual unmount (chapter switch / story switch / app teardown), NOT between repeated `chapter:dom:ready` events on the same container | `{ container, chapterIndex }` |
| `chat:send:before` | sync (pipeline) | Transform the user message just before it is sent | `{ message, series, story, mode }` — `mode` is `'send'` or `'resend'`. If a handler returns a `string`, it replaces `ctx.message` for subsequent handlers. |
| `notification` | sync | Browser/in-app notifications on lifecycle events | `{ event, data, notify }` — `event` is e.g. `'chat:done'` or `'chat:error'` |
| `story:switch` | sync (informational) | Active series/story changed | `{ series, story, previousSeries, previousStory }` — `previous*` are `null` on first load |
| `chapter:change` | sync (informational) | Displayed chapter changed | `{ chapter, index, previousIndex, series, story }` — `previousIndex` is `null` on first load |
| `action-button:click` | **async** | User clicked a `PluginActionBar` button owned by this plugin | See [Action Button Click Context](#action-button-click-context) below |

- `text` (`string`): Raw LLM output BEFORE Markdown parsing
- `placeholderMap` (`Map<string, string>`): Map of placeholder → rendered HTML
- `options` (`object`): `{ isLastChapter, series?, story?, chapterNumber? }`
- `tokens`: rendered-HTML chunk array (`Array<{ type: 'html', content: string }>` plus rare `vento-error` tokens — see below); mutate freely — the dispatcher re-sanitizes any new or `.content`-mutated `html` token via DOMPurify
- `container` (`HTMLElement`): The live DOM node holding the rendered chapter (DOM-mutating plugins should clean up via `chapter:dom:dispose` to prevent memory leaks)
- `chapterIndex` (`number`): 0-based index of the chapter in the loaded chapter list

The runtime validates stage names against an allow-list — invalid stage names are dropped with a `console.warn`.

### Frontend Registration Pattern

```javascript
import { escapeHtml } from '../_shared/utils.js';

export function register(hooks, context) {
  // hooks.getSettings(name?) and context.getSettings(name?) both return a
  // frozen snapshot of resolved settings (defaults ∪ saved). Omit `name` to
  // read this plugin's own settings.
  hooks.register('frontend-render', (ctx) => {
    const settings = hooks.getSettings();
    if (settings.enabled === false) return;
    // 1. Extract custom XML blocks from ctx.text
    // 2. Replace with placeholder comments
    // 3. ctx.placeholderMap.set(placeholder, escapedHtml)
  }, 100);
}
```

**Notes:**

- `register` MAY be `async`. The loader awaits all plugins via `Promise.allSettled` before flipping `pluginsReady` to true.
- `hooks.register(stage, handler, priority?)` — `originPluginName` is auto-curried by the per-plugin proxy; do NOT pass it manually.
- Most stages are synchronous; `action-button:click` is the lone async stage.
- Shared utilities live under `/plugins/_shared/`. Import via relative paths: `import { escapeHtml } from '../_shared/utils.js';`. The server only serves files under `_shared/` plus each plugin's declared `frontendModule` and `frontendStyles`.

### `chat:send:before` Pipeline Contract

The `chat:send:before` stage is a **pipeline**: if a handler returns a `string`, the dispatcher assigns it to `context.message` before calling the next handler. Any other return value (`undefined`, `null`, number, object) is ignored and `context.message` is left as-is. Handlers may also mutate `context.message` directly. There is no veto/cancel — to drop a message, return an empty string. `context.mode` is `'send'` for new messages or `'resend'` when regenerating the last assistant turn.

```javascript
hooks.register('chat:send:before', (ctx) => {
  if (ctx.mode === 'resend') return; // only stamp new messages
  return `[${new Date().toISOString()}] ${ctx.message}`;
}, 100);
```

### `chapter:render:after` Post-Processing + Re-Sanitization

`chapter:render:after` fires after Markdown parsing and the initial DOMPurify pass. The token array is **already-rendered HTML chunks**, not markdown-it AST nodes:

```typescript
type RenderToken =
  | { type: 'html'; content: string }            // a chunk of post-render HTML
  | { type: 'vento-error'; data: { ... } };      // an inline error card (rare)
```

There are NO `text` / `paragraph` / `paragraph_open` tokens — markdown structure has already been collapsed to HTML strings. To inspect or count visible text, run a regex/`DOMParser` over the joined `content` strings, or (preferred) work from `ctx.rawMarkdown` which is the original markdown source.

Handlers may mutate `context.tokens` (push new tokens, replace existing ones, or edit `.content`). The dispatcher then re-runs DOMPurify on every `html` token that was added or whose `.content` changed — plugins do not need to sanitize HTML themselves, and untrusted HTML will never reach the DOM even if a plugin produces it.

```javascript
hooks.register('chapter:render:after', (ctx) => {
  for (const tok of ctx.tokens) {
    if (tok.type !== 'html') continue;
    tok.content += '<footer class="note">generated</footer>';
  }
}, 100);
```

### `chapter:dom:ready` and `chapter:dom:dispose` (DOM-Aware Hooks)

`chapter:dom:ready` fires after Vue commits the rendered chapter to the live DOM (a `flush: "post"` watcher in `ChapterContent.vue` plus a one-shot `onMounted` belt-and-suspenders dispatch). It re-fires on every `[tokens, renderEpoch, isEditing]` change for the **same** container — handlers MUST be idempotent: clear any prior per-container state (Range registrations, Highlight ranges, observers) at the top of the handler before re-installing it. Use this stage when you need real DOM nodes — CSS Custom Highlight API, `Range`, `IntersectionObserver`, DOM mutation. The `frontend-render` and `chapter:render:after` stages run BEFORE the DOM exists.

`chapter:dom:dispose` fires from `onBeforeUnmount` when the chapter container actually unmounts (chapter switch, story switch, app teardown) — it is NOT paired one-to-one with `chapter:dom:ready` and will NOT fire between repeated ready events on the same container. Use it for final cleanup of references that would otherwise pin the dropped DOM in memory.

Both stages are skipped while the chapter editor textarea is shown (the DOM holds editor input, not rendered content).

```javascript
const rangesByContainer = new WeakMap();
const HIGHLIGHT_NAME = 'my-highlight';

hooks.register('chapter:dom:ready', (ctx) => {
  // ── Idempotent cleanup FIRST, BEFORE any settings/early-return check ──
  // chapter:dom:ready re-fires on every render-epoch bump for the SAME
  // container. If we bail early without clearing prior state, stale Range
  // objects stay registered against the now-stale DOM.
  const prior = rangesByContainer.get(ctx.container);
  if (prior) {
    const hl = CSS.highlights.get(HIGHLIGHT_NAME);
    if (hl) for (const r of prior) hl.delete(r);
    rangesByContainer.delete(ctx.container);
  }

  // Now safe to bail — the container is in a clean state.
  const settings = hooks.getSettings();
  if (settings.enabled === false) return;

  const ranges = computeHighlightRanges(ctx.container, settings);
  if (ranges.length === 0) return;
  rangesByContainer.set(ctx.container, ranges);
  const existing = CSS.highlights.get(HIGHLIGHT_NAME);
  if (existing) for (const r of ranges) existing.add(r);
  else CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
}, 100);

hooks.register('chapter:dom:dispose', (ctx) => {
  const prior = rangesByContainer.get(ctx.container);
  if (!prior) return;
  const hl = CSS.highlights.get(HIGHLIGHT_NAME);
  if (hl) for (const r of prior) hl.delete(r);
  rangesByContainer.delete(ctx.container);
}, 100);
```

### `story:switch` and `chapter:change` (Informational)

Both are informational — they cannot cancel navigation. Each fires at most once per real state transition:

- `story:switch` compares `previousSeries`/`previousStory`; reload-to-last does **not** trigger it.
- `chapter:change` skips dispatch when `previousIndex === index`.

```javascript
hooks.register('story:switch', (ctx) => {
  // ctx.previousSeries / ctx.previousStory are null on first load
}, 100);
hooks.register('chapter:change', (ctx) => {
  // ctx.chapter matches ChapterData.number
}, 100);
```

### The Placeholder Pattern

Frontend rendering follows the Extract → Placeholder → Reinsert pattern:

1. **Extract** XML blocks (e.g., `<options>...</options>`) from `context.text`
2. **Replace** each block with a unique HTML comment placeholder (e.g., `<!--OPTIONS_BLOCK_0-->`)
3. **Store** the mapping in `context.placeholderMap.set(placeholder, renderedHtml)`
4. After all hooks run, the system runs Markdown parsing + DOMPurify on `context.text`
5. The system **reinserts** rendered HTML by replacing placeholders in the final HTML

Example implementation:

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
  // Return sanitized HTML string
  return `<div class="my-component">${escapeHtml(content)}</div>`;
}
```

**Key points:**
- Always use unique placeholder names (include plugin name to avoid collisions)
- Use `escapeHtml()` from `../_shared/utils.js` (relative import — the plugin loader serves `_shared/` via `/plugins/_shared/utils.js`) for any user content in rendered HTML
- Priority controls rendering order — lower priorities extract first

### Notification Hook

The `notification` hook is dispatched by the system on events such as `chat:done`. Use it to surface browser or in-app notifications for lifecycle events.

**When it fires:** dispatched by the system on events like `chat:done`.

**Context parameters:**

- `event` (`string`): Event name (e.g., `'chat:done'`)
- `data` (`object`): Event-specific data
- `notify` (`function`): Call to show a notification. Accepts an options object:
  - `title` (`string`, required)
  - `body` (`string`, optional)
  - `level` (`'info' | 'success' | 'warning' | 'error'`, optional)
  - `position` (`string`, optional)
  - `channel` (`'in-app' | 'system' | 'auto'`, optional)
  - `duration` (`number`, optional)

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

### Action Button Click Context

`action-button:click` is the only **async** frontend hook stage. The dispatcher only invokes handlers whose `originPluginName` matches the clicked button's owning plugin, then awaits each handler in priority order. While the dispatch promise is pending, the button is held in a `pendingKey = ${pluginName}:${buttonId}` set and rendered disabled to prevent double-clicks. If a handler throws and does NOT call `notify` itself, the dispatcher emits a default error toast — the dispatch always resolves (no unhandled rejections).

Context (`ctx`):

| Field | Type | Description |
|-------|------|-------------|
| `buttonId` | `string` | The clicked button's id |
| `pluginName` | `string` | The owning plugin's name |
| `series`, `name` | `string` | Active series/story (always present in backend mode) |
| `storyDir` | `string` | Frontend story identifier `"${series}/${name}"` — a relative path-like string, NOT a filesystem path. Use `series` + `name` for backend API calls. |
| `lastChapterIndex` | `number \| null` | 0-based index of the latest chapter (= `chapters.length - 1`), or `null` if no chapters yet |
| `runPluginPrompt` | `function` | Auto-curried with this plugin's name. See below. |
| `notify` | `function` | Action-button-specific notify. Forwards ONLY `title`, `body`, and `level` (where `level` is `'info' \| 'warning' \| 'error'` — `'success'` is NOT supported here, unlike the notification hook's `notify`). `position`, `channel`, and `duration` are dropped. |
| `reload` | `function` | Triggers `useChapterNav.reloadToLast()` |

`runPluginPrompt(promptFile, opts?)` signature:

```typescript
runPluginPrompt(
  promptFile: string,                                 // relative path under the plugin dir; must end in .md
  opts?: {
    append?: boolean;                                 // default false
    appendTag?: string;                               // required when append=true; matches /^[a-zA-Z][a-zA-Z0-9_-]{0,30}$/
    replace?: boolean;                                // default false; mutually exclusive with append
    extraVariables?: Record<string, string | number | boolean>;
  }
): Promise<{
  content: string;                                    // append + replace: full chapter content AFTER write; discard mode (no append/replace): raw LLM response
  usage: TokenUsageRecord | null;
  chapterUpdated: boolean;                            // true when append succeeded
  chapterReplaced: boolean;                           // true when replace succeeded
  appendedTag: string | null;                         // mirrors appendTag when append=true; null otherwise
}>
```

Behaviour:

- The dispatcher ALWAYS emits a default error toast (title `"外掛操作失敗"`, body `"${pluginName}:${buttonId} — ${message}"`) when a handler throws. If you call `notify()` and then re-throw, the user sees both toasts. Either notify-and-return-normally, or throw-without-notifying.
- Shares the global `isLoading` / `streamingContent` / `errorMessage` / `abortCurrentRequest` with normal chat — the user's "⏹ Stop" button can interrupt a plugin action mid-stream.
- Rejects when another generation (chat or plugin action) holds the per-story lock (HTTP 409).
- WebSocket path streams progress via `streamingContent`; HTTP fallback returns the final JSON only.
- `replace: true` injects the pre-write chapter content as the reserved Vento variable `{{ draft }}` (after `promptStripTags` cleanup). `extraVariables` MUST NOT clash with `previousContext`, any `lore_*`, `status_data`, `draft`, or other reserved names.
- The prompt template MUST emit at least one `{{ message "user" }}…{{ /message }}` block — `user_input` defaults to `""` for plugin actions but the engine still requires a user-role message (returns HTTP 422 `multi-message:no-user-message` otherwise).
- Per-route rate limit: 30/min/client (shared with normal chat); global 300/min still applies.

Action buttons are **also** centrally gated by the universal `enabled` setting: `/api/plugins/action-buttons` filters out disabled plugins, and the click path re-checks settings to no-op stale clicks. Handlers SHOULD still bail early on `getSettings().enabled === false` as a stale-cache safety net.

For the WebSocket envelope (`plugin-action:run` / `:delta` / `:done` / `:error` / `:aborted`), atomic append/replace semantics, byte-for-byte rollback on abort, and `post-response` dispatch payload, see [`docs/plugin-system.md`](../../../../docs/plugin-system.md#動作按鈕action-buttons).

---

- **Module path containment**: `backendModule` and `frontendModule` paths must resolve within the plugin directory. Paths with `../` traversal are rejected.
- **Frontend module serving**: Only files declared as `frontendModule` in the manifest are served via `/plugins/:name/:file`. No other files in the plugin directory are accessible from the browser.
- **Backend imports**: Backend modules are loaded via dynamic `import()` with `file://` URLs (Deno). The resolved path is validated before import.

## Code Style

### Backend (writer/)

- ESM modules (`import`/`export`)
- **Double quotes** for strings
- Semicolons always used
- `async/await` for all async operations
- `#` prefix for private class fields
- JSDoc comments on functions
- TypeScript (`.ts`) or JavaScript (`.js`) — both supported

### Frontend (plugin frontend modules)

- ESM modules served raw to the browser — no build step, no bundler. The reader app is Vue 3 + Vite, but plugin frontend code is loaded directly via `<script type="module">`.
- **Single quotes** for strings
- Semicolons always used
- JSDoc `@param`/`@returns` on exported functions
- Import shared utilities relatively: `import { escapeHtml } from '../_shared/utils.js';`

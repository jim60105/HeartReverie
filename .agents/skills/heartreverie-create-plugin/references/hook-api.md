# Hook API Reference

## Table of Contents

- [Backend Hooks](#backend-hooks)
  - [Hook Stages](#hook-stages)
  - [Registration Pattern](#registration-pattern)
  - [Stage Details](#stage-details)
  - [Priority System](#priority-system)
  - [Error Handling](#error-handling)
  - [Plugin Logger](#plugin-logger)
- [Frontend Hooks](#frontend-hooks)
  - [Frontend Registration Pattern](#frontend-registration-pattern)
  - [The Placeholder Pattern](#the-placeholder-pattern)
  - [Notification Hook](#notification-hook)
- [Security Notes](#security-notes)
- [Code Style](#code-style)

---

## Backend Hooks

Backend modules register handlers via a context object. The module must export a `register` function that receives `{ hooks, logger }` — a `PluginHooks` interface for hook registration and a pre-scoped `Logger` for structured logging.

### Hook Stages

| Stage | When Fired | Context Parameters |
|-------|-----------|-------------------|
| `prompt-assembly` | During system prompt rendering | `{ previousContext, rawChapters, storyDir, series, name }` |
| `pre-write` | After LLM response, before file write | `{ message, chapterPath, storyDir, series, name, preContent }` |
| `post-response` | After LLM response complete | `{ content, storyDir, series, name, rootDir }` |

> **Note:** The runtime also defines `response-stream` and `strip-tags` as valid stage names, but they are not currently dispatched by any code path. Plugins registered on these stages will load without error but their handlers will never fire. They exist for potential future use.

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

Runs after the full LLM response is received but before it is written to the chapter file. Use to prepend or modify content before writing.

```typescript
hooks.register("pre-write", async (context) => {
  const message = context.message as string;
  if (typeof message === "string" && message.length > 0) {
    // Prepend content before the LLM response in the chapter file
    context.preContent = `<my_tag>\n${message}\n</my_tag>\n\n`;
  }
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

---

## Frontend Hooks

Frontend modules are ES modules loaded by the browser. They register synchronous handlers via `FrontendHookDispatcher`.

### Frontend Hook Stages

| Stage | Purpose | Context Parameters |
|-------|---------|-------------------|
| `frontend-render` | Custom tag extraction and rendering | `{ text, placeholderMap, options }` |
| `notification` | Browser notification when events occur (e.g., `chat:done`) | `{ event, data, notify }` |
| `chat:send:before` | Transform the user message just before it is sent (pipeline) | `{ message, mode }` — `mode` is `'send'` or `'resend'`. If a handler returns a `string`, it replaces `context.message` for subsequent handlers. |
| `chapter:render:after` | Post-process the token array after Markdown + initial DOMPurify pass | `{ tokens, rawMarkdown, options }` — mutate `tokens` freely; the system re-sanitizes any newly added or `.content`-mutated `html` tokens after dispatch. |
| `story:switch` | Informational: fires when the active series/story changes | `{ series, story, previousSeries, previousStory }` — `previousSeries`/`previousStory` are `null` on first load; `series`/`story` are always non-null strings. |
| `chapter:change` | Informational: fires when the displayed chapter changes | `{ chapter, index, previousIndex, series, story }` — `chapter` matches `ChapterData.number`; `previousIndex` is `null` on first load. |

- `text` (`string`): The raw LLM output text before Markdown parsing
- `placeholderMap` (`Map<string, string>`): Map of placeholder strings → rendered HTML
- `options` (`object`): Render options (e.g., `{ isLastChapter }`)

### Frontend Registration Pattern

```javascript
export function register(hooks) {
  hooks.register('frontend-render', (context) => {
    // 1. Extract custom XML blocks from context.text
    // 2. Replace with placeholder comments
    // 3. Add placeholder → HTML mappings to context.placeholderMap
  }, 100);
}
```

**Important:** Frontend handlers are **synchronous** (no `async`).

### `chat:send:before` Pipeline Contract

The `chat:send:before` stage is a **pipeline**: if a handler returns a `string`, the dispatcher assigns it to `context.message` before calling the next handler. Any other return value (`undefined`, `null`, number, object) is ignored and `context.message` is left as-is. Handlers may also mutate `context.message` directly. There is no veto/cancel — to drop a message, return an empty string. `context.mode` is `'send'` for new messages or `'resend'` when regenerating the last assistant turn.

```javascript
hooks.register('chat:send:before', (ctx) => {
  if (ctx.mode === 'resend') return; // only stamp new messages
  return `[${new Date().toISOString()}] ${ctx.message}`;
}, 100);
```

### `chapter:render:after` Post-Processing + Re-Sanitization

`chapter:render:after` fires after Markdown parsing and the initial DOMPurify pass. Handlers may mutate `context.tokens` (push new tokens, replace existing ones, or edit `.content`). The dispatcher then re-runs DOMPurify on every `html` token that was added or whose `.content` changed — plugins do not need to sanitize HTML themselves, and untrusted HTML will never reach the DOM even if a plugin produces it.

```javascript
hooks.register('chapter:render:after', (ctx) => {
  for (const tok of ctx.tokens) {
    if (tok.type !== 'html') continue;
    tok.content += '<footer class="note">generated</footer>';
  }
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
- Use `escapeHtml()` from `/js/utils.js` for any user content in rendered HTML
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

---

## Security Notes

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

### Frontend (reader/js/)

- ESM modules, no build step, no bundler, no framework
- **Single quotes** for strings
- Semicolons always used
- JSDoc `@param`/`@returns` on exported functions
- Import from absolute paths (e.g., `'/js/utils.js'`)

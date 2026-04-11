# Hook API Reference

## Table of Contents

- [Backend Hooks](#backend-hooks)
  - [Hook Stages](#hook-stages)
  - [Registration Pattern](#registration-pattern)
  - [Stage Details](#stage-details)
  - [Priority System](#priority-system)
  - [Error Handling](#error-handling)
- [Frontend Hooks](#frontend-hooks)
  - [Frontend Registration Pattern](#frontend-registration-pattern)
  - [The Placeholder Pattern](#the-placeholder-pattern)
- [Security Notes](#security-notes)
- [Code Style](#code-style)

---

## Backend Hooks

Backend modules register handlers via `HookDispatcher`. The module must export a `register` function that receives the dispatcher.

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
export function register(hookDispatcher) {
  hookDispatcher.register("post-response", async (context) => {
    const { content, storyDir, rootDir } = context;
    // Process the LLM response
  }, 100);
}
```

**TypeScript (`handler.ts`):**

```typescript
import type { HookDispatcher } from "../../writer/lib/hooks.ts";

export function register(hookDispatcher: HookDispatcher): void {
  hookDispatcher.register("post-response", async (context) => {
    const content = context.content as string;
    const storyDir = context.storyDir as string;
    // Process the LLM response
  }, 100);
}
```

### Stage Details

#### `prompt-assembly`

Runs during system prompt rendering. Use to modify `previousContext` or inject dynamic content.

```typescript
hookDispatcher.register("prompt-assembly", async (context) => {
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
hookDispatcher.register("pre-write", async (context) => {
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
hookDispatcher.register("post-response", async (context) => {
  const { content, storyDir, rootDir } = context;
  // Run external binary, update files, etc.
}, 100);
```

### Priority System

```
hookDispatcher.register(stage, handler, priority)
```

- **Lower priority number = runs first**
- Default: `100`
- Multiple handlers on the same stage run sequentially in priority order
- Typical values: `50` (early), `100` (normal), `200` (late)

### Error Handling

- Each handler runs in a try/catch
- Exceptions are **logged to console** but **do not block** other handlers
- A failing handler does not prevent subsequent handlers from executing
- The (possibly mutated) context is returned regardless of errors

```
// From HookDispatcher.dispatch():
// for (const { handler } of handlers) {
//   try { await handler(context); }
//   catch (err) { console.error(`Hook error in stage '${stage}':`, err.message); }
// }
```

---

## Frontend Hooks

Frontend modules are ES modules loaded by the browser. They register synchronous handlers via `FrontendHookDispatcher`.

### Frontend Hook Stage

| Stage | Purpose | Context Parameters |
|-------|---------|-------------------|
| `frontend-render` | Custom tag extraction and rendering | `{ text, placeholderMap, options }` |

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
- Priority controls rendering order — lower priorities extract first (e.g., status at 40, options at 50)

### Frontend Priority Conventions

| Priority | Plugin | Purpose |
|----------|--------|---------|
| 40 | status | Status panel rendering |
| 50 | options | Options panel rendering |
| 100 | (default) | Standard rendering |

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

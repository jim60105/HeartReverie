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

For plugins with `backendModule`, create the handler file:

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
    // Process the LLM response
  }, 100);
}
```

For the 3 active hook stages and their context parameters, read `references/hook-api.md`.

Backend code style: ESM, **double quotes**, semicolons, `async/await`, JSDoc comments.

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

For the full frontend hook API, read `references/hook-api.md`.

## Step 8: Generate README.md

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

## Step 9: Validate

Run these checks before considering the plugin complete:

1. **Name match**: `plugin.json` `name` field matches directory name
2. **Valid JSON**: `plugin.json` parses without errors
3. **File existence**: All files referenced in manifest exist (`promptFragments[].file`, `backendModule`, `frontendModule`)
4. **Path safety**: All file paths resolve within `plugins/<name>/` (no `../` traversal)
5. **system.md integration**: If prompt fragments use named variables, confirm `{{ variable_name }}` exists in `system.md`
6. **Run tests**: `deno test --allow-read --allow-write --allow-env --allow-net` to verify nothing is broken

---

## Quick Reference: Existing Plugin Variables

| Variable | Plugin | Priority |
|----------|--------|----------|
| `threshold_lord_start` | threshold-lord | 10 |
| `de_robotization` | de-robotization | 100 |
| `t_task` | t-task | 100 |
| `t_task_think_format` | t-task | 100 |
| `writestyle` | writestyle | 100 |
| `options` | options | 100 |
| `status` | status | 100 |
| `context_compaction` | context-compaction | 800 |
| `writestyle_reinforce` | writestyle | 800 |
| `threshold_lord_end` | threshold-lord | 900 |

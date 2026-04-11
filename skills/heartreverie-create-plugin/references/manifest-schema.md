# Plugin Manifest Schema (`plugin.json`)

## Table of Contents

- [Required Fields](#required-fields)
- [Plugin Types](#plugin-types)
- [Optional Fields](#optional-fields)
- [Prompt Fragments](#prompt-fragments)
- [Tag Strip Patterns](#tag-strip-patterns)
- [Parameters](#parameters)
- [Security Constraints](#security-constraints)
- [Complete Examples by Type](#complete-examples-by-type)

---

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique identifier. **Must match directory name exactly.** |
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
| `frontendModule` | `string` | Path to frontend module (relative to plugin dir). **Must be `"./frontend.js"`** — the runtime loader hardcodes this filename. |
| `tags` | `array<string>` | XML tag names managed by this plugin (used for metadata/API response) |
| `promptStripTags` | `array` | Tags/regex to strip from `previousContext` when building prompts |
| `displayStripTags` | `array` | Tags/regex to strip from frontend display |
| `parameters` | `array` | Custom Vento template parameters exposed to the template editor |

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

| Priority | Purpose | Example |
|----------|---------|---------|
| 10 | Start of prompt — framing instructions | threshold-lord start fragment |
| 100 | Normal — standard instructions | de-robotization, writestyle, options, status |
| 800 | Reinforcement — re-emphasize at end of prompt | writestyle-reinforce, context-compaction |
| 900 | End of prompt — final instructions | threshold-lord end fragment |

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

## Security Constraints

### Name Validation

- Must not contain: `..`, `\0`, `/`, `\`
- Must match the directory name exactly
- Validated by `isValidPluginName()` on load

### Path Containment

All file paths (`promptFragments[].file`, `backendModule`, `frontendModule`) are resolved with `path.resolve()` and must remain within the plugin directory. Paths like `../../etc/passwd` are rejected.

### Frontend Module Access

The `/plugins/:name/:file` route only serves files declared as `frontendModule` in the manifest. Arbitrary files in the plugin directory are not accessible.

---

## Complete Examples by Type

### prompt-only — Simple (single fragment)

```json
{
  "name": "de-robotization",
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

### full-stack — Backend + Frontend + Tags (No Prompt)

```json
{
  "name": "state-patches",
  "version": "1.0.0",
  "description": "State patch lifecycle: run state-patches binary post-response and render UpdateVariable blocks on frontend",
  "type": "full-stack",
  "backendModule": "./handler.js",
  "frontendModule": "./frontend.js",
  "tags": ["UpdateVariable", "update"],
  "promptStripTags": ["UpdateVariable"]
}
```

### full-stack — Backend + Tags + Display Stripping (No Prompt, No Frontend)

```json
{
  "name": "user-message",
  "version": "1.0.0",
  "description": "User message lifecycle: wrap input in tags, strip from context and display",
  "type": "full-stack",
  "backendModule": "./handler.ts",
  "displayStripTags": ["user_message"],
  "tags": ["user_message"],
  "promptStripTags": ["user_message"]
}
```

### full-stack — Prompt + Backend + Both Strip Types

```json
{
  "name": "context-compaction",
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

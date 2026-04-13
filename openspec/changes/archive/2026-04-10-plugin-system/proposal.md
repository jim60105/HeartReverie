## Why

The current prompt system and frontend tag rendering pipeline are tightly coupled and hardcoded — adding a new feature (e.g., a new LLM output tag with custom frontend rendering) requires modifying `server.js`, `md-renderer.js`, and `system.md` directly. There is no way for users to extend the system from outside the project. Refactoring to a plugin architecture enables independent feature development, user-extensible customization, and cleaner separation of concerns. Additionally, the system lacks prompt preview capability, Vento template error handling, and a frontend prompt editor (系統提示詞編排器) — all of which are needed to support the plugin-driven workflow.

## What Changes

- **Introduce a plugin system** with manifest format, loader, registry, and lifecycle management — plugins are loaded from both a built-in directory and a user-configurable external path
- **Introduce a hook system** with defined stages (prompt-assembly, response-stream, post-response, frontend-render, frontend-strip) that plugins can subscribe to, replacing the current hardcoded apply-patches binary invocation
- **Add prompt preview** — a new API endpoint and frontend UI to preview the fully rendered system prompt before sending to OpenRouter
- **Add Vento error handling** — catch template rendering errors (missing parameters, syntax errors) and surface clear feedback to the user
- **Add system prompt editor (編排器)** — a frontend UI for managing prompt composition, plugin prompt ordering, and Vento parameter auto-fill/chooser
- **Transform ALL existing tag-based features into plugins:**
  - Full-stack plugins (prompt + frontend): `<options>`, `<status>`, `<UpdateVariable>`
  - Prompt-only plugins (instruct LLM, frontend strips): `<T-task>`, `<disclaimer>`, `<imgthink>`, `<user_message>`
  - Prompt-fragment plugins (contribute prompt includes): writestyle, world_aesthetic_program, de-robotization, Threshold-Lord (start+end pair)
  - Hook plugin: apply-patches post-response processing → converted to a post-response hook
- **BREAKING**: `md-renderer.js` tag extraction pipeline changes from hardcoded to plugin-registered — custom forks that added tags directly will need migration
- **BREAKING**: `apply-patches` binary invocation moves from hardcoded server.js call to a hook — custom post-processing integrations must register as plugins

## Capabilities

### New Capabilities
- `plugin-core`: Plugin manifest format (JSON/YAML), plugin loader (built-in + external paths), registry, lifecycle (init/enable/disable), plugin types (full-stack, prompt-only, frontend-only, hook-only)
- `plugin-hooks`: Hook system with ordered stages — prompt-assembly, response-stream, post-response, frontend-render, frontend-strip — plugins register handlers with priority, hooks execute in order
- `prompt-preview`: API endpoint (`GET /api/stories/:series/:name/preview-prompt`) and frontend panel to inspect the final rendered system prompt with all plugin contributions visible
- `prompt-editor`: Frontend system prompt editor (編排器) for composing/reordering prompt sections, managing plugin prompt fragments, and Vento parameter auto-fill with available parameter discovery from core + plugin-provided parameters
- `vento-error-handling`: Error boundary for Vento template rendering — catches missing variables, syntax errors, include failures — returns structured error with source location and suggestion to the frontend

### Modified Capabilities
- `writer-backend`: Adds plugin loader initialization at startup, hook dispatch integration in chat endpoint, prompt preview endpoint, plugin-aware prompt assembly
- `md-renderer`: Refactors hardcoded tag extraction/strip lists to plugin-registered tag handler system with extract/render/strip registration API
- `options-panel`: Transforms from built-in component to a full-stack plugin providing prompt fragment (options.md) + frontend renderer + frontend-render hook
- `status-bar`: Transforms from built-in to full-stack plugin providing prompt fragment (status.md) + frontend renderer + post-response hook (replaces apply-patches for status updates)
- `variable-display`: Transforms from built-in to frontend-only plugin registering tag handler for `<UpdateVariable>/<update>`
- `post-response-patch`: **BREAKING** — Transforms from hardcoded binary invocation to a hook-based plugin; the apply-patches binary becomes a post-response hook handler
- `vento-prompt-template`: Template gains a dynamic plugin prompt injection section where plugin prompt fragments are assembled by the hook system

## Impact

- **Backend** (`writer/server.js`): Major refactor — plugin loader at startup, hook dispatcher throughout chat lifecycle, new preview endpoint, Vento error boundary wrapping renderSystemPrompt()
- **Frontend** (`reader/`): New files for prompt editor UI, plugin tag handler registration system in md-renderer.js, existing tag component files (options-panel.js, status-bar.js, variable-display.js) refactored to plugin format
- **Prompt templates** (`playground/prompts/`): system.md gains plugin injection point; individual prompt files (options.md, status.md, writestyle.md, etc.) move to plugin directories
- **New directories**: `plugins/` (built-in plugins), external plugin path configurable via env var
- **Dependencies**: May need a UI component library or autocomplete library for the prompt editor parameter chooser — requires evaluation
- **apply-patches binary**: Still used but invoked via hook plugin rather than hardcoded server.js call

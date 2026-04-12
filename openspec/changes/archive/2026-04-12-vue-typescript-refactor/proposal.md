## Why

The frontend (`reader/`) is a vanilla JavaScript application with no framework, no build step, and all CSS inline in a single `index.html`. While functional, this architecture suffers from: (1) imperative DOM manipulation scattered across 15 modules making state management error-prone, (2) module-scoped mutable state that is difficult to test and reason about, (3) no type safety across ~1,600 lines of JavaScript, (4) a monolithic inline `<script>` orchestrator in `index.html` that wires all modules together, and (5) global side effects (e.g., `options-panel.js` registering a global click listener at import time). Migrating to Vue.js with TypeScript will improve maintainability, enable component-based architecture with reactive state, and provide compile-time type checking — all while preserving the existing feature set and plugin contract.

## What Changes

- **Replace vanilla JS modules** with Vue 3 Single File Components (SFCs) using `<script setup lang="ts">` and Composition API
- **Add TypeScript** to all frontend code with strict type checking, sharing the project's existing `deno.json` compiler options
- **Introduce Vite** as the build tool with `@vitejs/plugin-vue`, integrated into the Deno project via `deno.json` tasks
- **Extract inline CSS** from `index.html` into scoped component styles and a shared theme module using CSS custom properties
- **Convert module-scoped mutable state** to Vue reactive state (composables using `ref`/`reactive`/`computed`)
- **Replace imperative DOM orchestration** with declarative Vue template bindings and component composition
- **Preserve the plugin system contract** — `FrontendHookDispatcher`, `frontendHooks.dispatch('frontend-render', ctx)`, and dynamic `import('/plugins/{name}/frontend.js')` remain compatible
- **Preserve all API integrations** — all 14 backend API endpoints called by the frontend remain unchanged
- **Rewrite existing Deno tests** to use Vue Test Utils + Vitest while maintaining equivalent coverage for all parsers, renderers, and hook dispatcher
- **Preserve all UI text in Traditional Chinese** (zh-TW) as-is
- **BREAKING**: The frontend now requires a build step (`deno task build:reader`) before serving; raw ES module serving is replaced by Vite-bundled output

## Capabilities

### New Capabilities
- `vue-component-architecture`: Vue 3 component hierarchy, SFC structure, composables for shared state (auth, navigation, chapters, plugins), and Vite build integration with Deno
- `vue-frontend-tests`: Vue Test Utils + Vitest test suite replacing current Deno-based frontend tests, covering component rendering, composable logic, and integration tests

### Modified Capabilities
- `chapter-navigation`: Navigation state moves from module-scoped object to a Vue composable with reactive refs; dual-mode (FSA/Backend) and polling behavior preserved
- `chat-input`: Chat input becomes a Vue component with v-model bindings, emits events instead of callback injection pattern
- `file-reader`: File System Access API and IndexedDB logic extracted into a composable; API surface unchanged
- `md-renderer`: Rendering pipeline becomes a composable that integrates with Vue's reactivity; plugin hook dispatch and placeholder/reinjection pattern preserved
- `status-bar`: Status block parser preserved as utility; rendering becomes a Vue component with props
- `options-panel`: Options parser preserved as utility; rendering becomes a Vue component with scoped event handling (no more global click listener)
- `variable-display`: Variable block parser preserved as utility; rendering becomes a Vue component
- `vento-error-handling`: Error display becomes a Vue component with typed props
- `passphrase-gate`: Auth state moves to a composable with reactive passphrase; overlay becomes a Vue component
- `plugin-hooks`: FrontendHookDispatcher class preserved as-is for backward compatibility with existing plugin `frontend.js` modules
- `plugin-core`: Frontend plugin loading becomes a composable; plugin contract (`register(frontendHooks)`) unchanged for backward compatibility
- `story-selector`: Cascading dropdowns become a Vue component with reactive series/story state
- `prompt-editor`: Editor becomes a Vue component with v-model, localStorage sync via composable
- `prompt-preview`: Preview panel becomes a Vue component with typed API response handling
- `page-layout`: CSS custom properties and grid layout extracted from inline styles into a theme module and component-scoped styles
- `frontend-background`: Background image fetching moves into a composable; CSS rendering preserved
- `frontend-tests`: Test framework migrates from Deno.test + @std/assert to Vitest + Vue Test Utils; all existing test cases preserved and expanded
- `security-headers`: CSP meta tag updated to reflect Vite-bundled output (no more `unsafe-eval` for Tailwind CDN); DOMPurify usage preserved in components
- `display-strip-tags`: Declarative strip tag compilation moves into the plugin composable; regex safety check preserved
- `auto-reload`: Polling logic preserved in chapter navigation composable; no behavioral change

## Impact

- **Frontend code** (`reader/`): Complete rewrite — all 15 JS modules replaced by Vue SFCs and composables; `index.html` reduced to a Vue mount point
- **Build system**: New Vite build step added; `deno.json` gains `build:reader` and `dev:reader` tasks
- **Dependencies**: New npm dependencies — `vue@3`, `@vitejs/plugin-vue`, `vite`, `vitest`, `@vue/test-utils`; CDN dependencies (marked, DOMPurify) become npm imports; Tailwind CSS moves to PostCSS plugin
- **Tests** (`tests/reader/`): All 7 test files rewritten using Vitest + Vue Test Utils; test count and coverage maintained or expanded
- **Backend** (`writer/`): Static file serving route updated to serve Vite build output instead of raw `reader/` directory
- **Plugin contract**: Existing plugin `frontend.js` modules continue to work — `register(frontendHooks)` signature unchanged
- **Container build** (`Containerfile`): Updated to include `deno task build:reader` step
- **Deployment**: `serve.zsh` may need updates if it references `reader/` directly

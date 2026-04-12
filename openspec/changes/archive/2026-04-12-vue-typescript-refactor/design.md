## Context

The HeartReverie frontend (`reader/`) is a vanilla JavaScript application comprising 15 ES modules (~1,600 LOC) and a monolithic `index.html` (~979 lines containing all CSS inline and a ~130-line orchestrator `<script>`). The architecture relies on imperative DOM manipulation, module-scoped mutable state objects (e.g., the private `state` in `chapter-nav.js`), and dependency injection via callbacks (e.g., `initChatInput(elements, { getContext, getTemplate, onSent })`). Global side effects exist — `options-panel.js` registers a document-level click listener at import time. There is no build step; modules are served raw over HTTPS and CDN scripts (Tailwind 3.4.17, marked.js 15.0.12, DOMPurify 3.3.3) are loaded via `<script>` tags.

The plugin system exposes a `FrontendHookDispatcher` class (`plugin-hooks.js`) with a `register(stage, handler, priority)` / `dispatch(stage, context)` contract. Plugin `frontend.js` modules are dynamically imported via `import('/plugins/{name}/frontend.js')` and call `register(frontendHooks)` to hook into the `'frontend-render'` stage. The rendering pipeline in `md-renderer.js` uses an **Extract → Placeholder → Reinsert** pattern: custom XML blocks (`<status>`, `<options>`, `<UpdateVariable>`) are extracted before `marked.parse()`, then reinjected as rendered HTML after sanitization.

Tests live in `tests/reader/js/` (7 test files) and run via `deno test --allow-read tests/reader/js/` using `Deno.test` + `@std/assert`.

This refactor migrates the frontend to **Vue 3 + TypeScript** with **Vite** build tooling while preserving all existing behavior, the plugin contract, all 14 backend API endpoints, and Traditional Chinese (zh-TW) UI text. See `proposal.md` for full motivation.

### Constraints

- All backend routes and API contracts remain unchanged.
- The `FrontendHookDispatcher` class API (`register`, `dispatch`) and the plugin `register(frontendHooks)` calling convention must remain backward-compatible with existing plugin `frontend.js` modules.
- UI text stays in Traditional Chinese (zh-TW) as hardcoded strings — no i18n framework.
- The Deno-based backend (`writer/server.ts`) continues to serve the frontend; only the served directory changes (build output instead of raw source).
- The existing `deno.json` compiler options (`strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`) are the baseline for the Vue project's `tsconfig.json`.

---

## Goals / Non-Goals

### Goals

1. **Component-based architecture** — Replace 15 imperative JS modules with Vue 3 Single File Components (SFCs), making the UI declarative and composable.
2. **Type safety** — TypeScript across all frontend code with strict checking, catching bugs at compile time instead of runtime.
3. **Reactive state management** — Convert module-scoped mutable state (e.g., the `state` object in `chapter-nav.js`, `sessionStorage` passphrase in `passphrase-gate.js`) to Vue reactive primitives (`ref`, `reactive`, `computed`).
4. **Improved testability** — Components and composables are independently testable; composables can be unit-tested without DOM; components tested via Vue Test Utils.
5. **Vite build integration** — Introduce a proper build step with HMR for development, tree-shaking for production, and integration into the existing Deno project via `deno.json` tasks.
6. **Eliminate global side effects** — Scoped event handling within components replaces document-level listeners (e.g., the global click handler in `options-panel.js`).
7. **CSS modernization** — Extract ~979 lines of inline CSS into component-scoped styles and a shared theme module; use Tailwind via PostCSS for unused-style purging.

### Non-Goals

- **Backend changes** — No modifications to `writer/` route handlers, middleware, or API contracts.
- **New features** — This is a 1:1 migration; no new UI functionality is introduced.
- **i18n framework** — UI text remains hardcoded zh-TW strings; adding `vue-i18n` or similar is out of scope.
- **Server-side rendering (SSR)** — The frontend remains a client-side SPA.
- **Changing the plugin contract** — Existing plugin `frontend.js` modules must continue to work without modification.
- **Replacing marked.js or DOMPurify** — The rendering pipeline keeps the same libraries, just imported via npm instead of CDN.

---

## Decisions

### 1. Vue 3 Composition API + `<script setup>` over Options API

**Decision**: All components use `<script setup lang="ts">` with Composition API.

**Rationale**: The existing codebase already uses a pattern that maps naturally to Composition API — module-scoped state with exported functions (e.g., `chapter-nav.js` exports `initChapterNav`, `navigateTo`, etc.). `<script setup>` reduces boilerplate vs. `defineComponent()` and provides better TypeScript type inference without explicit type annotations on `this`. Composables (`useAuth`, `useChapterNav`, etc.) replace module-scoped state with the same co-location pattern but with reactivity.

**Alternatives considered**:
- *Options API*: More familiar to some developers but requires `this` typing workarounds, doesn't map as cleanly to the existing module-function pattern, and composables are the idiomatic Vue 3 approach for shared logic.
- *Class-based components (vue-class-component)*: Abandoned by the Vue ecosystem; poor TypeScript DX compared to `<script setup>`.

### 2. Vite as build tool

**Decision**: Use Vite with `@vitejs/plugin-vue` as the frontend build tool, integrated into the Deno project via `deno.json` tasks.

**Rationale**: Vite is the official Vue build tool with native SFC support, fast HMR, and production optimizations (tree-shaking, code splitting, CSS extraction). For Deno integration, Vite runs as a Node.js tool invoked by Deno tasks — `deno task dev:reader` for development, `deno task build:reader` for production. Vue source code uses standard npm imports; no Deno import map integration is needed. The `reader-src/` directory has its own `package.json` and `node_modules/`, so no Deno-style imports exist in the Vue source.

**Alternatives considered**:
- *esbuild + custom Vue plugin*: Faster builds but lacks mature Vue SFC support, HMR, and the plugin ecosystem.
- *Webpack*: Slower, more complex configuration, being superseded by Vite in the Vue ecosystem.
- *No build step (keep CDN imports)*: Incompatible with SFC compilation, TypeScript, and tree-shaking goals.

**Deno integration approach**: The `reader-src/` directory contains a `package.json` with Vue/Vite dev dependencies. Vite is invoked via `npx` or a direct `node_modules/.bin/vite` path from Deno tasks:

```jsonc
// deno.json additions
{
  "tasks": {
    "dev:reader": "cd reader-src && npx vite",
    "build:reader": "cd reader-src && npx vite build --outDir ../reader-dist",
    "test:frontend": "cd reader-src && npx vitest run"
  }
}
```

**HTTPS proxy consideration**: The Deno backend serves HTTPS with self-signed certificates. The Vite dev server proxy must set `secure: false` in its proxy configuration to accept self-signed certs when forwarding to `https://localhost:8443`:

```typescript
// vite.config.ts proxy snippet
server: {
  proxy: {
    '/api': { target: 'https://localhost:8443', secure: false, changeOrigin: true },
    '/plugins': { target: 'https://localhost:8443', secure: false, changeOrigin: true },
    '/assets': { target: 'https://localhost:8443', secure: false, changeOrigin: true },
  }
}
```

> **Note on `/js/*` paths**: The dev proxy does NOT forward `/js/*` requests because built-in plugin `frontend.js` modules will be updated to remove `/js/*` imports as part of this migration. Third-party plugins importing from `/js/*` will break — this is a documented breaking change. If temporary backward compatibility is needed during migration, an additional proxy rule `'/js': { target: 'https://localhost:8443', secure: false, changeOrigin: true }` can be added.

### 3. Composables for shared state over Pinia/Vuex

**Decision**: Use Vue composables (`useAuth`, `useChapterNav`, `useFileReader`, `usePlugins`, `useStorySelector`, `usePromptEditor`, `useChatApi`, `useBackground`, `useMarkdownRenderer`) with `ref`/`reactive`/`computed` for all shared state.

**Rationale**: The current state surface is modest — `chapter-nav.js` has ~8 state fields, `passphrase-gate.js` has 1, `story-selector.js` has ~3, `plugin-loader.js` has ~2. This is well within the scale where composables with module-level singleton refs are simpler and more direct than a store library. Each composable maps 1:1 to an existing module's state, preserving the mental model.

**Pattern**:
```typescript
// composables/useAuth.ts
const passphrase = ref('');
const isAuthenticated = ref(false);

export function useAuth() {
  // ... reactive logic
  return { passphrase: readonly(passphrase), isAuthenticated, login, logout, getAuthHeaders };
}
```

**Alternatives considered**:
- *Pinia*: Adds a dependency and boilerplate (store definitions, `defineStore`) that isn't warranted at this scale. Can be adopted later if state grows.
- *Vuex*: Legacy; Pinia is the recommended replacement. Unnecessarily complex for this use case.

### 4. FrontendHookDispatcher preserved as plain TypeScript class

**Decision**: Port `FrontendHookDispatcher` to TypeScript but keep it as a standalone class, not a Vue composable. It is instantiated at module scope and exported, exactly as today.

**Rationale**: Existing plugin `frontend.js` modules call `register(frontendHooks)` where `frontendHooks` is the dispatcher instance. These plugins are plain JavaScript and know nothing about Vue. The dispatcher must remain importable as a plain object. A `usePlugins()` composable wraps the dispatcher for Vue component consumption, but the dispatcher itself stays framework-agnostic.

```typescript
// lib/plugin-hooks.ts (framework-agnostic)
export class FrontendHookDispatcher {
  #handlers = new Map<string, Array<{ handler: Function; priority: number }>>();
  register(stage: string, handler: Function, priority = 100): void { /* ... */ }
  dispatch(stage: string, context: Record<string, unknown>): Record<string, unknown> { /* ... */ }
}

// composables/usePlugins.ts (Vue layer)
import { frontendHooks } from '../lib/plugin-hooks';
export function usePlugins() {
  // Wraps dispatcher for reactive plugin state in components
}
```

**Alternatives considered**:
- *Rewrite dispatcher as a composable*: Breaks backward compatibility with all existing plugin `frontend.js` modules that expect a class instance with `register`/`dispatch`.
- *Provide/inject pattern*: Adds unnecessary indirection; plugins don't use Vue's dependency injection.

### 5. marked.js + DOMPurify as npm dependencies

**Decision**: Install `marked` and `dompurify` as npm dependencies in `reader-src/package.json` instead of loading from CDN.

**Rationale**: npm imports provide TypeScript type definitions (`@types/dompurify`, marked ships its own), enable tree-shaking (only import `parse` from marked), and eliminate CDN availability as a runtime dependency. The rendering pipeline (`md-renderer.js` → `useMarkdownRenderer.ts`) benefits from typed `MarkedOptions` and `DOMPurify.Config`.

**Alternatives considered**:
- *Keep CDN*: No type safety, no tree-shaking, requires `declare global` ambient types, and makes offline development impossible.
- *Import maps*: Could pin CDN URLs in an import map, but still no types and no tree-shaking.

### 6. Tailwind CSS via PostCSS plugin

**Decision**: Replace the Tailwind CDN (`<script src="cdn.tailwindcss.com">`) with `tailwindcss@^3.4` as a PostCSS plugin in the Vite build. Pinning to `^3.4` avoids accidentally installing Tailwind v4, which uses a completely different configuration format (CSS-based config instead of `tailwind.config.ts`).

**Rationale**: The CDN version requires `unsafe-eval` in the Content Security Policy (it compiles styles at runtime via `eval`). The PostCSS plugin runs at build time, purges unused classes (the current CDN loads the entire framework), and produces a static CSS file compatible with strict CSP. Vite has first-class PostCSS support — just add `tailwind.config.ts` and `postcss.config.ts`.

**Alternatives considered**:
- *Keep CDN*: Retains `unsafe-eval` CSP requirement, ships ~300KB of unused CSS, no build-time purging.
- *Replace Tailwind entirely (e.g., UnoCSS)*: Additional migration effort with no clear benefit; Tailwind utility classes are already used throughout the CSS.
- *CSS Modules only, drop Tailwind*: Would require rewriting all utility class usage; too large a scope change.

### 7. Vitest + Vue Test Utils for testing

**Decision**: Use Vitest as the test runner and Vue Test Utils for component testing, replacing the current Deno.test + @std/assert approach.

**Rationale**: Vitest shares Vite's transform pipeline (handles SFCs, TypeScript, CSS), has native Vue Test Utils integration, and supports the same assertion patterns (`expect(x).toBe(y)`). It runs in a jsdom or happy-dom environment, providing `document` and `window` that the current tests simulate with stubs. Each of the 7 existing test files maps to a Vitest equivalent.

**Test task integration**:
```jsonc
{
  "tasks": {
    "test:frontend": "cd reader-src && npx vitest run",
    "test": "deno test --allow-read --allow-write --allow-env --allow-net tests/writer/ && cd reader-src && npx vitest run"
  }
}
```

**Alternatives considered**:
- *Keep Deno.test*: Cannot import Vue SFCs or use Vue Test Utils; would require complex Deno-to-Node interop.
- *Jest*: Slower, requires more configuration for ESM and Vue SFC transforms; Vitest is the natural choice with Vite.
- *Playwright/Cypress component testing*: Heavier, better suited for E2E; Vitest + Vue Test Utils covers unit and integration.

### 8. Component hierarchy

**Decision**: The component tree follows this structure:

```
App.vue
├── PassphraseGate.vue        ← overlay, controls auth flow
└── MainLayout.vue            ← visible after auth
    ├── AppHeader.vue          ← story selector, mode toggle, settings
    │   ├── StorySelector.vue
    │   ├── PromptEditor.vue
    │   └── PromptPreview.vue   ← rendered system prompt preview
    ├── ContentArea.vue        ← chapter display
    │   └── ChapterContent.vue
    │       ├── StatusBar.vue         ← from <status> blocks
    │       ├── OptionsPanel.vue      ← from <options> blocks
    │       ├── VariableDisplay.vue   ← from <UpdateVariable> blocks
    │       └── VentoErrorCard.vue    ← from Vento template errors
    ├── Sidebar.vue            ← chapter list, navigation
    └── ChatInput.vue          ← message input + send
```

**Rationale**: Maps directly to the existing module responsibilities. Leaf components (`StatusBar`, `OptionsPanel`, `VariableDisplay`, `VentoErrorCard`) are pure renderers that receive parsed data as props — their extraction/parsing logic lives in utility functions, not in the components. This separation preserves testability of parsers independently from rendering.

**Parser utilities** (non-component TypeScript modules):
- `lib/parsers/status-parser.ts` — `extractStatusBlocks()`, `parseStatus()`
- `lib/parsers/options-parser.ts` — `extractOptionsBlocks()`, `parseOptions()`
- `lib/parsers/variable-parser.ts` — `extractVariableBlocks()`
- `lib/parsers/vento-error-parser.ts` — `extractVentoErrors()`
- `lib/string-utils.ts` — `escapeHtml()` and shared utilities

### 9. CSS strategy

**Decision**: Use a three-layer CSS approach:
1. **Theme layer** (`styles/theme.css`): CSS custom properties for colors, spacing, fonts, breakpoints — sourced from the current inline `<style>` block.
2. **Component scoped styles** (`<style scoped>`): Per-component styles that reference theme variables.
3. **Tailwind utilities**: For layout and spacing via PostCSS, available globally.

**Rationale**: The current `index.html` has ~979 lines mixing structural layout, theme values, component-specific styles, and Tailwind utilities. Extracting theme variables into CSS custom properties enables consistent theming across components without a CSS-in-JS runtime. `<style scoped>` prevents class name collisions that the current global stylesheet is prone to.

**Alternatives considered**:
- *CSS Modules*: More explicit but verbose; scoped styles achieve the same isolation with less boilerplate in SFCs.
- *Tailwind only*: Would require converting all custom CSS to utility classes; many current styles (gradients, animations, custom card layouts) don't map cleanly.
- *styled-components / CSS-in-JS*: Adds runtime overhead and a dependency; Vue's built-in scoped styles are sufficient.

---

## Risks / Trade-offs

### Build step required
**Risk**: The frontend now requires `deno task build:reader` before serving, breaking the current "edit and refresh" workflow.
**Mitigation**: `deno task dev:reader` runs Vite dev server with HMR — the development experience is actually faster than full-page refreshes. This is documented as a **BREAKING** change in the proposal. The `Containerfile` and `serve.zsh` are updated to include the build step. CI/CD runs `build:reader` before deployment.

### Plugin backward compatibility
**Risk**: Existing plugin `frontend.js` modules dynamically import from `/plugins/{name}/frontend.js` and expect `frontendHooks` to be a `FrontendHookDispatcher` instance with `register(stage, handler, priority)`.
**Mitigation**: The `FrontendHookDispatcher` class is ported to TypeScript with the identical public API. The Vite build output exposes plugin-facing modules at the same URL paths (via Vite proxy config in dev, static serving in production). Plugin modules remain plain JavaScript — they are not processed by Vite. Integration tests verify that existing plugin `register()` calls work against the ported dispatcher.

### Plugin `/js/*` import path breakage
**Risk**: Four built-in plugin `frontend.js` modules import from absolute paths that will no longer exist after the Vite build:
- `plugins/status/frontend.js` → `import { escapeHtml } from '/js/utils.js'`
- `plugins/options/frontend.js` → `import { escapeHtml } from '/js/utils.js'` and `import { appendToInput } from '/js/chat-input.js'`
- `plugins/state-patches/frontend.js` → `import { escapeHtml } from '/js/utils.js'`
- `plugins/thinking/frontend.js` → `import { escapeHtml } from '/js/utils.js'`

After the Vite build, `reader-dist/` contains hashed bundles — `/js/utils.js` and `/js/chat-input.js` no longer exist at those paths. The dev proxy only covers `/api`, `/plugins`, `/assets` — not `/js/*`.
**Mitigation**: Update all four built-in plugin `frontend.js` modules to remove `/js/*` imports. Utilities like `escapeHtml` will be inlined or provided through an alternative mechanism (e.g., a shared utility module served alongside plugin files, or context injection). The `options` plugin's `appendToInput` dependency will be replaced with Vue's provide/inject pattern (already planned in task 7.6). Third-party plugins importing from `/js/*` paths will break — this is documented as a **BREAKING** change for the plugin contract.

### Plugin name identity in delta specs
**Risk**: Some delta specs use conceptual names (`status-bar`, `options-panel`, `variable-display`) that differ from actual plugin manifest/directory names (`status`, `options`, `state-patches`). If implementors follow spec names literally, plugins would fail to load because `PluginManager` requires the manifest `name` field to match the directory name.
**Mitigation**: Delta specs clarify that Vue component filenames (e.g., `StatusBar.vue`) are independent from plugin directory names. All plugin manifests, directory names, and `/plugins/{name}/frontend.js` URL paths retain their original names.

### File System Access API in Vue
**Risk**: The File System Access API (`showDirectoryPicker`, `FileSystemDirectoryHandle`) requires user gesture and has lifecycle concerns — handles become invalid if the user navigates away.
**Mitigation**: Wrap all FSA logic in a `useFileReader` composable that:
- Stores `FileSystemDirectoryHandle` in a `shallowRef` (avoids deep reactivity on browser API objects).
- Provides `onUnmounted` cleanup for any open file readers.
- Persists/restores handles via IndexedDB (same as current `file-reader.js`).
- Exposes `readonly` refs to prevent components from mutating handle state directly.

### Vite + Deno integration
**Risk**: Vite is a Node.js tool; running it from Deno tasks may cause module resolution issues or version conflicts.
**Mitigation**: The `reader-src/` directory has its own `package.json` and `node_modules/`, completely isolated from Deno's import map in `deno.json`. Deno tasks invoke Vite via `npx` (which uses the local `node_modules`). This is a proven pattern — Deno's own documentation recommends this approach for using Node.js tooling. Early spike: set up the Vite project skeleton and verify `build` + `dev` commands work before porting any code.

### Large migration scope
**Risk**: Rewriting 15 modules + tests + CSS in one change risks introducing regressions.
**Mitigation**: Incremental migration in 7 phases (see Migration Plan). Each phase is independently testable. The original `reader/` is preserved on a `reader-legacy` branch until the migration is fully validated. During development, both old and new frontends can coexist (Deno serves one or the other based on a config flag or build output presence).

### Test migration and coverage regression
**Risk**: Rewriting 7 test files from Deno.test to Vitest may lose test cases or change assertion semantics.
**Mitigation**: Create a test mapping document that lists every `Deno.test(...)` case and its Vitest equivalent. Run both test suites in parallel during migration. The mapping covers:

| Current test file | Test count | Vitest equivalent |
|---|---|---|
| `md-renderer_test.js` | parser + pipeline tests | `__tests__/composables/useMarkdownRenderer.test.ts` |
| `status-bar_test.js` | extraction + parsing | `__tests__/lib/parsers/status-parser.test.ts` |
| `options-panel_test.js` | extraction + parsing | `__tests__/lib/parsers/options-parser.test.ts` |
| `variable-display_test.js` | extraction + parsing | `__tests__/lib/parsers/variable-parser.test.ts` |
| `vento-error-display_test.js` | extraction | `__tests__/lib/parsers/vento-error-parser.test.ts` |
| `plugin-hooks_test.js` | dispatcher logic | `__tests__/lib/plugin-hooks.test.ts` |
| `utils_test.js` | escapeHtml, utilities | `__tests__/lib/string-utils.test.ts` |

---

## Migration Plan

### Phase 1: Tooling setup
Set up the `reader-src/` directory with:
- `package.json` (vue, vite, @vitejs/plugin-vue, typescript, vitest, @vue/test-utils, tailwindcss@^3.4, postcss, autoprefixer, marked, dompurify, @types/dompurify)
- `vite.config.ts` (Vue plugin, build output to `reader-dist/`, dev server proxy to Deno backend on `:8443`)
- `tsconfig.json` (strict settings matching `deno.json` compiler options, Vue-specific paths)
- `tailwind.config.ts` + `postcss.config.ts`
- Minimal `App.vue` with "Hello World" to validate the full toolchain
- `deno.json` task additions: `dev:reader`, `build:reader`, `test:frontend`

**Validation**: `deno task build:reader` produces output in `reader-dist/`; `deno task dev:reader` serves with HMR.

### Phase 2: Port pure utilities and parsers
Migrate framework-agnostic code to TypeScript:
- `utils.js` → `lib/string-utils.ts` (escapeHtml, etc.)
- `status-bar.js` extraction/parsing → `lib/parsers/status-parser.ts`
- `options-panel.js` extraction/parsing → `lib/parsers/options-parser.ts`
- `variable-display.js` extraction/parsing → `lib/parsers/variable-parser.ts`
- `vento-error-display.js` extraction → `lib/parsers/vento-error-parser.ts`
- `plugin-hooks.js` → `lib/plugin-hooks.ts`

These modules have zero DOM dependencies and can be ported with direct type annotations. Existing test logic is migrated to Vitest in parallel.

**Validation**: All parser tests pass in Vitest; output matches current behavior.

### Phase 3: Create composables
Convert module-scoped state to reactive composables:
- `passphrase-gate.js` → `composables/useAuth.ts`
- `chapter-nav.js` state → `composables/useChapterNav.ts`
- `file-reader.js` → `composables/useFileReader.ts`
- `plugin-loader.js` → `composables/usePlugins.ts`
- `story-selector.js` state → `composables/useStorySelector.ts`
- `prompt-editor.js` state → `composables/usePromptEditor.ts`
- `md-renderer.js` pipeline → `composables/useMarkdownRenderer.ts`
- `chat-input.js` state → `composables/useChatApi.ts`
- Background image config → `composables/useBackground.ts`

Each composable is unit-testable without mounting components.

**Validation**: Composable unit tests pass; reactive state updates propagate correctly.

### Phase 4: Build Vue components bottom-up
Start with leaf components that have no child components:
1. `StatusBar.vue`, `OptionsPanel.vue`, `VariableDisplay.vue`, `VentoErrorCard.vue` — pure rendering from props
2. `ChatInput.vue`, `StorySelector.vue`, `PromptEditor.vue` — form components using composables
3. `PassphraseGate.vue` — auth overlay using `useAuth`
4. `ChapterContent.vue`, `ContentArea.vue`, `Sidebar.vue` — layout components
5. `AppHeader.vue`, `MainLayout.vue` — structural containers
6. `App.vue` — root component wiring everything together

**Validation**: Each component renders correctly in isolation via Vue Test Utils; visual comparison against current UI.

### Phase 5: Wire up App.vue and replace index.html
- `App.vue` replaces the ~130-line inline `<script>` orchestrator
- `index.html` becomes a minimal Vite entry point (`<div id="app">` + `<script type="module" src="main.ts">`)
- Plugin loading moved to `usePlugins` composable, invoked in `App.vue`'s `onMounted`
- Dev proxy routes `/api/*` and `/plugins/*` to the Deno backend

**Validation**: Full application flow works end-to-end (auth → story selection → chapter reading → chat → options); plugin hooks fire correctly.

### Phase 6: Migrate tests
- Map every existing `Deno.test` case to a Vitest `it`/`test` case (see test mapping table in Risks section)
- Add component tests for critical interactions (auth flow, chapter navigation, chat submission)
- Add integration tests for the rendering pipeline (markdown input → final HTML output)

**Validation**: Test count ≥ current count; all existing behaviors covered.

### Phase 7: Update build pipeline
- `Containerfile`: Add `deno task build:reader` step; serve `reader-dist/` instead of `reader/`
- `serve.zsh`: Update to serve from `reader-dist/` (or make configurable via `READER_DIR` env var, which already exists)
- `deno.json`: Update `test` task to include Vitest; remove old `test:frontend` if replaced
- Backend `server.ts`: Update static file serving to point to `reader-dist/` (already configurable via `READER_DIR`)
- CSP meta tag: Remove `unsafe-eval`; update SRI hashes for Vite-bundled output

**Validation**: Container builds and runs; `serve.zsh` starts correctly; all tests pass in CI.

### Rollback strategy
The original `reader/` directory is preserved on a `reader-legacy` branch. If the migration encounters blocking issues:
1. Revert `READER_DIR` to `./reader` in environment config.
2. Revert `deno.json` task changes.
3. The backend serves the original vanilla JS frontend unchanged.

---

## Open Questions

1. **Tailwind retention**: Should Tailwind CSS be replaced with a lighter utility-first solution (e.g., UnoCSS), or kept as-is via PostCSS? Tailwind adds a build dependency but is already used throughout the CSS. UnoCSS is lighter but requires learning new conventions.

2. **Pinia adoption**: Should Pinia be introduced for state management, or are composables-only sufficient? Current state is simple (~15 reactive fields total across all modules), but if cross-component state sharing becomes complex during implementation, Pinia may be warranted. **Recommendation**: Start with composables; introduce Pinia only if composable imports become circular or state debugging becomes difficult.

3. ~~**Directory structure**: Should the Vue source live in `reader-src/` with build output in `reader-dist/`, or should `reader/` be repurposed as the source with output in `reader/dist/`?~~ **Resolved**: Using `reader-src/` → `reader-dist/` as decided throughout this design (see Decision 2, Phase 1, Phase 7). This avoids confusion with the current `reader/` directory during migration and preserves existing `READER_DIR` semantics.

4. **Plugin module serving in dev mode**: During Vite dev, how are plugin `frontend.js` files served? They live in `plugins/` (outside `reader-src/`) and must be importable via `import('/plugins/{name}/frontend.js')`. **Recommendation**: Configure Vite dev server proxy to forward `/plugins/*` requests to the Deno backend, which already serves them.

5. **Google Fonts loading strategy**: Currently loaded via `<link>` tags in `index.html`. Should these move to a `@import` in the CSS theme file, remain as `<link>` tags in the Vite entry HTML, or use `vite-plugin-fonts`? **Recommendation**: Keep as `<link>` tags in the Vite `index.html` for simplicity — font loading is orthogonal to the build pipeline.

# Tasks — vue-typescript-refactor

## 1. Project Setup & Tooling

- [ ] 1.1 Create `reader-src/` directory structure: `src/`, `src/components/`, `src/composables/`, `src/lib/`, `src/lib/parsers/`, `src/styles/`, `src/types/`
- [ ] 1.2 Create `reader-src/package.json` with dependencies: `vue@3`, `marked`, `dompurify`, `@types/dompurify`; devDependencies: `vite`, `@vitejs/plugin-vue`, `typescript`, `vitest`, `@vue/test-utils`, `happy-dom`, `tailwindcss@^3.4`, `postcss`, `autoprefixer`
- [ ] 1.3 Run `npm install` in `reader-src/` to generate `node_modules/` and `package-lock.json`
- [ ] 1.4 Create `reader-src/tsconfig.json` with strict settings matching `deno.json` compiler options (`strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`), Vue-specific paths, and `@vitejs/plugin-vue` SFC support
- [ ] 1.5 Create `reader-src/vite.config.ts` with `@vitejs/plugin-vue` plugin, build output to `../reader-dist/`, `build.sourcemap: true` for production source maps, dev server proxy for `/api/*` and `/plugins/*` to Deno backend on `:8443`
- [ ] 1.6 Create `reader-src/tailwind.config.ts` scanning `src/**/*.{vue,ts}` and `reader-src/postcss.config.ts` with Tailwind + Autoprefixer plugins
- [ ] 1.7 Add `deno.json` tasks: `dev:reader` (`cd reader-src && npx vite`), `build:reader` (`cd reader-src && npx vite build --outDir ../reader-dist`), `test:frontend` (`cd reader-src && npx vitest run`)
- [ ] 1.8 Create minimal `reader-src/index.html` (Vite entry point with `<div id="app">` and `<script type="module" src="/src/main.ts">`)
- [ ] 1.9 Create minimal `reader-src/src/main.ts` and `reader-src/src/App.vue` ("Hello World") to validate toolchain
- [ ] 1.10 Verify `deno task build:reader` produces output in `reader-dist/` and `deno task dev:reader` starts with HMR
- [ ] 1.11 Add `reader-dist/`, `reader-src/node_modules/`, and `.vite/` to `.gitignore`

## 2. TypeScript Types & Interfaces

- [ ] 2.1 Define shared types in `reader-src/src/types/index.ts`: `ChapterData`, `StoryInfo`, `SeriesInfo`, `AuthHeaders`, `PluginDescriptor`, `PluginManifest`
- [ ] 2.2 Define component prop interfaces: `StatusBarProps`, `OptionsPanelProps`, `VariableDisplayProps`, `VentoErrorCardProps`, `ChapterContentProps`, `ChatInputProps`, `StorySelectorProps`, `PromptEditorProps`, `PromptPreviewProps`
- [ ] 2.3 Define component emit interfaces for `ChatInput`, `StorySelector`, `OptionsPanel`, `PassphraseGate`
- [ ] 2.4 Define composable return type interfaces: `UseAuthReturn`, `UseFileReaderReturn`, `UseChapterNavReturn`, `UsePluginsReturn`, `UseStorySelectorReturn`, `UsePromptEditorReturn`, `UseMarkdownRendererReturn`
- [ ] 2.5 Define hook system types: `HookHandler<T>`, `FrontendRenderContext`, hook stage string literal union, tag handler registry types

## 3. Pure Utilities & Parsers (no Vue dependency)

- [ ] 3.1 Port `utils.js` → `reader-src/src/lib/string-utils.ts` (`escapeHtml` and shared utilities)
- [ ] 3.2 Port status-bar parser → `reader-src/src/lib/parsers/status-parser.ts` (`extractStatusBlocks`, `parseStatus`)
- [ ] 3.3 Port options-panel parser → `reader-src/src/lib/parsers/options-parser.ts` (`extractOptionsBlocks`, `parseOptions`)
- [ ] 3.4 Port variable-display parser → `reader-src/src/lib/parsers/variable-parser.ts` (`extractVariableBlocks`)
- [ ] 3.5 Port vento-error-display → `reader-src/src/lib/parsers/vento-error-parser.ts` (`extractVentoErrors`)
- [ ] 3.6 Port `plugin-hooks.js` → `reader-src/src/lib/plugin-hooks.ts` (preserve `FrontendHookDispatcher` class API with TypeScript types; keep as standalone class, not composable)
- [ ] 3.7 Create `reader-src/src/lib/markdown-pipeline.ts` for quote normalisation, newline doubling, and placeholder reinsertion utilities as pure functions
- [ ] 3.8 Create `reader-src/src/lib/file-utils.ts` for numeric filename filtering and numeric sort utility functions

## 4. Composables

- [ ] 4.1 Create `useAuth()` composable (`reader-src/src/composables/useAuth.ts`): singleton reactive `passphrase` ref synced with `sessionStorage`, `isAuthenticated` computed, `verify()` method calling `GET /api/auth/verify`, `getAuthHeaders()` returning `{ 'X-Passphrase': passphrase }` or empty object
- [ ] 4.2 Create `useFileReader()` composable (`reader-src/src/composables/useFileReader.ts`): `isSupported` ref, `directoryHandle` shallowRef, `files` ref, `hasStoredHandle` ref, `openDirectory()`, `restoreHandle()`, `readFile()`, `clearStoredHandle()`, IndexedDB persistence, `onUnmounted` cleanup
- [ ] 4.3 Create `useChapterNav()` composable (`reader-src/src/composables/useChapterNav.ts`): reactive `currentIndex`, `chapters`, `totalChapters` computed, `isFirst`/`isLast`/`isLastChapter` computed, `next()`/`previous()`, `loadFromFSA()`/`loadFromBackend()`, `mode` ref (`'fsa' | 'backend'`), URL hash sync via `watch`, scroll-to-top on chapter change, polling in backend mode, `onUnmounted` cleanup
- [ ] 4.4 Create `usePlugins()` composable (`reader-src/src/composables/usePlugins.ts`): wraps `FrontendHookDispatcher`, reactive `plugins` ref, `initPlugins()` function, plugin dynamic import via `/plugins/{name}/frontend.js`, tag handler registry integration, display strip tags compilation
- [ ] 4.5 Create `useStorySelector()` composable (`reader-src/src/composables/useStorySelector.ts`): reactive `seriesList`, `storyList`, `selectedSeries`, `selectedStory` refs, `fetchSeries()`, `fetchStories()`, `createStory()` methods, auth headers via `useAuth()`
- [ ] 4.6 Create `usePromptEditor()` composable (`reader-src/src/composables/usePromptEditor.ts`): reactive `templateContent` ref with localStorage auto-sync, `saveTemplate()`, `loadTemplate()`, `previewTemplate()` methods
- [ ] 4.7 Create `useMarkdownRenderer()` composable (`reader-src/src/composables/useMarkdownRenderer.ts`): rendering pipeline using `marked` + `DOMPurify` npm imports, extract→placeholder→reinsert pattern, plugin tag handler registry lookup, `v-html`-compatible sanitized HTML output
- [ ] 4.8 Create `useChatApi()` composable (`reader-src/src/composables/useChatApi.ts`): `sendMessage()` and `resendMessage()` methods calling POST/DELETE endpoints, `isLoading` ref, `errorMessage` ref, auth headers via `useAuth()`
- [ ] 4.9 Create `useBackground()` composable (`reader-src/src/composables/useBackground.ts`): background image URL fetching from `/assets/` config

## 5. Vue Components (leaf → containers)

- [ ] 5.1 Create `StatusBar.vue` (`reader-src/src/components/StatusBar.vue`): typed props via `defineProps<StatusBarProps>()`, renders parsed status data, scoped styles
- [ ] 5.2 Create `OptionsPanel.vue` (`reader-src/src/components/OptionsPanel.vue`): typed props and emits, 2×2 button grid, scoped click handling (no global listener), emits option selection event
- [ ] 5.3 Create `VariableDisplay.vue` (`reader-src/src/components/VariableDisplay.vue`): typed props, collapsible `<pre>` display for `<UpdateVariable>` blocks
- [ ] 5.4 Create `VentoErrorCard.vue` (`reader-src/src/components/VentoErrorCard.vue`): typed props for Vento template error display
- [ ] 5.5 Create `ChapterContent.vue` (`reader-src/src/components/ChapterContent.vue`): uses `useMarkdownRenderer()`, renders chapter via `v-html`, integrates StatusBar/OptionsPanel/VariableDisplay/VentoErrorCard as child components
- [ ] 5.6 Create `ChatInput.vue` (`reader-src/src/components/ChatInput.vue`): `v-model` textarea, typed emits (`send`, `resend`, `sent`), `defineExpose({ appendText })`, Enter/Shift+Enter handling, loading state UI
- [ ] 5.7 Create `StorySelector.vue` (`reader-src/src/components/StorySelector.vue`): cascading series/story dropdowns via `useStorySelector()`, typed `load` emit, new story creation
- [ ] 5.8 Create `PromptEditor.vue` (`reader-src/src/components/PromptEditor.vue`): template textarea with `v-model` via `usePromptEditor()`, localStorage sync, save/load controls
- [ ] 5.9 Create `PromptPreview.vue` (`reader-src/src/components/PromptPreview.vue`): typed API response handling, rendered prompt display
- [ ] 5.10 Create `PassphraseGate.vue` (`reader-src/src/components/PassphraseGate.vue`): `<form @submit.prevent>`, password input, error display, uses `useAuth()`, `v-if` gating of slot content
- [ ] 5.11 Create `AppHeader.vue` (`reader-src/src/components/AppHeader.vue`): nav buttons (prev/next), folder picker, chapter progress indicator, mode toggle, StorySelector and PromptEditor integration
- [ ] 5.12 Create `Sidebar.vue` (`reader-src/src/components/Sidebar.vue`): sticky sidebar for desktop status panel placement, chapter list
- [ ] 5.13 Create `ContentArea.vue` (`reader-src/src/components/ContentArea.vue`): wraps `ChapterContent` + `Sidebar` in two-column grid layout
- [ ] 5.14 Create `MainLayout.vue` (`reader-src/src/components/MainLayout.vue`): grid layout orchestrating AppHeader, ContentArea, Sidebar, ChatInput; conditional ChatInput visibility based on `isLastChapter` computed
- [ ] 5.15 Create `App.vue` root component (`reader-src/src/App.vue`): `PassphraseGate` → `MainLayout`, `onMounted` plugin loading via `usePlugins()`, wires all top-level composables

## 6. Theme & Styles

- [ ] 6.1 Extract CSS custom properties from `index.html` inline styles into `reader-src/src/styles/theme.css` (`--text-main`, `--text-italic`, `--text-quote`, `--shadow-color`, `--shadow-width`, `--border-outer`, `--font-system-ui`, `--font-antique`, etc.)
- [ ] 6.2 Create `reader-src/src/styles/base.css` with global typography, body background, font-face loading, reset rules
- [ ] 6.3 Import `theme.css` and `base.css` in `App.vue` or `main.ts`
- [ ] 6.4 Add component-scoped `<style scoped>` blocks to each SFC for layout-specific styles
- [ ] 6.5 Configure Tailwind purge to scan `reader-src/src/**/*.{vue,ts}` for production builds
- [ ] 6.6 Migrate Google Fonts `<link>` tags and preconnect hints into `reader-src/index.html` `<head>`
- [ ] 6.7 Remove all inline `<style>` blocks from production `index.html`; verify no Tailwind CDN `<script>` tags remain
- [ ] 6.8 Verify CSS hover states use pseudo-classes (`:hover`, `:focus`, `:active`) in scoped styles — no inline event handlers for visual state changes

## 7. Entry Point & Integration

- [ ] 7.1 Finalise `reader-src/src/main.ts`: `createApp(App).mount('#app')`, import global styles
- [ ] 7.2 Finalise `reader-src/index.html`: minimal Vite entry with `<div id="app">`, Google Fonts `<link>` tags, `<meta>` CSP tag updated (remove `unsafe-eval`, update script-src to `'self'`)
- [ ] 7.3 Update backend static file serving in `writer/server.ts` to serve from `reader-dist/` (leverage existing `READER_DIR` env var)
- [ ] 7.4 Update CSP meta tag for Vite-bundled assets: remove CDN SRI hashes for bundled deps, rely on content-hashed filenames
- [ ] 7.5 Preserve plugin contract: ensure `/plugins/{name}/frontend.js` dynamic imports work both in dev (Vite proxy) and production (static serving)
- [ ] 7.6 Remove `window.__appendToInput` global bridge function; verify options panel uses Vue events or provide/inject
- [ ] 7.7 Update built-in plugin `frontend.js` modules to remove `/js/*` imports: replace `import { escapeHtml } from '/js/utils.js'` in `plugins/status/frontend.js`, `plugins/options/frontend.js`, `plugins/state-patches/frontend.js`, `plugins/thinking/frontend.js`; replace `import { appendToInput } from '/js/chat-input.js'` in `plugins/options/frontend.js` with Vue provide/inject pattern; utilities like `escapeHtml` should be inlined or provided via an alternative module path
- [ ] 7.8 Optionally add backend compatibility route serving `/js/utils.js` as a redirect or re-export for third-party plugin support during migration transition period
- [ ] 7.9 Verify all 14 backend API endpoints are called correctly from composables with `X-Passphrase` header

## 8. Test Migration

- [ ] 8.1 Configure Vitest in `reader-src/vite.config.ts` (or `vitest.config.ts`) with `happy-dom` or `jsdom` environment
- [ ] 8.2 Port `utils_test.js` → `reader-src/src/lib/__tests__/string-utils.test.ts`
- [ ] 8.3 Port `status-bar_test.js` (19 cases) → `reader-src/src/lib/parsers/__tests__/status-parser.test.ts`
- [ ] 8.4 Port `options-panel_test.js` (18 cases) → `reader-src/src/lib/parsers/__tests__/options-parser.test.ts`
- [ ] 8.5 Port `variable-display_test.js` (11 cases) → `reader-src/src/lib/parsers/__tests__/variable-parser.test.ts`
- [ ] 8.6 Port `vento-error-display_test.js` (10 cases) → `reader-src/src/lib/parsers/__tests__/vento-error-parser.test.ts`
- [ ] 8.7 Port `plugin-hooks_test.js` (8+ cases) → `reader-src/src/lib/__tests__/plugin-hooks.test.ts` (priority dispatch, context mutation, error isolation, handler registration)
- [ ] 8.8 Port `md-renderer_test.js` (13 cases) → `reader-src/src/composables/__tests__/useMarkdownRenderer.test.ts`
- [ ] 8.9 Add composable tests: `useAuth.test.ts` (initial state, authenticate, sessionStorage sync, getAuthHeaders)
- [ ] 8.10 Add composable tests: `useChapterNav.test.ts` (navigation, boundary computed, URL hash sync, mode switching, cleanup)
- [ ] 8.11 Add composable tests: `useStorySelector.test.ts` (cascading state, API calls with auth headers)
- [ ] 8.12 Add composable tests: `usePromptEditor.test.ts` (localStorage sync, template save/load)
- [ ] 8.13 Add component tests: `PassphraseGate.test.ts` (overlay rendering, form submit, v-if gating)
- [ ] 8.14 Add component tests: `ChatInput.test.ts` (emit events, Enter/Shift+Enter, appendText, disabled during loading)
- [ ] 8.15 Add component tests: `StatusBar.test.ts`, `OptionsPanel.test.ts`, `VariableDisplay.test.ts` (prop rendering, scoped events)
- [ ] 8.16 Add integration test: full rendering pipeline (markdown input → extracted blocks → rendered HTML output)
- [ ] 8.17 Set up mock patterns: `vi.fn()` for fetch, `vi.stubGlobal()` for FSA API / localStorage / clipboard, `fake-indexeddb` or manual mock for IndexedDB
- [ ] 8.18 Add composable test isolation — ensure singleton module state is reset between test cases via `vi.resetModules()` or explicit `resetState()` exports
- [ ] 8.19 Add composable tests: `usePlugins.test.ts` (initPlugins, plugin dynamic import, tag handler registry, displayStripTags compilation, error isolation for invalid plugins)
- [ ] 8.20 Add composable tests: `useFileReader.test.ts` (isSupported detection, openDirectory, readFile, IndexedDB handle persistence, restoreHandle, clearStoredHandle, onUnmounted cleanup)
- [ ] 8.21 Add composable tests: `useChatApi.test.ts` (sendMessage POST, resendMessage DELETE, isLoading state transitions, errorMessage on failure, auth headers via useAuth)
- [ ] 8.22 Add composable tests: `useBackground.test.ts` (successful config fetch applies background, fetch failure graceful degradation, no-op when backgroundImage is empty)
- [ ] 8.23 Add component tests: `PromptPreview.test.ts` (API response rendering, loading state, error display, typed props)
- [ ] 8.24 Add component tests: `VentoErrorCard.test.ts` (error message rendering, typed props, styling)
- [ ] 8.25 Add plugin backward compatibility tests: verify existing plugin `frontend.js` modules (e.g., `state-patches/frontend.js`) load correctly via `usePlugins()` dynamic import, register hooks, and produce expected render output
- [ ] 8.26 Verify total test count ≥ 113 (matching current baseline) and all 7 original domains are covered

## 9. Build Pipeline & Deployment

- [ ] 9.1 Update `Containerfile` to include `npm install` in `reader-src/` and `deno task build:reader` step; serve `reader-dist/` instead of `reader/`
- [ ] 9.2 Update `serve.zsh` if it references `reader/` directly (or verify `READER_DIR` env var handles it)
- [ ] 9.3 Update `deno.json` unified `test` task to run both backend Deno tests and frontend Vitest
- [ ] 9.4 Verify production build output: `reader-dist/index.html`, hashed JS/CSS in `reader-dist/assets/`, source maps present
- [ ] 9.5 Test container build end-to-end: `podman build` succeeds, container runs, frontend loads at `https://localhost:8443`
- [ ] 9.6 Verify no `unsafe-eval` in CSP, no CDN script tags for bundled dependencies, content-hashed filenames for integrity

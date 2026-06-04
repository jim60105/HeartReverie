# AGENTS.md

## Overview

**HeartReverie 浮心夜夢** — An AI-driven interactive fiction engine built around [SillyTavern](https://github.com/SillyTavern/SillyTavern). The system consists of a web reader/writer frontend, a Hono backend running on Deno that drives LLM chat via any OpenAI-compatible API, and a plugin system for extensible prompt assembly and tag processing. Licensed under AGPL-3.0-or-later.

## Project Structure

```
system.md                 # Main Vento prompt template (entry point for LLM system prompt)
scripts/
  serve.sh                # Dev startup script (sets umask 0002, execs deno run)
  podman-build-run.sh     # Mandatory container-verification helper (build + run + tail logs)
  coverage.ts             # LCOV merge / summary / gate CLI used by deno task coverage:*
  introspect-hooks.ts     # Offline plugin-introspection dump
  check-vento-helpers.ts  # Vento helper consistency check
  __tests__/              # Tests for the scripts directory
writer/                   # Backend server (Hono, TypeScript ESM, Deno)
  app.ts                  # Hono app setup: middleware, route registration, static serving
  server.ts               # Server entry: plain HTTP listener startup
  types.ts                # Shared TypeScript interfaces and types
  vendor/
    ventojs.d.ts          # Ambient type declarations for ventojs
  lib/                    # Backend libraries — many focused modules (see below)
    config.ts             # Environment variable loading and validation
    errors.ts             # RFC 9457 Problem Details helpers
    middleware.ts         # Auth, rate limiting, secure headers
    logger*.ts            # Logger types + console/file sinks
    plugin-manager.ts     # PluginManager: discovery, loading, manifest validation
    plugin-loader*.ts     # Manifest + staging loader (split for testability)
    plugin-validators*.ts # Per-aspect manifest validators (schema, hooks, action-buttons, frontend imports/styles)
    plugin-settings*.ts   # Per-plugin settings persistence + audit + validation helpers
    plugin-strip-tags.ts  # promptStripTags / displayStripTags processing
    plugin-prompt-vars.ts # Collects plugin-contributed prompt variables
    plugin-depends-on-dag.ts # Plugin dependency DAG resolver
    hooks.ts              # HookDispatcher: backend lifecycle hook system (entry point)
    hooks-*.ts            # Stages, register, runner, runner-view, topology, metrics, event-bus, snapshot, pipeline fields
    chat-shared.ts        # Shared chat execution logic (HTTP + WebSocket)
    chat-llm-fetch.ts     # Upstream LLM fetch + attribution headers
    chat-stream*.ts       # Streaming + per-chunk persistence
    chat-chapter-*.ts     # Chapter I/O and finalization helpers
    chat-types.ts         # Shared chat types
    story.ts              # Story/chapter file operations
    story-chapter-io.ts   # Chapter file read/write primitives
    story-prompt-builder.ts # buildPromptFromStory()
    story-config.ts       # Per-story LLM config: read/write/validate/resolve + STORY_LLM_CONFIG_KEYS whitelist
    generation-registry.ts # In-memory refcounted registry marking stories with active LLM generation (guards edit/rewind/branch)
    lore.ts               # Lore codex library (passage storage, retrieval, tag system, template variable generation)
    lore-collect.ts / lore-frontmatter.ts / lore-tags.ts # Lore codex sub-modules
    template.ts           # Vento template rendering engine
    template-preview.ts   # Preview-prompt route helper
    template-lint*.ts     # Vento template static checks (catalog, check, top-level wrapper)
    vento-helpers.ts      # Custom Vento filters / globals (introspection-friendly)
    vento-message-tag.ts  # `{{ message }}` tag implementation for multi-message rendering
    introspection-dump.ts # Plugin introspection payload builder
    schema-validator*.ts  # JSON-schema-flavoured validator used by settingsSchema
    settings-diff.ts      # Per-plugin settings diff for the settings UI
    themes.ts             # Theme TOML loader
    usage.ts              # Token usage persistence: _usage.json reader/writer with per-story async lock
    export.ts             # Story export renderers (Markdown/JSON/plain text) + RFC 5987 filename encoding
    path-allowlist.ts / path-safety.ts # Path-traversal-safe helpers (isValidParam, safePath, isPathContained, isValidPluginName)
  routes/                 # Route handlers — split per concern (see below)
    auth.ts               # POST /api/auth — passphrase verification
    branch.ts             # POST /api/stories/:series/:name/branch — fork a story at a chapter
    chapters.ts           # GET/PUT/DELETE chapters — read, edit, rewind chapter content
    chat.ts               # POST chat — LLM streaming proxy (HTTP fallback)
    config.ts             # GET /api/config — public configuration (background image, theme list)
    _debug-hooks.ts       # Dev-only hook-inspector dump (gated by HEARTREVERIE_DEV)
    export.ts             # GET /api/stories/:series/:name/export — bundled story download (md/json/txt)
    images.ts             # POST /api/images — backend image upload (Sharp-based decode + sanitization, requires --allow-ffi)
    llm-defaults.ts       # GET /api/llm-defaults — resolved server-side LLM defaults
    lore.ts               # Lore codex API routes (CRUD for passages)
    plugins.ts            # GET plugins — frontend module discovery
    plugin-introspect.ts  # GET /api/plugins/introspect — full plugin metadata (auth-gated)
    plugin-settings.ts    # GET/PUT /api/plugins/:name/settings — per-plugin user settings
    plugin-actions*.ts    # Plugin action button LLM round (path-traversal-safe, optional atomic append) — split into execute / preflight / validation / shared
    prompt.ts             # GET/POST prompt — template preview and file persistence
    stories.ts            # GET stories — series/story listing
    story-config.ts       # GET/PUT /api/:series/:name/config — per-story LLM overrides
    templates.ts          # GET/PUT /api/templates — generic template file read/write
    templates-path.ts     # Template-path parser/resolver (system / plugin-fragment / lore)
    templates-read.ts / templates-write.ts / templates-validate.ts / templates-lore-enum.ts # Templates split routes
    themes.ts             # GET /api/themes — theme list + active theme palette
    usage.ts              # GET /api/stories/:series/:name/usage — token usage records + totals
    ws.ts                 # WebSocket upgrade handler entry point
    ws-auth.ts / ws-chat.ts / ws-connection.ts / ws-error-log.ts / ws-plugin-action.ts / ws-subscribe.ts # WebSocket message handlers split per envelope
reader-src/               # Frontend SPA source (Vue 3, TypeScript, Vite)
  vite.config.ts          # Vite build configuration
  tsconfig.json           # TypeScript configuration
  tailwind.config.ts      # Tailwind CSS configuration
  src/
    main.ts               # Vue app entry point
    App.vue               # Root component
    router/
      index.ts            # Vue Router with HTML5 history mode (exports settingsChildren, toolsChildren)
      isReadingRoute.ts   # Predicate excluding /settings and /tools from "last reading route" tracking
    components/
      AppHeader.vue / MainLayout.vue / Sidebar.vue / ContentArea.vue / ChapterContent.vue
      ChatInput.vue       # Chat message input and submission
      StorySelector.vue   # Series/story selection UI
      PluginActionBar.vue # Renders plugin-contributed action buttons (between UsagePanel and ChatInput)
      PromptEditor.vue / PromptEditorPage.vue / PromptEditorMessageCard.vue / PromptPreview.vue
      TemplateEditorPage.vue / TemplateFileTree.vue / VentoCodeEditor.vue / VentoErrorCard.vue
      LlmSettingsPage.vue / PluginSettingsPage.vue / ThemeSettingsPage.vue
      SchemaField.vue / schema-field-helpers.ts # JSON-schema-driven field renderer (settings UI)
      widgets/            # SchemaField widget set (text, number, range, select, combobox, checkbox, color, tags, multi-select, masked-secret, repeater, object-fieldset, path-picker)
      lore/               # LoreCodexPage / LoreBrowser / LoreEditor
      hook-inspector/     # StageBlock / HandlerRow row components
      HookInspectorPage.vue # /settings/hook-inspector — live hook-dispatch inspector page
      QuickAddPage.vue / ImportCharacterCardPage.vue # /tools/* tools pages
      UsagePanel.vue / PassphraseGate.vue / ToastContainer.vue
      SettingsLayout.vue / ToolsLayout.vue / ToolsMenu.vue
    composables/
      useAuth.ts / useTheme.ts / useNotification.ts / useMediaQuery.ts / useSidebarDrawer.ts / useAutoresize.ts
      useChapterNav.ts / useChapterActions.ts / useChapterEditor.ts
      useChatApi.ts / useWebSocket.ts
      useLastReadingRoute.ts / useLoreApi.ts / useMarkdownRenderer.ts
      usePlugins.ts / usePluginActions.ts
      usePromptEditor.ts / useStorySelector.ts / useStoryExport.ts / useStoryLlmConfig.ts
      useTools.ts / useUsage.ts
    lib/
      api.ts / template-api.ts # Typed REST clients
      event-bus.ts          # Typed plugin event bus (mitt-like)
      hook-inspector.ts     # Hook-inspector state model
      widget-registry.ts    # SchemaField widget registry
      validation-i18n.ts    # JSON-schema validation messages → zh-TW
      cm-vento.ts / cm-vento-complete.ts # CodeMirror Vento highlight + completion
      character-card-parser.ts # SillyTavern V2/V3 PNG tEXt chunk parser → ParsedCharacterCard
      file-utils.ts / lore-filename.ts / markdown-pipeline.ts / plugin-hooks.ts / string-utils.ts / template-parser.ts / template.ts / errors.ts / render-debug.ts
      parsers/
        vento-error-parser.ts  # Vento error parsing
    types/
      character-card.ts / hook-inspector.ts / index.ts
    styles/
      base.css / theme.css
reader-dist/              # Built frontend output (gitignored, run `deno task build:reader`)
plugins/                  # Built-in plugins (manifest-driven) + shared utils
  _shared/
    utils.js              # Shared utilities (escapeHtml) used by frontend modules
  context-compaction/     # Tiered context compaction via inline chapter summaries
  dialogue-colorize/      # Colourise dialogue quote runs via CSS Custom Highlight API (no DOM mutation)
  polish/                 # One-click literary polish rewrite (replace mode, action button)
  reading-progress/       # Single-user, multi-device reading-progress sync (chapter + scroll + text anchor)
  response-notify/        # Toast notification system for backend → frontend messages
  start-hints/            # First-round chapter opening guidance
  thinking/               # Fold <thinking>/<think> tags into collapsible details
  user-message/           # User message lifecycle: wrap, strip from context/display
tests/                    # Backend tests (Deno)
  fixtures/               # Shared test fixtures (plugins, stories, themes)
  writer/
    lib/                  # Backend library tests (*_test.ts)
    routes/               # Backend route handler tests (*_test.ts)
  plugins/                # Plugin tests (context-compaction, user-message, …)
  themes/                 # Theme loader tests
playground/               # Story data directory (series/stories/chapters)
                          # Underscore-prefixed dirs (_lore/, _logs/, _prompts/, _config.json, _usage.json) are system-reserved
openspec/                 # Spec-driven workflow: specs, changes, archives
docs/                     # Documentation (Traditional Chinese): plugin-system, prompt-template, lore-codex, helm-deployment, ci-cross-repo-trigger, migration-hook-inspector
helm/                     # Helm chart for Kubernetes deployment
themes/                   # Built-in theme TOMLs (default, light, dark) + user-provided themes
.agents/                  # Copilot agent skills (e.g., heartreverie-create-plugin)
.github/
  skills/                 # OpenSpec workflow skills (apply / propose / archive / verify / sync / explore / …)
  workflows/              # ci.yaml (fmt-lint + test), release.yaml, docker-publish-latest.yaml, copilot-setup-steps.yaml
assets/                   # Static assets (images)
```

## Running the Server

```bash
./scripts/serve.sh        # Dev: starts plain-HTTP server at http://localhost:8080
```

HeartReverie speaks plain HTTP only. For production, terminate TLS at an upstream reverse proxy or Kubernetes Ingress controller.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_API_KEY` | Yes | — | LLM provider API key (stored in `.env`) |
| `PASSPHRASE` | Yes | — | API authentication passphrase (stored in `.env`) |
| `PORT` | No | `8080` | Server listen port |
| `LLM_MODEL` | No | `deepseek/deepseek-v4-pro` | LLM model identifier |
| `LLM_API_URL` | No | `https://openrouter.ai/api/v1/chat/completions` | LLM chat completions endpoint |
| `LLM_TEMPERATURE` | No | `0.1` | Sampling temperature |
| `LLM_FREQUENCY_PENALTY` | No | `0.13` | Frequency penalty |
| `LLM_PRESENCE_PENALTY` | No | `0.52` | Presence penalty |
| `LLM_TOP_K` | No | `10` | Top-K sampling |
| `LLM_TOP_P` | No | `0` | Top-P (nucleus) sampling |
| `LLM_REPETITION_PENALTY` | No | `1.2` | Repetition penalty |
| `LLM_MIN_P` | No | `0` | Min-P sampling |
| `LLM_TOP_A` | No | `1` | Top-A sampling |
| `LLM_MAX_COMPLETION_TOKENS` | No | _unset_ | Optional maximum total completion tokens (reasoning + content). When set, must be a positive safe integer and is sent as `max_completion_tokens` to the upstream LLM. When unset, empty, or invalid, the engine omits `max_completion_tokens` from the upstream request body — the provider's own default applies. |
| `LLM_REASONING_ENABLED` | No | `true` | When true, request reasoning from the upstream LLM. Parsed as boolean. |
| `LLM_REASONING_EFFORT` | No | `xhigh` | Reasoning effort level: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`. |
| `LLM_REASONING_OMIT` | No | `false` | When true, omit the `reasoning` block from upstream requests entirely (escape hatch for strict OpenAI-compatible providers that reject unknown fields). |
| `PLUGIN_DIR` | No | — | External plugin directory (absolute path) |
| `LOG_LEVEL` | No | `info` | Log level: debug, info, warn, error |
| `LOG_FILE` | No | — | Path to JSON Lines log file (enables file logging with rotation) |
| `LLM_LOG_FILE` | No | `playground/_logs/llm.jsonl` | Path to LLM interaction log file (full request/response); empty string disables |
| `PLAYGROUND_DIR` | No | `./playground` | Story data root |
| `READER_DIR` | No | `./reader-dist` | Frontend static files root |
| `THEME_DIR` | No | `./themes/` | Theme directory path (TOML files); default `./themes/` |
| `PROMPT_FILE` | No | `playground/_prompts/system.md` | Custom prompt template file path |

The `.env` file is gitignored. Copy `.env.example` to `.env` and fill in `LLM_API_KEY` and `PASSPHRASE`.

### Theme System

Themes are TOML files in `THEME_DIR` (default `./themes/`). Each file declares an `id` (kebab-case, matching filename stem), `label`, optional `colorScheme` (`"light"` or `"dark"`), optional `backgroundImage` (same-origin path or `data:` URL only), and a `[palette]` table mapping CSS custom-property names (without `--` prefix) to string values. The loader prepends `--` when serving to the frontend. Three built-in themes ship: `default`, `light`, `dark`.

## Container Deployment

The project uses a single `Containerfile` — a Deno-only image that copies all application files.

### Build and run the application container

```bash
# Build
podman build -t heartreverie:latest .

# Run
podman run -d --name heartreverie \
  -p 8080:8080 \
  -e LLM_API_KEY=your-api-key \
  -e PASSPHRASE=your-passphrase \
  -v ./playground:/app/playground:z \
  heartreverie:latest
```

## Code Style

### TypeScript — Backend (`writer/`)

- TypeScript ESM modules (`import`/`export`) with `.ts` extensions in import paths
- **Double quotes** for strings
- Semicolons always used
- `async/await` for all asynchronous operations
- Private class fields with `#` prefix
- Strict compiler config: `strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`
- Shared types in `writer/types.ts`; use `unknown` with type narrowing instead of `any`
- JSDoc comments on functions
- Error responses follow RFC 9457 Problem Details format (`type`, `title`, `status`, `detail`)
- AGPL-3.0-or-later license header at the top of every source file

### TypeScript/Vue — Frontend (`reader-src/`)

- Vue 3 Single-File Components (`.vue`) with `<script setup lang="ts">`
- TypeScript strict mode; shared types in `reader-src/src/types/index.ts`
- **Double quotes** for strings (same as backend)
- Semicolons always used
- Composition API with composables (`use*.ts`) for state and logic
- Silent error handling — graceful degradation, no `console.error`
- Styles in component `<style scoped>` blocks and shared CSS files (`styles/base.css`, `styles/theme.css`)
- UI text in Traditional Chinese (zh-TW); comments and code in English
- Build with Vite: `deno task build:reader`
- Test with Vitest: `deno task test:frontend`

### Frontend Technology Stack

- **Vue 3** — Composition API, `<script setup>` SFCs
- **Vue Router** — HTML5 history mode routing
- **Vite** — Build tool and dev server
- **Tailwind CSS** — Build-time via PostCSS (not CDN)
- **marked.js** — Markdown parser
- **DOMPurify** — HTML sanitization
- **Vitest** — Frontend unit testing
- **Google Fonts** — Iansui, Noto Sans TC/JP/SC, Noto Color Emoji

### Git Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: correct a bug
refactor: restructure without behavior change
docs: documentation only
style: formatting, no logic change
chore: maintenance tasks
```

Scoped variants are used when appropriate: `feat(plugins):`, `fix(reader):`.

Commit messages are written in English. Always include the trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

### Before finalizing a change

Both human and AI contributors MUST run the following two commands before declaring an implementation complete:

```
deno task fmt
deno task lint
```

CI runs both via `deno fmt --check` and `deno lint` in the `fmt-lint` job (`.github/workflows/ci.yaml`) on every push to `master`, every pull request targeting `master`, and `workflow_dispatch`; either command exiting non-zero marks the build red on the PR's checks list.

> **Note.** Branch-protection rulesets that would actually *block* merge on a red `fmt-lint` build are **recommended** but are **not** enabled on this repository today, and enabling them requires repo-admin action. They are deliberately out of scope for this change — the `fmt-lint` job ensures failures are *visible*, not that they are *unmergeable*.

**Suppression hygiene.** Any **newly added** `// deno-lint-ignore <rule>` directive introduced by a change MUST carry a trailing `-- <reason>` comment explaining why the rule is being suppressed at that site (for example, `// deno-lint-ignore no-control-regex -- deliberate control-character sanitization`). This rule applies only to new suppressions added going forward; pre-existing untouched suppressions elsewhere in the tree are not retroactively in scope and need not be cleaned up as part of unrelated work.

**Scope.** The configured set covers source files only: `**/*.{ts,tsx,js,jsx,json,jsonc,yaml,yml,css}` for `deno fmt`, and `**/*.{ts,tsx,js,jsx}` for `deno lint`. A comprehensive `exclude` list in `deno.json` keeps Markdown, user story data in `playground/`, prompt content under `themes/`, generated output (`reader-dist/`, `coverage/`), vendored code (`**/vendor/`), `**/node_modules/`, Helm chart templates (`helm/heart-reverie/templates/`, which contain Go template syntax that is not parseable as YAML), and archived OpenSpec changes (`openspec/changes/archive/`) out of the formatter and linter. **Markdown is intentionally never reformatted** — prose discipline is the author's responsibility.

**Vue gap.** Deno's stable formatter does not format `.vue` Single-File Components, and Deno's linter does not lint them. Style inside `<script setup>` blocks relies on review. `.vue` type/behaviour coverage is provided by `vue-tsc --noEmit` (run via `deno task build:reader`) and Vitest (`deno task test:frontend`).

## Architecture

### Plugin System

The plugin system uses manifest-driven discovery. Each plugin has a `plugin.json` declaring its capabilities. There are 8 built-in plugins (`context-compaction`, `dialogue-colorize`, `polish`, `reading-progress`, `response-notify`, `start-hints`, `thinking`, `user-message`) plus a `_shared/utils.js` module providing common frontend utilities (e.g., `escapeHtml`). See `docs/plugin-system/` for additional documentation (note: those files may lag behind recent refactors).

Key classes:
- `PluginManager` (`writer/lib/plugin-manager.ts`) — scans `plugins/` and optional `PLUGIN_DIR`, validates manifests, loads modules
- `HookDispatcher` (`writer/lib/hooks.ts`) — registers and dispatches async lifecycle hooks with priority ordering
- `PluginRegisterContext` (`writer/types.ts`) — context object passed to plugin `register()`: `{ hooks: PluginHooks, logger: Logger }`; the `hooks` wrapper auto-binds the plugin name, and `context.logger` is always injected during hook dispatch

Plugin interaction layers:
1. **Prompt injection** — `promptFragments` field maps Markdown files to Vento template variables. Named-variable fragments containing `{{` are Vento-rendered with a limited context: `chapter_number`, `series_name`, `story_name`, and lore variables. Plugin-provided dynamic variables (e.g. `status_data`) are **not** available in fragment rendering.
2. **Prompt tag stripping** — `promptStripTags` field declares plain tag names or regex patterns to remove from previousContext when building prompts
3. **Display tag stripping** — `displayStripTags` field declares plain tag names or regex patterns to remove from frontend display during browser rendering
4. **CSS injection** — `frontendStyles` field declares CSS files to inject as `<link>` elements into the frontend `<head>` before JS modules load
5. **Backend hooks** — `backendModule` registers handlers for 5 lifecycle stages: `prompt-assembly`, `response-stream`, `pre-write`, `post-response`, `strip-tags`
6. **Frontend modules** — `frontendModule` provides browser-side rendering via `frontend-render` hook and notification handling via `notification` hook. Additional frontend hook stages are available for lifecycle integration:
   - `chat:send:before` — pipeline hook: handlers may transform the outgoing user message by returning a `string`; context is `{ message, mode: "send" | "resend" }`.
   - `chapter:render:after` — post-processing hook: handlers may mutate `tokens` after Markdown + initial DOMPurify pass; the dispatcher re-sanitizes any newly added or `.content`-mutated `html` tokens, so plugins never need to sanitize HTML themselves.
   - `chapter:dom:ready` — DOM-commit hook: fired by `ChapterContent.vue` via a `flush: "post"` watcher after Vue applies v-html to the live DOM; context carries `{ container, tokens, rawMarkdown, chapterIndex }`. Used by plugins (e.g. `dialogue-colorize`) that need to operate on the rendered DOM (text nodes, ranges) rather than the token array. Skipped while the chapter editor textarea is shown.
   - `action-button:click` — async dispatch hook fired when the user clicks a plugin-contributed button in `PluginActionBar`. Context exposes `{ buttonId, pluginName, series, name, storyDir, lastChapterIndex }` plus curried helpers `runPluginPrompt(promptFile, opts?)`, `notify(input)`, and `reload()`. The dispatcher only runs handlers whose owning plugin matches `context.pluginName` (origin-filtered) and awaits each handler's promise in priority order; unhandled rejections surface a default error toast.
   - `story:switch` / `chapter:change` — informational hooks fired on real navigation state changes (no veto). Contexts carry `previousSeries`/`previousStory` and `previousIndex` respectively.
7. **Action buttons** — `actionButtons` manifest field declares `ActionButtonDescriptor` entries (`id`, `label`, `icon?`, `tooltip?`, `priority?`, `visibleWhen?` with two-value enum `"last-chapter-backend" | "backend-only"`). Descriptors render in `PluginActionBar` (mounted between `UsagePanel` and `ChatInput`) and dispatch the `action-button:click` frontend hook. Click handlers typically call the curried `runPluginPrompt(promptFile, opts?)` helper, which drives `POST /api/plugins/:pluginName/run-prompt` (path-traversal-safe via `Deno.realPath`, `.md`-only, route-rate-limited to 30/min). When called with `{ append: true, appendTag }`, the backend strips at most one outer `<{appendTag}>` wrapper from the response, atomically appends `\n<{appendTag}>\n…\n</{appendTag}>\n` to the highest-numbered chapter file, re-reads the chapter, and dispatches `post-response` with `source: "plugin-action"`, `appendedTag` set to the tag, and `content` set to the full chapter contents after the append. `appendTag` is OPTIONAL: calling with `{ append: true }` and **omitting** `appendTag` selects a tagless append — the backend `trim()`s the response and appends `\n{trimmed}\n` **verbatim with no wrapper element** (no wrapper-stripping pass), so any tags the model emitted (e.g. multiple `<image>` blocks) survive exactly, and `post-response.appendedTag` is `null` for that run (a string for tagged append, `null` for tagless append, omitted for chat/replace/discard). An explicit `appendTag: null`, an empty string, or a malformed tag is still rejected with HTTP 400 `plugin-action:invalid-append-tag`. The dispatcher filters `action-button:click` handlers by `originPluginName` so plugins only see clicks on their own buttons.
8. **Plugin logger** — each plugin receives a scoped logger via `PluginRegisterContext`; `HookDispatcher` injects `context.logger` during dispatch
9. **Parallel dispatch** — 並行分派受 `PARALLEL_ALLOWED` allowlist（`prompt-assembly`/`post-response`/`response-stream`）+ `readOnly:true` 契約限制；`response-stream` 須伴 `readOnly` 否則 reject；未宣告 `hooks[]` 完全不受影響。

### Lore Codex

File-based world-building knowledge system with scoped passages (典籍). Replaces the old `scenario.md` approach. See `docs/lore-codex/` for full user-facing documentation.

- **Three scopes**: global (`_lore/`), series (`<series>/_lore/`), story (`<series>/<story>/_lore/`) — co-located with story data
- **Passage format**: `.md` files with YAML frontmatter (`tags`, `priority`, `enabled`)
- **Tag system**: frontmatter tags + directory-as-tag + filename-as-tag, normalized for template variable names (lowercase, hyphens/spaces → underscores)
- **Template variable injection**: `lore_all` (all enabled passages), `lore_<tag>` (per-tag), `lore_tags` (tag name array)
- **API**: CRUD routes under `/api/lore/` for managing passages
- **Underscore convention**: directories starting with `_` are system-reserved (e.g., `_lore/`) and excluded from series/story listings

Key files:
- `writer/lib/lore.ts` — Core library: frontmatter parsing, tag normalization, scope collection, template variable generation
- `writer/routes/lore.ts` — REST API routes for passage CRUD

### Per-Story LLM Settings

Each story may carry a `_config.json` file beside its chapter files to override the server's default LLM sampling parameters for that story only. The file is a JSON object containing any subset of: `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`, `reasoningEnabled`, `reasoningEffort`, `maxCompletionTokens`. The exhaustive whitelist is exported as `STORY_LLM_CONFIG_KEYS` from `writer/lib/story-config.ts` and is the single source of truth for the validator, the `GET /api/llm-defaults` route payload, and the frontend settings form. Missing fields fall back to the corresponding `LLM_*` environment variable. `reasoningEnabled` defaults to `true` and `reasoningEffort` defaults to `"xhigh"`; `reasoningEffort` must be one of the 6-value enum: `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`. `maxCompletionTokens` is `number | null`: a positive safe integer caps tokens, an explicit `null` carries the meaning "no application-level limit" and causes the engine to omit `max_completion_tokens` from the upstream request body. `maxCompletionTokens` is the ONLY field where `null` is meaningful — for every other field, `null` and missing both mean "fall through to env defaults". The `LLM_API_URL` and `LLM_API_KEY` are **not** per-story configurable. `LLM_REASONING_OMIT` is a deployment-level escape hatch (for strict OpenAI-compatible providers that reject unknown fields) and is **not** exposed in `_config.json`.

- **Location**: `playground/<series>/<story>/_config.json` (underscore prefix keeps it out of chapter listings)
- **API**: `GET /api/:series/:name/config` returns overrides (`{}` when absent); `PUT /api/:series/:name/config` validates and atomically persists them. PUT returns 404 when the story directory does not exist — it never implicitly creates a story. `GET /api/llm-defaults` (auth-required, `Cache-Control: no-store`) returns the resolved server-side defaults for every whitelisted key — used by the frontend settings page to display the value that will apply when an override is unset.
- **Validation**: whitelist-only parsing strips unknown keys; for every field except `maxCompletionTokens`, `null`/`undefined` are silently dropped; `model` must be a non-empty string, numeric fields must be finite numbers; `maxCompletionTokens` is tri-state (`undefined` is dropped; `null` is preserved as "no application-level limit"; otherwise must be a positive safe integer); violations return 400 Problem Details.
- **Merge semantics**: `Object.assign({}, llmDefaults, overrides)` in `resolveStoryLlmConfig()` — applied once per chat request just after `storyDir` validation, before the upstream LLM fetch body is built.
- **Frontend**: `/settings/llm` page with story picker + per-field override toggles (`useStoryLlmConfig` composable). When an override is disabled, the field shows the resolved default (read-only) loaded from `GET /api/llm-defaults`; toggling override-on seeds the input from that default value.

Key files:
- `writer/lib/story-config.ts` — validate/read/write/resolve helpers plus `STORY_LLM_CONFIG_KEYS` whitelist constant and typed error classes
- `writer/routes/story-config.ts` — GET/PUT route handlers
- `writer/routes/llm-defaults.ts` — `GET /api/llm-defaults` route

### OpenRouter App Attribution

Every upstream chat request carries three hard-coded OpenRouter [app-attribution headers](https://openrouter.ai/docs/app-attribution) so HeartReverie appears on OpenRouter's public rankings and per-model "Apps" tabs:

- `HTTP-Referer: https://github.com/jim60105/HeartReverie`
- `X-OpenRouter-Title: HeartReverie` (plain ASCII; OpenRouter's rankings UI does not render non-Latin-1 / percent-encoded titles legibly, so the project name's CJK suffix is intentionally omitted from the wire value)
- `X-OpenRouter-Categories: roleplay,creative-writing`

The values live in a single frozen module-level constant `LLM_APP_ATTRIBUTION_HEADERS` near the top of `writer/lib/chat-shared.ts`. They are intentionally **not** configurable — no env vars, no `_config.json` keys, no API surface. The headers are sent on every chat request regardless of the configured `LLM_API_URL`; most non-OpenRouter providers ignore unknown headers, but strict or privacy-sensitive providers may log or reject them — those operators should fork and clear the constant.

**Forks**: if you fork HeartReverie and want to attribute your usage separately, edit `LLM_APP_ATTRIBUTION_HEADERS` in `writer/lib/chat-shared.ts` (set `HTTP-Referer` to your project URL, update or clear the title and categories). Forks may also replace the constant with `{}` if they intentionally want no attribution.

### Prompt Rendering Pipeline

1. `buildPromptFromStory()` reads chapters, strips tags, loads status YAML, detects first-round, returns `{ messages: ChatMessage[], ... }`
2. `renderSystemPrompt()` resolves lore variables via `resolveLoreVariables()`, collects plugin variables via `getPromptVariables()`, generates a per-render `__messageState = { nonce: crypto.randomUUID(), messages: [] }`, then renders `system.md` through the Vento engine (with the `messageTagPlugin` from `writer/lib/vento-message-tag.ts` installed)
3. After Vento returns, `splitRenderedMessages()` walks the rendered string, replaces per-render sentinels with their captured `{role, content}` entries from `__messageState.messages`, treats non-whitespace top-level text segments as `system` messages, and coalesces adjacent `system` runs
4. `assertHasUserMessage()` rejects the render with a `multi-message:no-user-message` error (surfaced as a 422 RFC 9457 Problem Details) if no `user`-role message was emitted — **the template is the authoritative source of the upstream `messages` array; the chat layer no longer auto-appends a trailing user turn**
5. The assembled `ChatMessage[]` is sent verbatim as the upstream LLM request body's `messages`; the LLM response is streamed back, written incrementally to the chapter file, tags stripped, post-response hooks dispatched

Error tags surfaced through `buildVentoError()` for the message-tag pipeline (grep for these to find handling sites): `multi-message:invalid-role`, `multi-message:nested`, `multi-message:no-user-message`, `multi-message:assembly-corrupt`.

See `docs/prompt-template/` for the `{{ message }}` tag syntax, role validation, ordering / coalescing semantics, worked multi-turn examples, and the Prompt Editor cards-mode UI (per-message cards, raw-text fallback toggle, lossy-strip warning, pre-save validity guard).

### Frontend Rendering Pipeline

Custom XML blocks from LLM output are processed using the **Extract → Placeholder → Reinsert** pattern (implemented in `reader-src/src/lib/markdown-pipeline.ts` and the `useMarkdownRenderer` composable):
1. Extract XML blocks (e.g., `<thinking>`, `<user_message>`) before markdown parsing — extraction is delegated to individual plugin frontend modules via the `frontend-render` hook
2. Replace with HTML comment placeholders
3. Run `marked.parse()` + DOMPurify sanitization
4. Reinsert extracted blocks as rendered HTML components

This prevents markdown from mangling component HTML inside custom XML blocks.

`<ChapterContent>` is gated on `pluginsSettled` (true after `usePlugins().initPlugins()` runs to completion, success or failure) so first render always sees a populated plugin hook registry; failures surface as a toast rather than a silently empty render. `currentContent` lives in `useChapterNav` as a `shallowRef<string>` and is written exclusively through the private `commitContent(next)` helper, which calls `triggerRef(currentContent)` even on byte-identical writes and bumps a sibling `renderEpoch: Ref<number>` so non-`shallowRef`-aware effects (the sidebar relocation watch in `ContentArea.vue`) also re-run. After a chapter edit, `ChapterContent.vue` calls `useChapterNav().refreshAfterEdit(targetChapter)` to reload the chapter list and stay on the edited chapter, instead of jumping to the last chapter.

### WebSocket Streaming

The server exposes a WebSocket endpoint at `GET /api/ws` for real-time streaming:

- **Single connection** — one WebSocket per client, registered before body-limit and auth middleware in `writer/app.ts`
- **First-message auth** — client sends `{ type: "auth", passphrase }` as the first message; server validates with timing-safe comparison, responds `auth:ok` or `auth:error` (close code 4001)
- **JSON protocol** — all messages are `{ type: "...", ... }` discriminated unions defined in `writer/types.ts` (`WsClientMessage` / `WsServerMessage`)
- **Chat streaming** — `chat:send` / `chat:resend` messages trigger LLM generation via shared `executeChat()` function in `writer/lib/chat-shared.ts`; each SSE chunk is dual-written (file + WebSocket `chat:delta`); completed with `chat:done` (includes optional `usage: TokenUsageRecord | null` field) or `chat:error`
- **Stop generation** — `chat:abort` message cancels an active LLM generation; backend closes the upstream LLM connection via `AbortSignal`, preserves partial chapter content, and responds with `chat:aborted`
- **Plugin action streaming** — `plugin-action:run` / `plugin-action:abort` client envelopes drive the `POST /api/plugins/:pluginName/run-prompt` route over WebSocket; the server emits `plugin-action:delta` (per-chunk progress), `plugin-action:done` (final `{ content, usage, chapterUpdated, appendedTag }` payload), `plugin-action:error` (RFC 9457 Problem Details), or `plugin-action:aborted` (skips the chapter append and the `post-response` dispatch). The HTTP fallback returns the final JSON only with no streaming progress.
- **Story subscription** — `subscribe` message starts 1-second server-side polling of a story's chapter directory; pushes `chapters:updated` on count change and `chapters:content` on last-chapter content change
- **Frontend composable** — `useWebSocket.ts` singleton manages connection, auth handshake, and exponential backoff reconnection (1s → 30s cap)
- **Graceful degradation** — `useChatApi.ts` uses WebSocket when connected, falls back to HTTP POST; `useChapterNav.ts` disables polling when WebSocket is active, resumes on disconnect
- **Idle timeout** — 60-second inactivity closes connection with code 4002

Key files:
- `writer/routes/ws.ts` — WebSocket upgrade handler and message dispatching
- `writer/lib/chat-shared.ts` — Shared chat logic (extracted from HTTP handler, reused by WebSocket)
- `reader-src/src/composables/useWebSocket.ts` — Frontend WebSocket connection management

### Security Patterns

- **Authentication**: Passphrase via `X-Passphrase` header (HTTP) or first-message auth (WebSocket), timing-safe comparison (`@std/crypto/timing-safe-equal`)
- **Rate limiting**: Global 300 req/min, auth 30 req/min, chat 30 req/min, preview-prompt 60 req/min (WebSocket bypasses rate limiting)
- **Path traversal prevention**: `isValidParam()`, `safePath()`, `isPathContained()`, `isValidPluginName()` — all enforce directory boundaries
- **SSTI prevention**: `validateTemplate()` whitelist-only parser for user-submitted Vento templates — blocks function calls, property access, `process.env`
- **Frontend security**: DOMPurify on all rendered HTML, CSP via `<meta>` tag with SRI hashes
- **HTTP hardening**: Hono secureHeaders middleware

## OpenSpec Workflow

The project uses a spec-driven development workflow managed by OpenSpec skills in `.github/skills/`. Specifications live in `openspec/specs/`, changes are proposed/implemented/archived through `openspec/changes/`. Do not modify files under `openspec/` without following the OpenSpec workflow.

## Important Constraints

- Do **NOT** read or modify files under `playground/` — they contain user story data
- Do **NOT** commit `.env` or `.certs/` — they are gitignored
- Run tests: `deno task test` (backend + frontend), `deno task test:backend`, `deno task test:frontend`; plugin tests separately: `deno test --allow-read --allow-write --allow-env --allow-net tests/plugins/`
- The frontend **has a build step**: `deno task build:reader` — edit sources in `reader-src/`, built output goes to `reader-dist/`
- `system.md` is a Vento template — treat it as code, not documentation
- `system.md` uses `{{ lore_scenario }}` (from lore codex) instead of the old `{{ scenario }}` core variable
- Plugin `name` in `plugin.json` must match its directory name exactly

# AGENTS.md

## Overview

**HeartReverie 浮心夜夢** — An AI-driven interactive fiction engine built around [SillyTavern](https://github.com/SillyTavern/SillyTavern). The system consists of a web reader/writer frontend, a Hono backend running on Deno that drives LLM chat via any OpenAI-compatible API, and a plugin system for extensible prompt assembly and tag processing. Licensed under AGPL-3.0-or-later.

## Project Structure

```
system.md                 # Main Vento prompt template (entry point for LLM system prompt)
entrypoint.sh             # Unified startup script: generates TLS certs, launches Deno server
scripts/
  serve.sh                # Dev startup script (calls entrypoint.sh)
writer/                   # Backend server (Hono, TypeScript ESM, Deno)
  app.ts                  # Hono app setup: middleware, route registration, static serving
  server.ts               # Server entry: TLS/HTTP listener startup
  types.ts                # Shared TypeScript interfaces and types
  vendor/
    ventojs.d.ts          # Ambient type declarations for ventojs
  lib/
    plugin-manager.ts     # PluginManager: discovery, loading, manifest validation
    hooks.ts              # HookDispatcher: backend lifecycle hook system
    config.ts             # Environment variable loading and validation
    errors.ts             # RFC 9457 Problem Details helpers
    generation-registry.ts # In-memory refcounted registry marking stories with active LLM generation (guards edit/rewind/branch)
    lore.ts               # Lore codex library (passage storage, retrieval, tag system, template variable generation)
    middleware.ts         # Auth, rate limiting, secure headers
    story.ts              # Story/chapter file operations
    export.ts             # Story export renderers (Markdown/JSON/plain text) + RFC 5987 filename encoding
    template.ts           # Vento template rendering engine
    usage.ts              # Token usage persistence: _usage.json reader/writer with per-story async lock
    chat-shared.ts        # Shared chat execution logic (HTTP + WebSocket)
  routes/
    auth.ts               # POST /api/auth — passphrase verification
    branch.ts             # POST /api/stories/:series/:name/branch — fork a story at a chapter
    chapters.ts           # GET/PUT/DELETE chapters — read, edit, rewind chapter content
    chat.ts               # POST chat — LLM streaming proxy (HTTP fallback)
    config.ts             # GET /api/config — public configuration (background image)
    lore.ts               # Lore codex API routes (CRUD for passages)
    plugins.ts            # GET plugins — frontend module discovery
    prompt.ts             # GET/POST prompt — template preview and file persistence
    stories.ts            # GET stories — series/story listing
    export.ts             # GET /api/stories/:series/:name/export — bundled story download (md/json/txt)
    usage.ts              # GET /api/stories/:series/:name/usage — token usage records + totals
    ws.ts                 # WebSocket upgrade handler and message dispatching
reader-src/               # Frontend SPA source (Vue 3, TypeScript, Vite)
  vite.config.ts          # Vite build configuration
  tsconfig.json           # TypeScript configuration
  tailwind.config.ts      # Tailwind CSS configuration
  src/
    main.ts               # Vue app entry point
    App.vue               # Root component
    router/
      index.ts            # Vue Router with HTML5 history mode
    components/
      AppHeader.vue       # Navigation header
      MainLayout.vue      # Main reading layout
      ContentArea.vue     # Chapter content display area
      ChapterContent.vue  # Chapter content rendering
      Sidebar.vue         # Sidebar component
      ChatInput.vue       # Chat message input and submission
      StorySelector.vue   # Series/story selection UI
      PromptEditor.vue    # System prompt template editor
      PromptEditorPage.vue # Prompt editor page wrapper
      PromptPreview.vue   # Rendered prompt preview
      UsagePanel.vue      # Collapsible token-usage summary + recent records table
      PassphraseGate.vue  # Authentication gate
      SettingsLayout.vue  # Settings page with sidebar navigation
      VentoErrorCard.vue  # Vento template error display component
    components/lore/
      LoreCodexPage.vue   # Lore codex page wrapper
      LoreBrowser.vue     # Lore passage browser and filter UI
      LoreEditor.vue      # Lore passage editor (frontmatter + content)
    composables/
      useAuth.ts          # Authentication state management
      useBackground.ts    # Background image configuration
      useChapterActions.ts # Edit / rewind / branch chapter REST API client
      useChapterNav.ts    # Chapter navigation and polling
      useChatApi.ts       # Chat API (WebSocket with HTTP fallback)
      useFileReader.ts    # File System Access API + IndexedDB
      useLoreApi.ts       # Lore codex API client
      useMarkdownRenderer.ts  # Markdown rendering pipeline
      usePlugins.ts       # Plugin loading and hook management
      usePromptEditor.ts  # Prompt editor state
      useStorySelector.ts # Story selector state
      useStoryExport.ts   # Story export download (Markdown/JSON/TXT)
      useUsage.ts         # Token-usage state: load records, push on chat:done, reset on story change
      useWebSocket.ts     # WebSocket connection management
    lib/
      file-utils.ts       # File utility functions
      markdown-pipeline.ts # Markdown processing pipeline
      plugin-hooks.ts     # Frontend hook dispatcher
      string-utils.ts     # String utilities (Levenshtein, escaping)
      parsers/
        vento-error-parser.ts  # Vento error parsing
    types/
      index.ts            # Frontend TypeScript type definitions
    styles/
      base.css            # Base styles
      theme.css           # Theme styles
reader-dist/              # Built frontend output (gitignored, run `deno task build:reader`)
plugins/                  # Built-in plugins (manifest-driven) + shared utils
  _shared/
    utils.js              # Shared utilities (escapeHtml) used by frontend modules
  context-compaction/     # Tiered context compaction via inline chapter summaries
  imgthink/               # Strip imgthink tags from display
  start-hints/            # First-round chapter opening guidance
  thinking/               # Fold <thinking>/<think> tags into collapsible details
  user-message/           # User message lifecycle: wrap, strip from context/display
  response-notify/        # Toast notification system for backend → frontend messages
tests/                    # Backend tests (Deno)
  writer/
    lib/                  # Backend library tests (*_test.ts)
    routes/               # Backend route handler tests (*_test.ts)
  plugins/                # Plugin tests
    context-compaction/
    user-message/
playground/               # Story data directory (series/stories/chapters)
                          # Underscore-prefixed dirs (_lore/) are system-reserved
openspec/                 # Spec-driven workflow: specs, changes, archives
docs/                     # Documentation (Traditional Chinese)
.agents/                  # Copilot agent skills (e.g., heartreverie-create-plugin)
assets/                   # Static assets (images)
```

## Running the Server

```bash
./scripts/serve.sh        # Dev: starts HTTPS server at https://localhost:8443
./entrypoint.sh           # Production: unified startup (also used by container)
```

The `entrypoint.sh` script auto-generates self-signed TLS certs in `.certs/` on first run (unless `HTTP_ONLY=true` or custom certs are provided via `CERT_FILE`/`KEY_FILE`). HTTPS is required for the File System Access API used by the frontend.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_API_KEY` | Yes | — | LLM provider API key (stored in `.env`) |
| `PASSPHRASE` | Yes | — | API authentication passphrase (stored in `.env`) |
| `PORT` | No | `8443` | Server listen port |
| `LLM_MODEL` | No | `deepseek/deepseek-v3.2` | LLM model identifier |
| `LLM_API_URL` | No | `https://openrouter.ai/api/v1/chat/completions` | LLM chat completions endpoint |
| `LLM_TEMPERATURE` | No | `0.1` | Sampling temperature |
| `LLM_FREQUENCY_PENALTY` | No | `0.13` | Frequency penalty |
| `LLM_PRESENCE_PENALTY` | No | `0.52` | Presence penalty |
| `LLM_TOP_K` | No | `10` | Top-K sampling |
| `LLM_TOP_P` | No | `0` | Top-P (nucleus) sampling |
| `LLM_REPETITION_PENALTY` | No | `1.2` | Repetition penalty |
| `LLM_MIN_P` | No | `0` | Min-P sampling |
| `LLM_TOP_A` | No | `1` | Top-A sampling |
| `PLUGIN_DIR` | No | — | External plugin directory (absolute path) |
| `LOG_LEVEL` | No | `info` | Log level: debug, info, warn, error |
| `LOG_FILE` | No | — | Path to JSON Lines log file (enables file logging with rotation) |
| `LLM_LOG_FILE` | No | `playground/_logs/llm.jsonl` | Path to LLM interaction log file (full request/response); empty string disables |
| `PLAYGROUND_DIR` | No | `./playground` | Story data root |
| `READER_DIR` | No | `./reader-dist` | Frontend static files root |
| `BACKGROUND_IMAGE` | No | `/assets/heart.webp` | Background image URL path for the web reader |
| `PROMPT_FILE` | No | `playground/_prompts/system.md` | Custom prompt template file path |
| `HTTP_ONLY` | No | — | Set to `true` to skip TLS (for reverse-proxy deployments) |
| `CERT_FILE` | No | — | Custom TLS certificate file path |
| `KEY_FILE` | No | — | Custom TLS private key file path |

The `.env` file is gitignored. Copy `.env.example` to `.env` and fill in `LLM_API_KEY` and `PASSPHRASE`.

## Container Deployment

The project uses a single `Containerfile` — a Deno-only image that copies all application files.

### Build and run the application container

```bash
# Build
podman build -t heartreverie:latest .

# Run
podman run -d --name heartreverie \
  -p 8443:8443 \
  -e LLM_API_KEY=your-api-key \
  -e PASSPHRASE=your-passphrase \
  -v ./playground:/app/playground:z \
  heartreverie:latest
```

Optional: mount TLS certificates instead of using auto-generated ones:

```bash
podman run -d --name heartreverie \
  -p 8443:8443 \
  -e LLM_API_KEY=your-api-key \
  -e PASSPHRASE=your-passphrase \
  -e CERT_FILE=/certs/cert.pem \
  -e KEY_FILE=/certs/key.pem \
  -v ./certs:/certs:z \
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
- **File System Access API** — For reading local `.md` files (requires HTTPS secure context)
- **IndexedDB** — Persists directory handle for session restoration

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

## Architecture

### Plugin System

The plugin system uses manifest-driven discovery. Each plugin has a `plugin.json` declaring its capabilities. There are 6 built-in plugins plus a `_shared/utils.js` module providing common frontend utilities (e.g., `escapeHtml`). See `docs/plugin-system.md` for additional documentation (note: that file may lag behind recent refactors).

Key classes:
- `PluginManager` (`writer/lib/plugin-manager.ts`) — scans `plugins/` and optional `PLUGIN_DIR`, validates manifests, loads modules
- `HookDispatcher` (`writer/lib/hooks.ts`) — registers and dispatches async lifecycle hooks with priority ordering
- `PluginRegisterContext` (`writer/types.ts`) — context object passed to plugin `register()`: `{ hooks: PluginHooks, logger: Logger }`; the `hooks` wrapper auto-binds the plugin name, and `context.logger` is always injected during hook dispatch

Plugin interaction layers:
1. **Prompt injection** — `promptFragments` field maps Markdown files to Vento template variables
2. **Prompt tag stripping** — `promptStripTags` field declares plain tag names or regex patterns to remove from previousContext when building prompts
3. **Display tag stripping** — `displayStripTags` field declares plain tag names or regex patterns to remove from frontend display during browser rendering
4. **CSS injection** — `frontendStyles` field declares CSS files to inject as `<link>` elements into the frontend `<head>` before JS modules load
5. **Backend hooks** — `backendModule` registers handlers for 5 lifecycle stages: `prompt-assembly`, `response-stream`, `pre-write`, `post-response`, `strip-tags`
6. **Frontend modules** — `frontendModule` provides browser-side rendering via `frontend-render` hook and notification handling via `notification` hook. Additional frontend hook stages are available for lifecycle integration:
   - `chat:send:before` — pipeline hook: handlers may transform the outgoing user message by returning a `string`; context is `{ message, mode: "send" | "resend" }`.
   - `chapter:render:after` — post-processing hook: handlers may mutate `tokens` after Markdown + initial DOMPurify pass; the dispatcher re-sanitizes any newly added or `.content`-mutated `html` tokens, so plugins never need to sanitize HTML themselves.
   - `story:switch` / `chapter:change` — informational hooks fired on real navigation state changes (no veto). Contexts carry `previousSeries`/`previousStory` and `previousIndex` respectively.
7. **Plugin logger** — each plugin receives a scoped logger via `PluginRegisterContext`; `HookDispatcher` injects `context.logger` during dispatch

### Lore Codex

File-based world-building knowledge system with scoped passages (典籍). Replaces the old `scenario.md` approach. See `docs/lore-codex.md` for full user-facing documentation.

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

Each story may carry a `_config.json` file beside its chapter files to override the server's default LLM sampling parameters for that story only. The file is a JSON object containing any subset of: `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`. Missing fields fall back to the corresponding `LLM_*` environment variable. The `LLM_API_URL` and `LLM_API_KEY` are **not** per-story configurable.

- **Location**: `playground/<series>/<story>/_config.json` (underscore prefix keeps it out of chapter listings)
- **API**: `GET /api/:series/:name/config` returns overrides (`{}` when absent); `PUT /api/:series/:name/config` validates and atomically persists them. PUT returns 404 when the story directory does not exist — it never implicitly creates a story.
- **Validation**: whitelist-only parsing strips unknown keys and silently drops `null`/`undefined`; `model` must be a non-empty string, numeric fields must be finite numbers; violations return 400 Problem Details.
- **Merge semantics**: `Object.assign({}, llmDefaults, overrides)` in `resolveStoryLlmConfig()` — applied once per chat request just after `storyDir` validation, before the upstream LLM fetch body is built.
- **Frontend**: `/settings/llm` page with story picker + per-field override toggles (`useStoryLlmConfig` composable).

Key files:
- `writer/lib/story-config.ts` — validate/read/write/resolve helpers plus typed error classes
- `writer/routes/story-config.ts` — GET/PUT route handlers

### Prompt Rendering Pipeline

1. `buildPromptFromStory()` reads chapters, strips tags, loads status YAML, detects first-round
2. `renderSystemPrompt()` resolves lore variables via `resolveLoreVariables()`, collects plugin variables via `getPromptVariables()`, renders `system.md` through Vento engine
3. Result is sent as the system message to OpenRouter, user input as the user message
4. LLM response is streamed from OpenRouter, written incrementally to chapter file, tags stripped, post-response hooks dispatched

See `docs/prompt-template.md` for the full list of template variables and Vento syntax usage.

### Frontend Rendering Pipeline

Custom XML blocks from LLM output are processed using the **Extract → Placeholder → Reinsert** pattern (implemented in `reader-src/src/lib/markdown-pipeline.ts` and the `useMarkdownRenderer` composable):
1. Extract XML blocks (e.g., `<thinking>`, `<user_message>`) before markdown parsing — extraction is delegated to individual plugin frontend modules via the `frontend-render` hook
2. Replace with HTML comment placeholders
3. Run `marked.parse()` + DOMPurify sanitization
4. Reinsert extracted blocks as rendered HTML components

This prevents markdown from mangling component HTML inside custom XML blocks.

### WebSocket Streaming

The server exposes a WebSocket endpoint at `GET /api/ws` for real-time streaming:

- **Single connection** — one WebSocket per client, registered before body-limit and auth middleware in `writer/app.ts`
- **First-message auth** — client sends `{ type: "auth", passphrase }` as the first message; server validates with timing-safe comparison, responds `auth:ok` or `auth:error` (close code 4001)
- **JSON protocol** — all messages are `{ type: "...", ... }` discriminated unions defined in `writer/types.ts` (`WsClientMessage` / `WsServerMessage`)
- **Chat streaming** — `chat:send` / `chat:resend` messages trigger LLM generation via shared `executeChat()` function in `writer/lib/chat-shared.ts`; each SSE chunk is dual-written (file + WebSocket `chat:delta`); completed with `chat:done` (includes optional `usage: TokenUsageRecord | null` field) or `chat:error`
- **Stop generation** — `chat:abort` message cancels an active LLM generation; backend closes the upstream LLM connection via `AbortSignal`, preserves partial chapter content, and responds with `chat:aborted`
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

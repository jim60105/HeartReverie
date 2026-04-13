# AGENTS.md

## Overview

**HeartReverie 浮心夜夢** — An AI-driven interactive fiction engine built around [SillyTavern](https://github.com/SillyTavern/SillyTavern). The system consists of a web reader/writer frontend, a Hono backend running on Deno that drives LLM chat via any OpenAI-compatible API, a Rust CLI for applying state patches, and a plugin system for extensible prompt assembly and tag processing. Licensed under AGPL-3.0-or-later.

## Project Structure

```
system.md                 # Main Vento prompt template (entry point for LLM system prompt)
entrypoint.sh             # Unified startup script: generates TLS certs, launches Deno server
serve.zsh                 # Dev startup script (calls entrypoint.sh)
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
    lore.ts               # Lore codex library (passage storage, retrieval, tag system, template variable generation)
    middleware.ts         # Auth, rate limiting, secure headers
    story.ts              # Story/chapter file operations
    template.ts           # Vento template rendering engine
    chat-shared.ts        # Shared chat execution logic (HTTP + WebSocket)
  routes/
    auth.ts               # POST /api/auth — passphrase verification
    chapters.ts           # GET/PUT chapters — read and write chapter content
    chat.ts               # POST chat — LLM streaming proxy (HTTP fallback)
    config.ts             # GET /api/config — public configuration (background image)
    lore.ts               # Lore codex API routes (CRUD for passages)
    plugins.ts            # GET plugins — frontend module discovery
    prompt.ts             # GET/POST prompt — template preview and file persistence
    stories.ts            # GET stories — series/story listing
    ws.ts                 # WebSocket upgrade handler and message dispatching
reader-src/               # Frontend SPA source (Vue 3, TypeScript, Vite)
  package.json            # Dependencies: vue, vue-router, marked, dompurify
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
      useChapterNav.ts    # Chapter navigation and polling
      useChatApi.ts       # Chat API (WebSocket with HTTP fallback)
      useFileReader.ts    # File System Access API + IndexedDB
      useLoreApi.ts       # Lore codex API client
      useMarkdownRenderer.ts  # Markdown rendering pipeline
      usePlugins.ts       # Plugin loading and hook management
      usePromptEditor.ts  # Prompt editor state
      useStorySelector.ts # Story selector state
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
plugins/                  # 11 built-in plugins (manifest-driven) + shared utils
  _shared/
    utils.js              # Shared utilities (escapeHtml) used by frontend modules
  context-compaction/     # Tiered context compaction via inline chapter summaries
  de-robotization/        # De-robotization prompt fragment
  imgthink/               # Strip imgthink tags from display
  options/                # Options panel extraction, rendering, and prompt
  state-patches/          # State patch lifecycle: Rust binary + frontend rendering
    rust/                 # Rust CLI for YAML state patch processing
  status/                 # Status panel extraction, rendering, and prompt
  thinking/               # Fold <thinking>/<think> tags into collapsible details
  threshold-lord/         # Threshold Lord prompt fragments and disclaimer cleanup
  t-task/                 # T-task prompt fragment with tag stripping
  user-message/           # User message lifecycle: wrap, strip from context/display
  writestyle/             # Writing style instructions
tests/                    # Backend tests (Deno)
  writer/
    lib/                  # Backend library tests (*_test.ts)
    routes/               # Backend route handler tests (*_test.ts)
  plugins/                # Plugin tests
    context-compaction/
    user-message/
playground/               # Story data directory (series/stories/chapters)
scripts/
  migrate-scenario.ts    # Scenario.md → lore codex migration script
openspec/                 # Spec-driven workflow: specs, changes, archives
docs/                     # Documentation (Traditional Chinese)
skills/                   # Copilot agent skills (e.g., heartreverie-create-plugin)
assets/                   # Static assets (images)
```

## Running the Server

```bash
zsh ./serve.zsh           # Dev: starts HTTPS server at https://localhost:8443
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
| `PLAYGROUND_DIR` | No | `./playground` | Story data root |
| `READER_DIR` | No | `./reader-dist` | Frontend static files root |
| `BACKGROUND_IMAGE` | No | `/assets/heart.webp` | Background image URL path for the web reader |
| `PROMPT_FILE` | No | `playground/prompts/system.md` | Custom prompt template file path |
| `HTTP_ONLY` | No | — | Set to `true` to skip TLS (for reverse-proxy deployments) |
| `CERT_FILE` | No | — | Custom TLS certificate file path |
| `KEY_FILE` | No | — | Custom TLS private key file path |

The `.env` file is gitignored. Copy `.env.example` to `.env` and fill in `LLM_API_KEY` and `PASSPHRASE`.

## Building the Rust CLI

```bash
cd plugins/state-patches/rust
cargo build --release
```

The resulting binary at `target/release/state-patches` is invoked by the `state-patches` plugin after each LLM response.

## Container Deployment

The project uses a two-Containerfile architecture:

1. **Rust binary builder** (`plugins/state-patches/rust/Containerfile`) — Builds the `state-patches` binary using cargo-chef pattern. The binary is committed to git so most users never need this.
2. **Main application** (`Containerfile`) — Deno-only image that copies the pre-built binary and all application files.

### Rebuild Rust binary (only when Rust source changes)

```bash
cd plugins/state-patches
podman build --output=. --target=binary -f rust/Containerfile rust/
```

This outputs `plugins/state-patches/state-patches` which should be committed to git.

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
- GPL-3.0 license header at the top of every source file

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

### Rust (`plugins/state-patches/rust/`)

- 2024 edition, modular architecture (main, pipeline, parser, patch_ops, yaml_nav, convert)
- Standard `rustfmt` formatting
- `Result`-based error handling, errors logged to stderr
- Custom JSONPatch format (not RFC 6902): supports `replace`, `delta`, `insert`, `remove` operations
- Dependencies: `serde_yaml`, `serde_json`, `regex`

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

The plugin system uses manifest-driven discovery. Each plugin has a `plugin.json` declaring its capabilities. There are 11 built-in plugins plus a `_shared/utils.js` module providing common frontend utilities (e.g., `escapeHtml`). See `docs/plugin-system.md` for additional documentation (note: that file may lag behind recent refactors).

Key classes:
- `PluginManager` (`writer/lib/plugin-manager.ts`) — scans `plugins/` and optional `PLUGIN_DIR`, validates manifests, loads modules
- `HookDispatcher` (`writer/lib/hooks.ts`) — registers and dispatches async lifecycle hooks with priority ordering

Plugin interaction layers:
1. **Prompt injection** — `promptFragments` field maps Markdown files to Vento template variables
2. **Prompt tag stripping** — `promptStripTags` field declares plain tag names or regex patterns to remove from previousContext when building prompts
3. **Display tag stripping** — `displayStripTags` field declares plain tag names or regex patterns to remove from frontend display during browser rendering
4. **Backend hooks** — `backendModule` registers handlers for 5 lifecycle stages: `prompt-assembly`, `response-stream`, `pre-write`, `post-response`, `strip-tags`
5. **Frontend modules** — `frontendModule` provides browser-side rendering via `frontend-render` hook

### Lore Codex

File-based world-building knowledge system with scoped passages (典籍). Replaces the old `scenario.md` approach. See `docs/lore-codex.md` for full user-facing documentation.

- **Three scopes**: global (all stories), series (all stories in a series), story (single story)
- **Passage format**: `.md` files with YAML frontmatter (`tags`, `priority`, `enabled`)
- **Tag system**: frontmatter tags + directory-as-tag (immediate parent subdir name), normalized for template variable names (lowercase, hyphens/spaces → underscores)
- **Template variable injection**: `lore_all` (all enabled passages), `lore_<tag>` (per-tag), `lore_tags` (tag name array)
- **API**: CRUD routes under `/api/lore/` for managing passages

Key files:
- `writer/lib/lore.ts` — Core library: frontmatter parsing, tag normalization, scope collection, template variable generation
- `writer/routes/lore.ts` — REST API routes for passage CRUD
- `scripts/migrate-scenario.ts` — Migration script from `scenario.md` to lore codex

### Prompt Rendering Pipeline

1. `buildPromptFromStory()` reads chapters, strips tags, loads status YAML, detects first-round
2. `renderSystemPrompt()` resolves lore variables via `resolveLoreVariables()`, collects plugin variables via `getPromptVariables()`, renders `system.md` through Vento engine
3. Result is sent as the system message to OpenRouter, user input as the user message
4. LLM response is streamed from OpenRouter, written incrementally to chapter file, tags stripped, post-response hooks dispatched

### Frontend Rendering Pipeline

Custom XML blocks from LLM output are processed using the **Extract → Placeholder → Reinsert** pattern (implemented in `reader-src/src/lib/markdown-pipeline.ts` and the `useMarkdownRenderer` composable):
1. Extract XML blocks (e.g., `<status>`, `<options>`) before markdown parsing — extraction is delegated to individual plugin frontend modules via the `frontend-render` hook
2. Replace with HTML comment placeholders
3. Run `marked.parse()` + DOMPurify sanitization
4. Reinsert extracted blocks as rendered HTML components

This prevents markdown from mangling component HTML inside custom XML blocks.

### WebSocket Streaming

The server exposes a WebSocket endpoint at `GET /api/ws` for real-time streaming:

- **Single connection** — one WebSocket per client, registered before body-limit and auth middleware in `writer/app.ts`
- **First-message auth** — client sends `{ type: "auth", passphrase }` as the first message; server validates with timing-safe comparison, responds `auth:ok` or `auth:error` (close code 4001)
- **JSON protocol** — all messages are `{ type: "...", ... }` discriminated unions defined in `writer/types.ts` (`WsClientMessage` / `WsServerMessage`)
- **Chat streaming** — `chat:send` / `chat:resend` messages trigger LLM generation via shared `executeChat()` function in `writer/lib/chat-shared.ts`; each SSE chunk is dual-written (file + WebSocket `chat:delta`); completed with `chat:done` or `chat:error`
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
- **Rate limiting**: Global 60 req/min, auth/chat/preview 10 req/min (WebSocket bypasses rate limiting)
- **Path traversal prevention**: `isValidParam()`, `safePath()`, `isPathContained()`, `isValidPluginName()` — all enforce directory boundaries
- **SSTI prevention**: `validateTemplate()` whitelist-only parser for user-submitted Vento templates — blocks function calls, property access, `process.env`
- **Frontend security**: DOMPurify on all rendered HTML, CSP via `<meta>` tag with SRI hashes
- **HTTP hardening**: Hono secureHeaders middleware

## OpenSpec Workflow

The project uses a spec-driven development workflow managed by OpenSpec skills in `.github/skills/`. Specifications live in `openspec/specs/`, changes are proposed/implemented/archived through `openspec/changes/`. Do not modify files under `openspec/` without following the OpenSpec workflow.

## Important Constraints

- Do **NOT** read or modify files under `playground/` — they contain user story data
- Do **NOT** commit `.env`, `.certs/`, or `current-status.yml` — they are gitignored
- Run tests: `deno task test` (backend + frontend), `deno task test:backend`, `deno task test:frontend`; plugin tests separately: `deno test --allow-read --allow-write --allow-env --allow-net tests/plugins/`
- The frontend **has a build step**: `deno task build:reader` — edit sources in `reader-src/`, built output goes to `reader-dist/`
- `system.md` is a Vento template — treat it as code, not documentation
- `system.md` uses `{{ lore_scenario }}` (from lore codex) instead of the old `{{ scenario }}` core variable
- Plugin `name` in `plugin.json` must match its directory name exactly
- The malformed-JSON fallback parser in state-patches exists intentionally — some source `.md` files contain unescaped quotes in string values

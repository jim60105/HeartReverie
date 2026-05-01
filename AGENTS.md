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
    plugin-actions.ts     # POST /api/plugins/:pluginName/run-prompt — plugin action button LLM round (path-traversal-safe, optional atomic append)
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
      PluginActionBar.vue # Renders plugin-contributed action buttons (between UsagePanel and ChatInput)
      StorySelector.vue   # Series/story selection UI
      PromptEditor.vue    # System prompt template editor (cards mode + raw-text fallback)
      PromptEditorPage.vue # Prompt editor page wrapper
      PromptEditorMessageCard.vue # Single message card (role select + body textarea + insert-variable helper + reorder/delete)
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
      usePluginActions.ts # Plugin action-button visibility filter + click dispatch
      usePromptEditor.ts  # Prompt editor state (MessageCard[] + parse/serialize, raw fallback toggle, originalRawSource snapshot, lossy-strip flag, pre-save validity guard)
      useStorySelector.ts # Story selector state
      useStoryExport.ts   # Story export download (Markdown/JSON/TXT)
      useUsage.ts         # Token-usage state: load records, push on chat:done, reset on story change
      useWebSocket.ts     # WebSocket connection management
    lib/
      file-utils.ts       # File utility functions
      markdown-pipeline.ts # Markdown processing pipeline
      plugin-hooks.ts     # Frontend hook dispatcher
      string-utils.ts     # String utilities (Levenshtein, escaping)
      template-parser.ts  # Hand-rolled scanner for system.md: parseSystemTemplate() ↔ serializeMessageCards() (cards mode load/save)
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
  dialogue-colorize/      # Colourise dialogue quote runs via CSS Custom Highlight API (no DOM mutation)
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
| `LLM_MAX_COMPLETION_TOKENS` | No | `4096` | Maximum total completion tokens (reasoning + content). Sent as `max_completion_tokens` to the upstream LLM. Must be a positive safe integer. |
| `LLM_REASONING_ENABLED` | No | `true` | When true, request reasoning from the upstream LLM. Parsed as boolean. |
| `LLM_REASONING_EFFORT` | No | `xhigh` | Reasoning effort level: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`. |
| `LLM_REASONING_OMIT` | No | `false` | When true, omit the `reasoning` block from upstream requests entirely (escape hatch for strict OpenAI-compatible providers that reject unknown fields). |
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

The plugin system uses manifest-driven discovery. Each plugin has a `plugin.json` declaring its capabilities. There are 7 built-in plugins plus a `_shared/utils.js` module providing common frontend utilities (e.g., `escapeHtml`). See `docs/plugin-system.md` for additional documentation (note: that file may lag behind recent refactors).

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
   - `chapter:dom:ready` — DOM-commit hook: fired by `ChapterContent.vue` via a `flush: "post"` watcher after Vue applies v-html to the live DOM; context carries `{ container, tokens, rawMarkdown, chapterIndex }`. Used by plugins (e.g. `dialogue-colorize`) that need to operate on the rendered DOM (text nodes, ranges) rather than the token array. Skipped while the chapter editor textarea is shown.
   - `action-button:click` — async dispatch hook fired when the user clicks a plugin-contributed button in `PluginActionBar`. Context exposes `{ buttonId, pluginName, series, name, storyDir, lastChapterIndex }` plus curried helpers `runPluginPrompt(promptFile, opts?)`, `notify(input)`, and `reload()`. The dispatcher only runs handlers whose owning plugin matches `context.pluginName` (origin-filtered) and awaits each handler's promise in priority order; unhandled rejections surface a default error toast.
   - `story:switch` / `chapter:change` — informational hooks fired on real navigation state changes (no veto). Contexts carry `previousSeries`/`previousStory` and `previousIndex` respectively.
7. **Action buttons** — `actionButtons` manifest field declares `ActionButtonDescriptor` entries (`id`, `label`, `icon?`, `tooltip?`, `priority?`, `visibleWhen?` with two-value enum `"last-chapter-backend" | "backend-only"`). Descriptors render in `PluginActionBar` (mounted between `UsagePanel` and `ChatInput`) and dispatch the `action-button:click` frontend hook. Click handlers typically call the curried `runPluginPrompt(promptFile, opts?)` helper, which drives `POST /api/plugins/:pluginName/run-prompt` (path-traversal-safe via `Deno.realPath`, `.md`-only, route-rate-limited to 30/min). When called with `{ append: true, appendTag }`, the backend strips at most one outer `<{appendTag}>` wrapper from the response, atomically appends `\n<{appendTag}>\n…\n</{appendTag}>\n` to the highest-numbered chapter file, re-reads the chapter, and dispatches `post-response` with `source: "plugin-action"` and `content` set to the full chapter contents after the append. The dispatcher filters `action-button:click` handlers by `originPluginName` so plugins only see clicks on their own buttons.
8. **Plugin logger** — each plugin receives a scoped logger via `PluginRegisterContext`; `HookDispatcher` injects `context.logger` during dispatch

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

Each story may carry a `_config.json` file beside its chapter files to override the server's default LLM sampling parameters for that story only. The file is a JSON object containing any subset of: `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`, `reasoningEnabled`, `reasoningEffort`, `maxCompletionTokens`. The exhaustive whitelist is exported as `STORY_LLM_CONFIG_KEYS` from `writer/lib/story-config.ts` and is the single source of truth for the validator, the `GET /api/llm-defaults` route payload, and the frontend settings form. Missing fields fall back to the corresponding `LLM_*` environment variable. `reasoningEnabled` defaults to `true` and `reasoningEffort` defaults to `"xhigh"`; `reasoningEffort` must be one of the 6-value enum: `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`. `maxCompletionTokens` must be a positive safe integer and is sent as `max_completion_tokens` on every upstream chat request (default `4096`). The `LLM_API_URL` and `LLM_API_KEY` are **not** per-story configurable. `LLM_REASONING_OMIT` is a deployment-level escape hatch (for strict OpenAI-compatible providers that reject unknown fields) and is **not** exposed in `_config.json`.

- **Location**: `playground/<series>/<story>/_config.json` (underscore prefix keeps it out of chapter listings)
- **API**: `GET /api/:series/:name/config` returns overrides (`{}` when absent); `PUT /api/:series/:name/config` validates and atomically persists them. PUT returns 404 when the story directory does not exist — it never implicitly creates a story. `GET /api/llm-defaults` (auth-required, `Cache-Control: no-store`) returns the resolved server-side defaults for every whitelisted key — used by the frontend settings page to display the value that will apply when an override is unset.
- **Validation**: whitelist-only parsing strips unknown keys and silently drops `null`/`undefined`; `model` must be a non-empty string, numeric fields must be finite numbers, `maxCompletionTokens` must be a positive safe integer; violations return 400 Problem Details.
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

See `docs/prompt-template.md` for the `{{ message }}` tag syntax, role validation, ordering / coalescing semantics, worked multi-turn examples, and the Prompt Editor cards-mode UI (per-message cards, raw-text fallback toggle, lossy-strip warning, pre-save validity guard).

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

# AGENTS.md

## Overview

**HeartReverie 浮心夜夢** — An AI-driven interactive fiction engine built around [SillyTavern](https://github.com/SillyTavern/SillyTavern). The system consists of a web reader/writer frontend, a Hono backend running on Deno that drives LLM chat via any OpenAI-compatible API, a Rust CLI for applying state patches, and a plugin system for extensible prompt assembly and tag processing. Licensed under AGPL-3.0-or-later.

## Project Structure

```
system.md                 # Main Vento prompt template (entry point for LLM system prompt)
serve.zsh                 # Startup script: generates TLS certs, launches Deno server
writer/                   # Backend server (Hono, TypeScript ESM, Deno)
  server.ts               # Main server (~1030 lines): routes, prompt rendering, streaming
  types.ts                # Shared TypeScript interfaces and types
  vendor/
    ventojs.d.ts          # Ambient type declarations for ventojs
  lib/
    plugin-manager.ts     # PluginManager: discovery, loading, manifest validation
    hooks.ts              # HookDispatcher: backend lifecycle hook system
    config.ts             # Environment variable loading and validation
    errors.ts             # RFC 9457 Problem Details helpers
    middleware.ts         # Auth, rate limiting, secure headers
    story.ts              # Story/chapter file operations
    template.ts           # Vento template rendering engine
    string-utils.ts       # Levenshtein distance, tag stripping, escaping
  routes/
    auth.ts               # POST /api/auth — passphrase verification
    chapters.ts           # GET/PUT chapters — read and write chapter content
    chat.ts               # POST chat — OpenRouter streaming proxy
    plugins.ts            # GET plugins — frontend module discovery
    prompt.ts             # GET/POST prompt — template preview
    stories.ts            # GET stories — series/story listing
reader/                   # Frontend app (vanilla ES modules, no build step)
  index.html              # Single entry point — all CSS inline, Tailwind via CDN
  js/
    chapter-nav.js        # App orchestrator: navigation, state, sidebar relocation
    file-reader.js        # File System Access API + IndexedDB persistence
    md-renderer.js        # 9-step markdown rendering pipeline
    status-bar.js         # <status> block parser → themed HTML card
    options-panel.js      # <options> block parser → 2×2 button grid
    variable-display.js   # <UpdateVariable> block parser → collapsible <pre>
    vento-error-display.js # Vento template error display component
    chat-input.js         # Chat message input and submission
    story-selector.js     # Series/story selection UI
    prompt-editor.js      # System prompt template editor
    prompt-preview.js     # Rendered prompt preview
    passphrase-gate.js    # Authentication gate
    plugin-loader.js      # Frontend plugin module loader
    plugin-hooks.js       # FrontendHookDispatcher for browser-side hooks
    utils.js              # Shared utilities (escapeHtml, etc.)
plugins/                  # 10 built-in plugins (manifest-driven)
  state-patches/
    plugin.json           # Plugin manifest
    handler.js            # Post-response hook: invokes Rust binary
    frontend.js           # UpdateVariable block extraction and rendering
    rust/                 # Rust CLI for YAML state patch processing
      Cargo.toml          # Rust 2024 edition
      src/                # Rust source modules (main, pipeline, parser, patch_ops, yaml_nav, convert)
      tests/              # Integration tests
tests/                    # All test files (mirroring source structure)
  writer/
    lib/                  # Backend library tests (*_test.ts)
    routes/               # Backend route handler tests (*_test.ts)
  reader/
    js/                   # Frontend tests (*_test.js)
playground/               # Story data directory (series/stories/chapters)
openspec/                 # Spec-driven workflow: specs, changes, archives
docs/                     # Documentation (Traditional Chinese)
```

### Frontend Module Dependency Graph

```
index.html
  └── chapter-nav.js
        ├── file-reader.js
        ├── story-selector.js
        ├── chat-input.js
        ├── plugin-loader.js
        │     └── plugin-hooks.js
        └── md-renderer.js
              ├── status-bar.js
              ├── options-panel.js
              ├── variable-display.js
              ├── vento-error-display.js
              └── utils.js
```

## Running the Server

```bash
zsh ./serve.zsh           # Starts HTTPS server at https://localhost:8443
```

The script auto-generates self-signed TLS certs in `.certs/` on first run. HTTPS is required for the File System Access API used by the frontend.

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
| `READER_DIR` | No | `./reader` | Frontend static files root |
| `BACKGROUND_IMAGE` | No | `/assets/heart.webp` | Background image URL path for the web reader |

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

### JavaScript — Frontend (`reader/js/`)

- Vanilla ES modules, no TypeScript, no build step, no bundler, no framework
- **Single quotes** for strings (differs from backend)
- Semicolons always used
- JSDoc `@param`/`@returns` on exported functions
- Silent error handling — graceful degradation, no `console.error`
- All inline CSS in `index.html` `<style>` block — no external stylesheet
- UI text in Traditional Chinese (zh-TW); comments and code in English

### Frontend Technology Stack

- **Tailwind CSS** — Via CDN (`cdn.tailwindcss.com`)
- **marked.js** — Markdown parser via CDN
- **DOMPurify** — HTML sanitization
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

The plugin system uses manifest-driven discovery. Each plugin has a `plugin.json` declaring its capabilities. See `docs/plugin-system.md` for full documentation.

Key classes:
- `PluginManager` (`writer/lib/plugin-manager.ts`) — scans `plugins/` and optional `PLUGIN_DIR`, validates manifests, loads modules
- `HookDispatcher` (`writer/lib/hooks.ts`) — registers and dispatches async lifecycle hooks with priority ordering

Plugin interaction layers:
1. **Prompt injection** — `promptFragments` field maps Markdown files to Vento template variables
2. **Prompt tag stripping** — `promptStripTags` field declares plain tag names or regex patterns to remove from previousContext when building prompts
3. **Display tag stripping** — `displayStripTags` field declares plain tag names or regex patterns to remove from frontend display during browser rendering
4. **Backend hooks** — `backendModule` registers handlers for 5 lifecycle stages: `prompt-assembly`, `response-stream`, `pre-write`, `post-response`, `strip-tags`
5. **Frontend modules** — `frontendModule` provides browser-side rendering via `frontend-render` hook

### Prompt Rendering Pipeline

1. `buildPromptFromStory()` reads chapters, strips tags, loads status YAML, detects first-round
2. `renderSystemPrompt()` collects plugin variables via `getPromptVariables()`, renders `system.md` through Vento engine
3. Result is sent as the system message to OpenRouter, user input as the user message
4. LLM response is streamed from OpenRouter, written incrementally to chapter file, tags stripped, post-response hooks dispatched

### Frontend Rendering Pipeline

Custom XML blocks from LLM output are processed using the **Extract → Placeholder → Reinsert** pattern:
1. Extract XML blocks (e.g., `<status>`, `<options>`) before markdown parsing
2. Replace with HTML comment placeholders
3. Run `marked.parse()` + DOMPurify sanitization
4. Reinsert extracted blocks as rendered HTML components

This prevents markdown from mangling component HTML inside custom XML blocks.

### Security Patterns

- **Authentication**: Passphrase via `X-Passphrase` header, timing-safe comparison (`@std/crypto/timing-safe-equal`)
- **Rate limiting**: Global 60 req/min, auth/chat/preview 10 req/min
- **Path traversal prevention**: `isValidParam()`, `safePath()`, `isPathContained()`, `isValidPluginName()` — all enforce directory boundaries
- **SSTI prevention**: `validateTemplate()` whitelist-only parser for user-submitted Vento templates — blocks function calls, property access, `process.env`
- **Frontend security**: DOMPurify on all rendered HTML, CSP via `<meta>` tag with SRI hashes
- **HTTP hardening**: Hono secureHeaders middleware

## OpenSpec Workflow

The project uses a spec-driven development workflow managed by OpenSpec skills in `.github/skills/`. Specifications live in `openspec/specs/`, changes are proposed/implemented/archived through `openspec/changes/`. Do not modify files under `openspec/` without following the OpenSpec workflow.

## Important Constraints

- Do **NOT** read or modify files under `playground/` — they contain user story data
- Do **NOT** commit `.env`, `.certs/`, or `current-status.yml` — they are gitignored
- Run tests with `deno test --allow-read --allow-write --allow-env --allow-net tests/writer/ tests/reader/js/`
- The frontend has **no build step** — edit files directly, refresh browser to see changes
- `system.md` is a Vento template — treat it as code, not documentation
- Plugin `name` in `plugin.json` must match its directory name exactly
- The malformed-JSON fallback parser in state-patches exists intentionally — some source `.md` files contain unescaped quotes in string values

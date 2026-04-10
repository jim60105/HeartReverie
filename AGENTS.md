# AGENTS.md

## Overview

**MD Story Tools** — A toolset for AI-driven interactive fiction, built around [SillyTavern](https://github.com/SillyTavern/SillyTavern). The system consists of a web reader/writer frontend, a Hono backend running on Deno that drives LLM chat via OpenRouter, a Rust CLI for applying state patches, and a plugin system for extensible prompt assembly and tag processing. Licensed under GPL-3.0-or-later.

## Project Structure

```
system.md                 # Main Vento prompt template (entry point for LLM system prompt)
serve.zsh                 # Startup script: generates TLS certs, launches Deno server
writer/                   # Backend server (Hono, ESM, Deno)
  server.js               # Main server (~1030 lines): routes, prompt rendering, streaming
  deno.json               # Import map and task definitions
  lib/
    plugin-manager.js     # PluginManager: discovery, loading, manifest validation
    hooks.js              # HookDispatcher: backend lifecycle hook system
reader/                   # Frontend app (vanilla ES modules, no build step)
  index.html              # Single entry point, all CSS inline, Tailwind via CDN
  js/                     # 15 ES module files (~1620 lines total)
  AGENTS.md               # Frontend-specific instructions
plugins/                  # 12 built-in plugins (manifest-driven)
apply-patches/            # Rust CLI for YAML state patch processing
  src/main.rs             # Single-file implementation
  Cargo.toml              # Rust 2024 edition
  AGENTS.md               # Rust-specific instructions
playground/               # Story data directory (series/stories/chapters)
openspec/                 # Spec-driven workflow: specs, changes, archives
docs/                     # Documentation (Traditional Chinese)
```

## Running the Server

```bash
zsh ./serve.zsh           # Starts HTTPS server at https://localhost:8443
```

The script auto-generates self-signed TLS certs in `.certs/` on first run. HTTPS is required for the File System Access API used by the frontend.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | Yes | — | OpenRouter API key (stored in `.env`) |
| `PASSPHRASE` | Yes | — | API authentication passphrase (stored in `.env`) |
| `PORT` | No | `8443` | Server listen port |
| `OPENROUTER_MODEL` | No | `deepseek/deepseek-v3.2` | LLM model identifier |
| `PLUGIN_DIR` | No | — | External plugin directory (absolute path) |
| `PLAYGROUND_DIR` | No | `./playground` | Story data root |
| `READER_DIR` | No | `./reader` | Frontend static files root |

The `.env` file is gitignored. Create it manually with `OPENROUTER_API_KEY` and `PASSPHRASE`.

## Building the Rust CLI

```bash
cd apply-patches
cargo build --release
```

The resulting binary at `target/release/apply-patches` is invoked by the `apply-patches` plugin after each LLM response.

## Code Style

### JavaScript — Backend (`writer/`)

- ESM modules (`import`/`export`)
- **Double quotes** for strings
- Semicolons always used
- `async/await` for all asynchronous operations
- Private class fields with `#` prefix
- JSDoc comments on functions
- Error responses follow RFC 9457 Problem Details format (`type`, `title`, `status`, `detail`)
- GPL-3.0 license header at the top of every source file

### JavaScript — Frontend (`reader/js/`)

- ESM modules, no build step, no bundler, no framework
- **Single quotes** for strings (differs from backend)
- Semicolons always used
- JSDoc `@param`/`@returns` on exported functions
- UI text in Traditional Chinese (zh-TW); comments and code in English

### Rust (`apply-patches/`)

- 2024 edition, single-file architecture (`main.rs`)
- Standard `rustfmt` formatting
- `Result`-based error handling, errors logged to stderr

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
- `PluginManager` (`writer/lib/plugin-manager.js`) — scans `plugins/` and optional `PLUGIN_DIR`, validates manifests, loads modules
- `HookDispatcher` (`writer/lib/hooks.js`) — registers and dispatches async lifecycle hooks with priority ordering

Plugin interaction layers:
1. **Prompt injection** — `promptFragments` field maps Markdown files to Vento template variables
2. **Tag stripping** — `stripTags` field declares plain tag names or regex patterns to remove from LLM output
3. **Backend hooks** — `backendModule` registers handlers for 4 lifecycle stages: `prompt-assembly`, `response-stream`, `post-response`, `strip-tags`
4. **Frontend modules** — `frontendModule` provides browser-side rendering via `frontend-render` and `frontend-strip` hooks

### Prompt Rendering Pipeline

1. `buildPromptFromStory()` reads chapters, strips tags, loads status YAML, detects first-round
2. `renderSystemPrompt()` collects plugin variables via `getPromptVariables()`, renders `system.md` through Vento engine
3. Result is sent as the system message to OpenRouter, user input as the user message
4. LLM response is streamed back, tags stripped, post-response hooks dispatched

### Frontend Rendering Pipeline

Custom XML blocks from LLM output are processed using Extract → Placeholder → Reinsert pattern:
1. Extract XML blocks (e.g., `<status>`, `<options>`) before markdown parsing
2. Replace with HTML comment placeholders
3. Run `marked.parse()` + DOMPurify sanitization
4. Reinsert extracted blocks as rendered HTML components

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
- Run tests with `deno test --allow-read --allow-write --allow-env --allow-net writer/ reader/js/`
- The frontend has **no build step** — edit files directly, refresh browser to see changes
- `system.md` is a Vento template — treat it as code, not documentation
- Plugin `name` in `plugin.json` must match its directory name exactly

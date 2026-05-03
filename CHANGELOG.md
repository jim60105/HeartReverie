# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Removed

- TLS support has been removed from the application container and Helm chart. The server now only listens on plain HTTP (default port `8080`, previously `8443`). The `entrypoint.sh` script has been deleted; `scripts/serve.sh` and the `Containerfile` start `deno run` directly. The `HTTP_ONLY`, `CERT_FILE`, and `KEY_FILE` environment variables are no longer recognized. The Helm chart's top-level `tls.*` values, the `/certs` volume mount, and self-signed certificate generation have all been removed. **Operators are now responsible for terminating TLS at an upstream reverse proxy or Kubernetes Ingress controller.**
- File System Access API reader mode and IndexedDB directory-handle persistence have been removed. The reader now exclusively loads stories from the writer backend over HTTP/WebSocket.

### Added

- No other unreleased changes yet.

## [0.5.0] - 2026-05-02

### Added

- Plugin action buttons: plugin manifests can now declare an `actionButtons` array that surfaces clickable buttons in the reader between the usage panel and chat input, dispatching a frontend `action-button:click` hook to the owning plugin and able to call a new `runPluginPrompt` helper that streams the LLM with optional append-into-chapter behaviour. Includes a new authenticated `POST /api/plugins/:pluginName/run-prompt` route with WebSocket streaming, dedicated rate limit, atomic generation lock, and HTTP fallback.
- Chapter-jump boundary buttons (`⇇` / `⇉`) in the header that go to the first / last chapter, with disabled states at boundaries and Chinese tooltips.
- Mobile-responsive header at viewport widths ≤ 767 px (audited 360–767 px at default text scaling): hides the folder-name breadcrumb and the boundary-jump buttons, forces the header onto a single row without wrapping, and pins button text to a single line via `white-space: nowrap`.

### Changed

- Reader header tightened: replaced the `📂 選擇資料夾` button with the `📖` story-selector dropdown as the single entry point for loading folders / picking stories; the story-selector summary collapses to the `📖` glyph once a story is selected. Header buttons unified to consistent compact padding for a tighter bar.
- Story-selector route synchronization is now hosted in a detached effect scope at module lifetime, surviving component unmounts so that watcher disposal across navigations no longer breaks reactive state.
- Plugin-core spec hardened: `frontend.js` path requirement now uses a normative `SHALL` keyword.

### Fixed

- Story-selector dropdown story list no longer stays empty after the user reloads on a `/settings/*` page and navigates back to the reading layout. Picking a series now reliably triggers `fetchStories` and populates the story dropdown.
- Prompt-editor toolbar action cluster (`＋ 新增訊息`, `↻ 回復預設`, `儲存`, `預覽 Prompt`) wraps onto multiple right-aligned rows at narrow viewports instead of clipping the rightmost button past the viewport edge.
- Removed a dead `☰` hamburger button and the unused `mobileMenuOpen` ref from the header that did nothing on mobile.

## [0.4.0] - 2026-05-01

### Added

- Multi-message Vento prompt template: new `{{ message "role" }}…{{ /message }}` tag lets `system.md` emit a structured `ChatMessage[]` with `system` / `user` / `assistant` roles, replacing the previous single concatenated string and removing the implicit trailing user-turn append.
- Cards-mode Prompt Editor: per-message cards with role select, body textarea, reorder / duplicate / delete, insert-variable helper, raw-text fallback toggle with lossless cards↔raw round-trip, persistent lossy-strip warning, parser-error banner, and pre-save validity guard.
- LLM reasoning configuration: new `LLM_REASONING_ENABLED`, `LLM_REASONING_EFFORT` (`none`/`minimal`/`low`/`medium`/`high`/`xhigh`), and `LLM_REASONING_OMIT` env vars, plus per-story overrides; reasoning content streams into a chapter `<think>` block.
- `LLM_MAX_COMPLETION_TOKENS` env var and per-story `maxCompletionTokens` override sent as `max_completion_tokens` on every upstream request (default 4096).
- `GET /api/llm-defaults` exposes the resolved server-side LLM defaults to the settings page so unset overrides display the value that will actually apply.
- Dialogue-colorize built-in plugin: highlights paired dialogue quote runs via the CSS Custom Highlight API without mutating the rendered DOM.
- OpenRouter app-attribution headers (`HTTP-Referer`, `X-OpenRouter-Title`, `X-OpenRouter-Categories`) sent on every chat request so HeartReverie appears in OpenRouter rankings.
- Bind-mounted plugin directory support in the dev container script for editing plugin sources without rebuilding the image.

### Changed

- Backend prompt pipeline now consumes the template-emitted `ChatMessage[]` directly; preview endpoint returns `{ messages, fragments, variables, errors }`; `system.md` rewritten with `{{ message }}` blocks.
- SSTI whitelist hardened to reject any identifier starting with `__`, blocking side-channel access to internal render state.
- Streaming cancellation made reason-agnostic so mid-stream provider errors surface to the client correctly.
- `X-OpenRouter-Title` header sends the plain ASCII project name to render legibly in OpenRouter rankings.
- Refined scenario prompt structure for character lore and tightened plugin prompt wording for zh-TW conventions.

### Fixed

- Prompt-editor textarea and preview pane now scroll independently instead of sharing one viewport.
- Plugin sidebar no longer disappears after reload or edit-cancel.
- Settings "back to reading" button uses the destination-driven route instead of `router.back()`, avoiding navigation loops.
- `usePromptEditor-preview` test renamed unused init param to silence unused-parameter warnings.

## [0.3.0] - 2026-04-19

### Added

- Added chapter editing (`PUT /api/stories/:series/:name/chapters/:number`), rewind (`DELETE /api/stories/:series/:name/chapters/after/:number`), and branching (`POST /api/stories/:series/:name/branch`) with atomic writes, generation-time conflict protection (HTTP 409), usage pruning, and branch copy of chapter/lore data.
- Added story export in Markdown/JSON/plain text via `GET /api/stories/:series/:name/export`, with merged plugin strip-tag processing so exports match reader-visible content.
- Added per-story token usage tracking to `_usage.json`, `GET /api/stories/:series/:name/usage`, and WebSocket `chat:done` payloads; added frontend `UsagePanel` summary and recent records table.
- Added per-story LLM override settings via `_config.json`, new `GET/PUT /api/:series/:name/config`, and a dedicated `/settings/llm` page with per-field override toggles.
- Added plugin runtime capabilities: activated backend `response-stream` hook dispatch, expanded frontend hooks (`chat:send:before`, `chapter:render:after`, `story:switch`, `chapter:change`), and enriched `DynamicVariableContext` with runtime message/chapter fields.
- Added state plugin chapter-delivery support across HTTP/WebSocket chapter payloads, including `stateDiff` propagation, resend/edit/rewind state artifact cleanup, and branch-copy support for state files.
- Added Codecov coverage workflow and Deno coverage tasks (`test:backend:coverage`, `coverage:summary`, `coverage:lcov`) for CI reporting.
- Added README badges for CI status, coverage, release, and license.

### Changed

- Renamed `.yml` files and references to `.yaml` across workflows, docs, tests, and related config paths.

### Fixed

- Fixed release note Podman pull command owner interpolation so generated pull instructions resolve to the correct image path.

## [0.2.0] - 2026-04-18

### Added

- Plugin CSS injection: new `frontendStyles` manifest field for declaring plugin CSS files, injected as `<link>` elements before JS modules load
- Toast notification system: `useNotification` composable with 3 channels (in-app/system/auto), position-grouped rendering, and auto-dismiss timers
- Response-notify built-in plugin: notifies on LLM completion (auto channel when tab hidden, in-app when visible)
- Chat input persistence: textarea content saved via sessionStorage per story, restored on component init
- Structured audit logging: JSON logging with log rotation, correlation IDs, configurable levels via `LOG_LEVEL` and `LOG_FILE` environment variables; replaces all raw console output
- Plugin logging API: structured `PluginRegisterContext` with scoped logger and automatic plugin attribution for backend hooks
- LLM request/response file logging: dedicated JSONL log capturing full request payloads and responses, controlled by `LLM_LOG_FILE` environment variable (default: `playground/_logs/llm.jsonl`)
- Batch chapter loading endpoint: `GET /chapters?include=content` returns all chapter contents in a single response, eliminating N+1 HTTP requests during story loading
- Podman deployment script (`scripts/podman.sh`): builds base and plugins images, replaces existing container, and starts the app with environment variables

### Changed

- Rate limits relaxed: global 60→300, auth 10→30, chat 10→30, preview-prompt 10→60 requests per minute (previous limits were too restrictive for single-user HTTP fallback polling)
- Frontend now uses the batch endpoint for initial story loading (1 request instead of N+1)
- `serve.sh` moved to `scripts/` directory with updated path resolution
- External plugin specs moved to HeartReverie_Plugins repository
- Agent skills directory moved from `skills/` to `.agents/skills/`
- `PLUGIN_DIR` environment variable exported in `serve.sh` for external plugin loading
- Major dependency upgrades: marked 15→18, TypeScript 5→6, Vite 6→8, Tailwind CSS 3→4 (CSS-first config), vue-tsc 2→3, vitest 3→4, @vitejs/plugin-vue 5→6

### Fixed

- Batch chapter loading: rebuilt `reader-dist/` to match source code — stale build was serving old N+1 fetch loop instead of the batch endpoint

## [0.1.0] - 2026-04-16

Initial public release of **HeartReverie 浮心夜夢** — an AI-driven interactive fiction engine built around file-based workflows and a plugin system.

### Added

- AI-driven interactive fiction engine: Hono backend (Deno/TypeScript) streaming LLM responses to Markdown chapter files via any OpenAI-compatible API
- Vue 3 + TypeScript SPA frontend with Vue Router, Tailwind CSS, and a dark-red reading theme
- Plugin system with five extension points: prompt injection (`promptFragments`), prompt tag stripping (`promptStripTags`), display tag stripping (`displayStripTags`), backend lifecycle hooks (`backendModule`), and frontend rendering modules (`frontendModule`)
- Lore Codex system: three-scope (global/series/story) file-based world-building knowledge base with YAML frontmatter tags and automatic Vento template variable injection
- WebSocket streaming for real-time LLM chat and chapter content updates; HTTP fallback when WebSocket is unavailable
- Stop-generation (abort) support: cancels an in-flight LLM request and preserves partial chapter content
- Built-in plugins: `context-compaction` (tiered chapter context assembly), `thinking` (collapsible `<thinking>/<think>` blocks), `user-message` (user message lifecycle), `start-hints` (first-round guidance), `imgthink` (strip imgthink display tags)
- `heartreverie-create-plugin` Copilot agent skill for guided plugin scaffolding
- Passphrase authentication gate for all API endpoints (timing-safe comparison)
- Rate limiting: 60 req/min global, 10 req/min for auth/chat/preview endpoints
- Server-side prompt file persistence with Vento template preview
- Configurable LLM sampling parameters via `LLM_*` environment variables (temperature, top-k, top-p, repetition penalty, etc.)
- Configurable background image via `BACKGROUND_IMAGE` environment variable
- Settings page with sidebar navigation for prompt editing and lore codex management
- Lore Codex CRUD UI and API routes under `/api/lore/`
- Series and story selection UI with server-side listing
- `HTTP_ONLY=true` mode for reverse-proxy and Kubernetes deployments
- Auto-generated self-signed TLS certificates on first run
- Regex pattern support in plugin `stripTags` manifest fields
- Containerfile with Deno-only multi-stage build; published to GHCR at `ghcr.io/jim60105/heartreverie:latest`
- GitHub Actions CI, multi-arch container publish (GHCR/DockerHub/Quay.io), and release workflows

### Changed

- Frontend completely rewritten as a Vue 3 + TypeScript SPA (replaced vanilla JS)
- Backend migrated to TypeScript with the Hono framework
- Project restructured into `writer/` (backend), `reader-src/` (frontend source), `reader-dist/` (built output), `plugins/`, and `tests/`
- `serve.zsh` replaced by portable Bash `serve.sh`; startup unified into `entrypoint.sh`
- Frontend build tooling migrated from npm/Node.js to Deno-native (`deno.json` imports)
- Environment variables renamed from `OPENROUTER_*` to `LLM_*` for provider-agnostic configuration
- Container default UID changed to 1000 with explicit POSIX file permissions for OpenShift compatibility
- Lore Codex storage restructured to co-located `_lore/` directories (global, series-level, story-level)
- Plugin `frontend-strip` hook replaced by declarative `displayStripTags` manifest field
- Startup scripts unified: `entrypoint.sh` handles TLS cert generation, dev and production launch

### Fixed

- Path traversal prevention: `safePath()`, `isPathContained()`, and `isValidParam()` enforce directory boundaries across all routes
- Dual-stack IPv4+IPv6 listening enabled by default
- TLS certificate generation added to container final stage via OpenSSL
- Various frontend rendering issues: sidebar clearing on story switch, prompt editor persistence, favicon restoration, DOMPurify ordering

---

[Unreleased]: https://github.com/jim60105/HeartReverie/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/jim60105/HeartReverie/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/jim60105/HeartReverie/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/jim60105/HeartReverie/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jim60105/HeartReverie/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jim60105/HeartReverie/releases/tag/v0.1.0

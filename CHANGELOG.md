# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
- Auto-generated self-signed TLS certificates on first run (HTTPS required for File System Access API)
- File System Access API support for reading local `.md` story files; IndexedDB persistence for directory handles across sessions
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

[Unreleased]: https://github.com/jim60105/HeartReverie/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jim60105/HeartReverie/releases/tag/v0.1.0

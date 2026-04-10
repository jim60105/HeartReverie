## Why

The writer backend (`writer/server.js`) has grown to over 1,000 lines as a monolithic file with no test coverage. The chat handler alone spans ~193 lines mixing validation, prompt building, API calls, streaming, and file I/O. There is no automated way to verify that changes don't break existing functionality. The project also targets a migration from Node.js + Express to Deno for improved security (permission-based), built-in TypeScript support, native TLS serving, and simpler deployment without `node_modules`.

This change establishes a test framework, writes comprehensive tests, refactors the codebase following SOLID/SRP/DRY principles, and migrates to Deno — in that order, so each phase builds confidence for the next.

## What Changes

- Set up a test framework for both `writer/` (backend, server-side) and `reader/` (frontend, browser-side pure logic)
- Write unit and integration tests covering all backend functions, route handlers, plugin system, and testable frontend modules
- Refactor `writer/server.js` from a 1,031-line monolith into smaller, focused modules following SRP: extract route handlers, middleware, utility functions, prompt pipeline, and configuration
- Remove dead code (`execFile`/`promisify` imports, `APPLY_PATCHES_BIN` constant)
- Extract duplicated RFC 9457 Problem Details error response pattern into a shared helper
- **BREAKING**: Migrate from Node.js + Express 5 to Deno + Hono framework
- **BREAKING**: Replace `node_modules` / `package.json` with Deno imports (`deno.json` + `jsr:`/`npm:` specifiers)
- Update `serve.zsh` to invoke `deno` instead of `node` with appropriate permission flags
- Migrate test runner from Node.js test framework to Deno's built-in test runner (`deno test`)

## Capabilities

### New Capabilities
- `test-infrastructure`: Test framework setup, configuration, and conventions for both backend and frontend projects
- `backend-tests`: Unit and integration tests for writer backend (routes, middleware, plugin system, prompt pipeline, utilities)
- `frontend-tests`: Unit tests for reader frontend pure-logic modules (parsers, renderers, utilities, hook dispatcher)
- `backend-refactor`: Modular restructuring of writer/server.js into focused modules following SOLID principles
- `deno-migration`: Migration from Node.js + Express to Deno + Hono, including runtime APIs, dependency management, and server bootstrap

### Modified Capabilities
- `unified-server`: Server entry point changes from Node.js/Express to Deno/Hono, route registration changes, middleware changes
- `plugin-core`: PluginManager and HookDispatcher migrate from Node.js fs/path APIs to Deno equivalents
- `security-headers`: Migrate from helmet middleware to Hono secureHeaders
- `writer-backend`: All backend API routes refactored into separate modules and migrated to Hono handler signatures

## Impact

- **writer/server.js**: Decomposed into multiple modules under `writer/lib/` or `writer/routes/`; rewritten for Hono framework
- **writer/lib/plugin-manager.js**: Node.js `fs`/`path` imports replaced with Deno equivalents
- **writer/lib/hooks.js**: No changes needed (pure JS, already Deno-compatible)
- **writer/package.json + node_modules/**: Removed, replaced by `deno.json` with import map
- **serve.zsh**: Updated to invoke `deno` with permission flags instead of `node`
- **Dependencies**: Express → Hono, helmet → hono/secure-headers, express-rate-limit → hono rate limiter, ventojs via `npm:ventojs`
- **reader/**: No production code changes (pure browser JS); test files added alongside modules
- **New files**: Test files for backend and frontend, `deno.json` configuration

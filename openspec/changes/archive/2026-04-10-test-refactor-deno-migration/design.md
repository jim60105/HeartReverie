## Context

The writer backend is a 1,031-line Express 5 monolith (`writer/server.js`) running on Node.js ≥20.12 with no test coverage. The reader frontend consists of 15 vanilla ES modules totaling ~1,620 lines, several of which contain pure functions suitable for unit testing. The project uses a plugin system with manifest-driven discovery and lifecycle hooks.

The four phases of this change are sequential and interdependent: tests must exist before refactoring (to catch regressions), refactoring must complete before migration (to reduce migration complexity), and migration converts the cleaned-up codebase to Deno + Hono.

## Goals / Non-Goals

**Goals:**
- Establish a test infrastructure that works for both backend (server-side) and frontend (browser-pure-logic) code
- Achieve meaningful test coverage for all backend utilities, middleware, route handlers, plugin system, and testable frontend modules
- Decompose `server.js` into focused modules following SRP, extracting routes, middleware, utilities, and prompt pipeline
- Migrate the backend from Node.js + Express 5 to Deno + Hono with no functional regressions
- Maintain all existing API endpoints, request/response contracts, and plugin system behavior

**Non-Goals:**
- Rewriting the reader frontend (it's pure browser JS, no migration needed)
- Adding TypeScript (Deno supports it natively, but converting existing JS is out of scope)
- Changing the plugin manifest schema or hook API contracts
- Changing the Rust `apply-patches` CLI
- Adding CI/CD pipelines (can be a follow-up change)
- Achieving 100% code coverage — focus on meaningful tests for critical paths

## Decisions

### D1: Test Framework — Deno's Built-in Test Runner

**Decision**: Use Node.js built-in test runner (`node:test`) for Phase 1 (testing + refactoring), then migrate tests to Deno's built-in test runner (`deno test`) in Phase 4 (migration).

**Rationale**: Node.js ≥20 includes a built-in test runner with `describe`/`it`/`assert` that requires no dependencies. This avoids adding npm test dependencies (Jest, Vitest) that would immediately be discarded during Deno migration. The Node.js test runner API is close enough to Deno's (`Deno.test()` + `@std/assert`) that migration is mechanical.

**Alternative considered**: Install Vitest and migrate to Deno later — rejected because it adds unnecessary npm dependencies and Vitest's Deno support is unofficial.

### D2: Frontend Test Strategy — Test Pure Logic Only

**Decision**: Only unit-test frontend modules that export pure functions (no DOM dependency). DOM-coupled modules are excluded from automated testing.

**Rationale**: Six modules are fully or mostly pure: `utils.js`, `status-bar.js`, `variable-display.js`, `vento-error-display.js`, `options-panel.js` (parsers), `plugin-hooks.js`. These can be tested with standard assertions. DOM-heavy modules (`chapter-nav.js`, `chat-input.js`, `prompt-editor.js`) would require jsdom or a browser harness — excessive setup for the current project scale.

**Alternative considered**: Use jsdom or Puppeteer for DOM tests — rejected due to complexity and fragility for a project with no existing test culture.

### D3: Backend Refactoring — Module Extraction Pattern

**Decision**: Extract `server.js` into the following module structure:

```
writer/
├── server.js              ← Slim entry point: create app, start server
├── app.js                 ← Express/Hono app factory: middleware + route registration
├── lib/
│   ├── hooks.js           ← (unchanged) HookDispatcher
│   ├── plugin-manager.js  ← (updated for Deno APIs)
│   ├── config.js          ← Environment variables, constants, directory paths
│   ├── errors.js          ← RFC 9457 problemJson() helper, buildVentoError, Levenshtein
│   ├── template.js        ← validateTemplate(), renderSystemPrompt(), Vento engine setup
│   ├── story.js           ← buildPromptFromStory(), loadStatus(), stripPromptTags(), chapter I/O
│   └── middleware.js       ← verifyPassphrase(), validateParams(), safePath()
├── routes/
│   ├── auth.js            ← GET /api/auth/verify
│   ├── stories.js         ← GET /api/stories, GET /api/stories/:series
│   ├── chapters.js        ← GET/DELETE chapters endpoints
│   ├── chat.js            ← POST /api/stories/:series/:name/chat (the big one)
│   ├── plugins.js         ← GET /api/plugins, GET /api/plugins/parameters, plugin static serving
│   └── prompt.js          ← POST preview-prompt, GET template
```

**Rationale**: Each module has a single responsibility. Route files group related endpoints. Utility modules (`errors.js`, `template.js`, `story.js`) contain pure or near-pure functions that are independently testable. The chat handler remains large but is isolated in its own file.

**Alternative considered**: Keep routes inline and only extract utilities — rejected because route handlers contain significant logic that benefits from isolation and testability.

### D4: Web Framework — Hono

**Decision**: Migrate from Express 5 to Hono.

**Rationale**: Hono has first-class Deno support, a similar middleware/routing API to Express (easing migration), built-in `secureHeaders` middleware (replacing helmet), is the most popular Deno web framework, and supports SSE streaming natively. Express 5 itself is not yet stable.

**Alternative considered**: Oak (Deno-native, Koa-like) — rejected because Hono's API is closer to Express, reducing migration friction. Native `Deno.serve()` — rejected because it lacks middleware abstractions.

### D5: Rate Limiting in Deno — In-Memory Map-based

**Decision**: Implement a simple in-memory rate limiter middleware for Hono using a `Map<string, { count, resetTime }>` pattern, or use the `hono-rate-limiter` package if available on JSR/npm.

**Rationale**: The current rate limiting is simple (fixed window, per-IP). A Map-based implementation is ~30 lines, has no dependencies, and matches the existing behavior. This is a single-tenant application — no need for Redis-backed distributed rate limiting.

### D6: Dependency Management — deno.json Import Map

**Decision**: Use `deno.json` with an import map for all dependencies. Vento is available as `npm:ventojs`. Hono is available as `jsr:@hono/hono`.

**Rationale**: Deno's import map centralizes version management. `npm:` specifiers provide seamless npm compatibility. No `node_modules` directory needed.

### D7: Test File Organization

**Decision**: Place test files alongside their source files with `_test.ts` or `_test.js` suffix (Deno convention). During the Node.js phase, use `.test.js` suffix (Node convention), then rename during migration.

```
writer/lib/errors.test.js         → writer/lib/errors_test.js
reader/js/utils.test.js           → reader/js/utils_test.js
```

**Rationale**: Co-located tests are easier to discover and maintain. The suffix change from `.test.js` to `_test.js` during migration aligns with Deno conventions.

### D8: Phased Execution Order

**Decision**: Execute in strict order — each phase must complete with all tests passing before the next begins:

1. **Phase 1: Test Infrastructure** — Set up test runner, write initial smoke test
2. **Phase 2: Write Tests** — Comprehensive tests for all modules, organized by the post-refactor module structure
3. **Phase 3: Refactor** — Extract modules from server.js, ensure all tests pass
4. **Phase 4: Deno Migration** — Convert to Deno + Hono, migrate tests, update serve.zsh

**Rationale**: Tests before refactoring catches regressions. Refactoring before migration reduces the surface area of the migration change. Each phase has a clear "done" criteria: all tests pass.

## Risks / Trade-offs

- **[ventojs Deno compatibility]** ventojs is an npm package not published on JSR. Using `npm:ventojs` in Deno should work but is untested. → Mitigation: Verify during migration; if incompatible, vendor the package or find an alternative template engine.
- **[Hono API differences]** Hono's request/response API differs from Express (e.g., `c.req.param()` vs `req.params`, `c.json()` vs `res.json()`). SSE streaming patterns also differ. → Mitigation: Map Express patterns to Hono equivalents methodically; Hono documentation covers SSE helpers.
- **[Test brittleness]** Integration tests that mock `fetch` to OpenRouter may be fragile. → Mitigation: Focus on unit tests for business logic; integration tests should test route handler wiring with mocked dependencies, not real API calls.
- **[Large chat handler]** The chat endpoint (~193 lines) is the hardest function to test and refactor due to its SSE streaming, file I/O, and API call mixing. → Mitigation: Extract the OpenRouter API call, SSE formatting, and file writing into separate testable functions before attempting integration tests.
- **[serve.zsh breaking change]** Switching from `node` to `deno` in serve.zsh means existing deployments need Deno installed. → Mitigation: Document the change clearly; Deno installation is a single command.

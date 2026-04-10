## 1. Test Infrastructure Setup

- [ ] 1.1 Configure Node.js built-in test runner: verify `node --test` works for `writer/` and `reader/js/` directories, add test script to `writer/package.json`
- [ ] 1.2 Create initial smoke test file `writer/lib/smoke.test.js` using `node:test` and `node:assert` to validate the test runner works

## 2. Backend Utility Tests

- [ ] 2.1 Create `writer/lib/validation.test.js`: tests for `isValidParam()` (valid strings, path traversal, null bytes, empty string) and `safePath()` (valid paths, traversal rejection, null return)
- [ ] 2.2 Create `writer/lib/template.test.js`: tests for `validateTemplate()` — safe expressions accepted (variables, for-of, if/else, pipes, includes, comments), unsafe expressions rejected (function calls, property access, process.env), edge cases (empty template, oversized template)
- [ ] 2.3 Create `writer/lib/string-utils.test.js`: tests for `levenshtein()` (identical strings, single edit, empty strings) and `findClosestMatch()` (exact match, close match, no candidates)
- [ ] 2.4 Create `writer/lib/errors.test.js`: tests for RFC 9457 `problemJson()` helper and `buildVentoError()` output format (line info, suggestion, fallback when no match)

## 3. Plugin System Tests

- [ ] 3.1 Create `writer/lib/hooks.test.js`: tests for `HookDispatcher` — register valid/invalid stages, priority ordering, error isolation (one handler throws, others still run), dispatch returns mutated context
- [ ] 3.2 Create `writer/lib/plugin-manager.test.js`: tests for `isValidPluginName()`, `isPathContained()`, `escapeRegex()`, `getStripTagPatterns()` (plain tags, regex patterns, mixed, empty regex guard, invalid regex skip), manifest validation (name must match dir, required fields)

## 4. Backend Middleware & Route Tests

- [ ] 4.1 Create `writer/lib/middleware.test.js`: tests for `verifyPassphrase` middleware (correct passphrase → next(), wrong → 401, missing → 401, timing-safe comparison)
- [ ] 4.2 Create `writer/routes/auth.test.js`: integration test for `GET /api/auth/verify` with mocked app
- [ ] 4.3 Create `writer/routes/stories.test.js`: integration tests for `GET /api/stories` and `GET /api/stories/:series` with mocked file system
- [ ] 4.4 Create `writer/routes/chapters.test.js`: integration tests for chapter list, read, delete endpoints with mocked file system
- [ ] 4.5 Create `writer/routes/chat.test.js`: tests for chat endpoint validation (empty message → 400, missing series → 404), prompt building (mock LLM call)
- [ ] 4.6 Create `writer/routes/plugins.test.js`: integration tests for `GET /api/plugins`, `GET /api/plugins/parameters`, plugin static serving

## 5. Frontend Pure Logic Tests

- [ ] 5.1 Create `reader/js/utils.test.js`: tests for `escapeHtml()` (special chars, empty string, no-op for safe strings)
- [ ] 5.2 Create `reader/js/status-bar.test.js`: tests for `extractStatusBlocks()` (extraction, placeholder, no blocks), `parseStatus()` (structured data), `renderStatusPanel()` (HTML output)
- [ ] 5.3 Create `reader/js/options-panel.test.js`: tests for `extractOptionsBlocks()` and `parseOptions()` (multiple options, edge cases)
- [ ] 5.4 Create `reader/js/variable-display.test.js`: tests for `extractVariableBlocks()` and `renderVariableBlock()` (extraction, rendering)
- [ ] 5.5 Create `reader/js/vento-error-display.test.js`: tests for `renderVentoError()` (error card HTML output)
- [ ] 5.6 Create `reader/js/plugin-hooks.test.js`: tests for `FrontendHookDispatcher` (register, priority order, context mutation, unknown stage)
- [ ] 5.7 Create `reader/js/md-renderer.test.js`: tests for `reinjectPlaceholders()` (placeholder replacement, missing keys)

## 6. Verify All Tests Pass

- [ ] 6.1 Run full test suite with `node --test` and verify all tests pass with zero failures

## 7. Backend Refactoring — Extract Modules

- [ ] 7.1 Extract `writer/lib/config.js`: move all environment variable reads, directory constants (`ROOT_DIR`, `PLAYGROUND_DIR`, `READER_DIR`, `PLUGINS_DIR`), and server config (`PORT`, `CERT_FILE`, `KEY_FILE`, `OPENROUTER_API_URL`, `OPENROUTER_MODEL`) into a centralized config module
- [ ] 7.2 Extract `writer/lib/errors.js`: move `problemJson()` helper (new), `buildVentoError()`, `findClosestMatch()`, `levenshtein()` into errors module
- [ ] 7.3 Extract `writer/lib/template.js`: move `validateTemplate()`, `renderSystemPrompt()`, Vento engine setup into template module
- [ ] 7.4 Extract `writer/lib/story.js`: move `buildPromptFromStory()`, `loadStatus()`, `stripPromptTags()`, chapter file I/O helpers into story module
- [ ] 7.5 Extract `writer/lib/middleware.js`: move `verifyPassphrase()`, `validateParams()`, `safePath()`, `isValidParam()` into middleware module

## 8. Backend Refactoring — Extract Routes

- [ ] 8.1 Extract `writer/routes/auth.js`: `GET /api/auth/verify` handler
- [ ] 8.2 Extract `writer/routes/stories.js`: `GET /api/stories` and `GET /api/stories/:series` handlers
- [ ] 8.3 Extract `writer/routes/chapters.js`: chapter list, read, delete, init handlers
- [ ] 8.4 Extract `writer/routes/chat.js`: `POST /api/stories/:series/:name/chat` handler (the large one)
- [ ] 8.5 Extract `writer/routes/plugins.js`: `GET /api/plugins`, `GET /api/plugins/parameters`, `GET /api/template`, plugin static file serving
- [ ] 8.6 Extract `writer/routes/prompt.js`: `POST /api/stories/:series/:name/preview-prompt` handler

## 9. Backend Refactoring — App Factory & Cleanup

- [ ] 9.1 Create `writer/app.js`: app factory function `createApp(deps)` that accepts config, pluginManager, hookDispatcher and returns the configured Express app with all middleware and routes
- [ ] 9.2 Slim down `writer/server.js` to entry point only: load config, initialize plugins, create app via factory, start HTTPS server
- [ ] 9.3 Remove dead code: `execFile`/`promisify` imports, `execFileAsync`, `APPLY_PATCHES_BIN` constant
- [ ] 9.4 Update all test files to use the app factory with injected mock dependencies

## 10. Verify Refactoring

- [ ] 10.1 Run full test suite and verify all tests still pass
- [ ] 10.2 Start the server manually and verify all endpoints work via browser or curl

## 11. Deno Migration — Configuration

- [ ] 11.1 Create `deno.json` with import map: `jsr:@hono/hono`, `npm:ventojs`, `jsr:@std/path`, `jsr:@std/assert`, `jsr:@std/crypto`
- [ ] 11.2 Remove `writer/package.json` and `writer/node_modules/`
- [ ] 11.3 Update all imports from `node:fs`, `node:fs/promises`, `node:path`, `node:crypto` to Deno equivalents (`Deno.*` APIs, `@std/path`, `@std/crypto`)

## 12. Deno Migration — Framework (Express → Hono)

- [ ] 12.1 Rewrite `writer/app.js`: replace Express app creation with Hono, replace `helmet()` with `secureHeaders()`, replace `express-rate-limit` with Hono-compatible rate limiter, replace `express.json()` with Hono's built-in JSON parsing, replace `express.static()` with Hono's `serveStatic()`
- [ ] 12.2 Update all route files: convert Express `(req, res, next)` handlers to Hono `(c)` context-based handlers, replace `req.params` with `c.req.param()`, `req.body` with `await c.req.json()`, `res.json()` with `c.json()`, `res.status().json()` with `c.json({}, status)`
- [ ] 12.3 Update middleware: convert `verifyPassphrase`, `validateParams` from Express middleware to Hono middleware pattern
- [ ] 12.4 Update chat handler SSE streaming: convert from Express `res.write()`/`res.end()` pattern to Hono's `streamSSE()` helper

## 13. Deno Migration — Runtime APIs

- [ ] 13.1 Replace all `fs.readFile()`/`fs.readdir()`/`fs.writeFile()`/`fs.unlink()`/`fs.mkdir()`/`fs.access()` with Deno equivalents (`Deno.readTextFile`, `Deno.readDir`, `Deno.writeTextFile`, `Deno.remove`, `Deno.mkdir`, `Deno.stat`)
- [ ] 13.2 Replace `fs.open()` file handle streaming in chat handler with `Deno.open()` + `writer.write()`
- [ ] 13.3 Replace `process.loadEnvFile()` with Deno equivalent, `process.env` with `Deno.env.get()`, `process.exit()` with `Deno.exit()`
- [ ] 13.4 Replace `crypto.timingSafeEqual()` and `Buffer` usage with `@std/crypto/timing-safe-equal` and `TextEncoder`
- [ ] 13.5 Replace `https.createServer()` with `Deno.serve()` using cert/key options for native TLS
- [ ] 13.6 Update `writer/lib/plugin-manager.js`: replace `node:fs/promises` and `node:path` with Deno APIs and `@std/path`

## 14. Deno Migration — Tests

- [ ] 14.1 Rename all `.test.js` files to `_test.js` (Deno convention)
- [ ] 14.2 Replace `node:test` imports (`describe`, `it`, `before`, `after`) with `Deno.test()` and `@std/assert` (`assertEquals`, `assertThrows`, `assertRejects`)
- [ ] 14.3 Run `deno test --allow-read --allow-write --allow-env --allow-net` and verify all tests pass

## 15. Deno Migration — Startup & Finalization

- [ ] 15.1 Update `serve.zsh`: change dependency check from `node` to `deno`, change exec command from `node writer/server.js` to `deno run --allow-net --allow-read --allow-write --allow-env writer/server.js`
- [ ] 15.2 Update `AGENTS.md` to reflect Deno runtime, Hono framework, `deno.json` dependency management, and new module structure
- [ ] 15.3 Update `docs/plugin-system.md` to reflect Deno API changes in plugin manager
- [ ] 15.4 Start server with `./serve.zsh` and verify all functionality works end-to-end

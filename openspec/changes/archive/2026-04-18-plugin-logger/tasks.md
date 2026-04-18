## 1. Logger Extension

- [x] 1.1 Extend `LoggerContext` interface in `writer/lib/logger.ts` to add optional `baseData: Record<string, unknown>` field
- [x] 1.2 Update `createLoggerWithContext()` to accept and store `baseData`, merging it into every emitted log entry's `data` field (call-site data takes precedence on key collision)
- [x] 1.3 Update `withContext()` to merge new `baseData` with existing `baseData` (cumulative), and preserve existing `correlationId` if new context doesn't override it
- [x] 1.4 Add unit tests for `baseData` in `tests/writer/lib/logger_test.ts`: baseData merging, call-site precedence, chained withContext accumulation

## 2. Type Definition

- [x] 2.1 Add `PluginRegisterContext` interface to `writer/types.ts` with properties `hooks: HookDispatcher` and `logger: Logger` (import Logger type from logger module)

## 3. Plugin Manager Update

- [x] 3.1 In `writer/lib/plugin-manager.ts` `#loadBackendModule()`, create a plugin-scoped logger via `createLogger("plugin").withContext({ baseData: { plugin: name } })` and pass `{ hooks: this.#hookDispatcher, logger }` context object to the plugin's `register()` function

## 4. Hook Dispatch Logger Injection

- [x] 4.1 Update `HookDispatcher` to store plugin-to-logger mappings (registered by plugin manager after loading each backend module)
- [x] 4.2 In `HookDispatcher.dispatch()`, before calling each handler, inject `context.logger` — a request-scoped logger derived from the plugin's register-time logger with `correlationId` from the hook context (if present)
- [x] 4.3 Pass `correlationId` into hook dispatch context in `writer/lib/chat-shared.ts` so plugins can benefit from request correlation

## 5. Built-in Plugin Migration

- [x] 5.1 Update `plugins/context-compaction/handler.ts` `register()` signature to accept `PluginRegisterContext`, destructure `{ hooks, logger }`, register hooks via `hooks.register(...)`, and use `context.logger` inside hook handlers for comprehensive request-scoped logging (config loading, compaction decisions, chapter counts, summary lengths, skipped chapters, etc.)
- [x] 5.2 Update `plugins/user-message/handler.ts` `register()` signature to accept `PluginRegisterContext`, destructure `{ hooks, logger }`, register hooks via `hooks.register(...)`, and use `context.logger` inside hook handler for debug logging (message wrapping, content length)

## 6. External Plugin Migration

- [x] 6.1 Update `/var/home/jim60105/repos/HeartReverie_Plugins/state/handler.js` `register()` signature to accept context object `{ hooks, logger }`, replace all `console.warn` calls with structured `logger.warn`/`logger.error` calls, and add comprehensive logging: binary path resolution, execution start/success/failure with timing, exit codes, stderr output, getDynamicVariables file resolution (which file was read, fallback behavior, content length)

## 7. Tests

- [x] 7.1 Update `tests/plugins/context-compaction/` tests to pass a context object `{ hooks, logger }` instead of bare `HookDispatcher` to the `register()` function
- [x] 7.2 Update `tests/plugins/user-message/` tests to pass a context object `{ hooks, logger }` instead of bare `HookDispatcher` to the `register()` function
- [x] 7.3 Add test verifying hook dispatch injects `context.logger` with correlationId when present in hook context
- [x] 7.4 Run full test suite (`deno task test`) and confirm all tests pass

## 8. Documentation

- [x] 8.1 Add a "Plugin Logging" section to `docs/plugin-system.md` documenting: the logger API (`debug/info/warn/error/withContext`), usage examples in `register()` and hook handlers, best practices (use `context.logger` in handlers for correlation, use register-time logger for init logging, never use `console.log`), and note that logs appear in the audit log file with plugin name tagging

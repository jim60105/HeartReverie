## Why

Plugin developers currently have no structured logging facility. The built-in plugins and any external plugins resort to `console.log`/`console.error` for debugging, which bypasses the structured audit logging system entirely. Log messages from plugins are untagged, unformatted, have no category or correlation ID context, cannot be filtered by level, and do not appear in the log file.

Since the project now has a mature structured logging system (`writer/lib/logger.ts`), plugins should be able to participate in it. This will:
- Give plugin developers a clean API for logging at appropriate levels
- Route plugin logs through the same file/console pipeline with rotation and level filtering
- Automatically tag plugin log entries with the plugin name for easy filtering
- Provide correlation ID context when plugins execute within a request lifecycle
- Make plugin debugging significantly easier via structured, filterable output

## What Changes

1. **Expose a plugin-scoped logger factory** — The `register()` function signature for backend plugin modules will receive a context object (instead of just `HookDispatcher`) that includes a pre-configured logger scoped to the plugin's name.

2. **Update built-in plugins** — Migrate the two TypeScript backend plugins (`context-compaction`, `user-message`) to use the provided logger with comprehensive logging at every meaningful step.

3. **Update external plugins** — Migrate the external plugin at `HeartReverie_Plugins/state/handler.js` to use the provided logger, replacing its existing `console.warn` calls with structured log calls and adding comprehensive logging throughout (binary execution, dynamic variable resolution, file reads, etc.).

4. **Update plugin system documentation** — Revise `docs/plugin-system.md` to document the logger API, show usage examples, and guide plugin developers to use structured logging instead of `console.log`.

## Capabilities

### New Capabilities
- `plugin-logger-api`: Plugin logger factory API — provides backend plugin modules with a scoped structured logger via the register context object

### Modified Capabilities
- `plugin-hooks`: Update the plugin registration interface to pass a context object containing both the hook dispatcher and a scoped logger

## Impact

- `writer/lib/logger.ts` — Extend `LoggerContext` with `baseData` support; update `createLoggerWithContext()` to merge baseData into entries
- `writer/lib/plugin-manager.ts` — Change backend module loading to pass a context object `{ hooks, logger }` instead of just `HookDispatcher`
- `writer/lib/hooks.ts` — Inject request-scoped logger into hook context before dispatching to handlers
- `writer/types.ts` — Add `PluginRegisterContext` interface
- `writer/lib/chat-shared.ts` — Pass `correlationId` into hook dispatch context
- `plugins/context-compaction/handler.ts` — Update `register()` signature to accept context object, use provided logger with comprehensive debug/info logging
- `plugins/user-message/handler.ts` — Update `register()` signature to accept context object, use provided logger with debug logging
- `/var/home/jim60105/repos/HeartReverie_Plugins/state/handler.js` — Update `register()` signature to accept context object, replace `console.warn` calls with structured logger, add comprehensive logging for binary execution and dynamic variable resolution
- `docs/plugin-system.md` — Add "Plugin Logging" section with API reference and examples
- `tests/writer/lib/logger_test.ts` — Add baseData tests
- `tests/plugins/` — Update plugin tests to provide context object in register calls

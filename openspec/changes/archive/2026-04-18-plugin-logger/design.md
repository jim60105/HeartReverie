## Context

The project has a structured logging system (`writer/lib/logger.ts`) that provides category-scoped loggers with JSON file output, ANSI console output, log level filtering, rotation, and correlation ID support. All backend code uses this system.

Backend plugins currently receive only the `HookDispatcher` instance in their `register(hookDispatcher)` function. Plugins that need to log have no sanctioned way to do so — they would need to directly import `createLogger` from the core logger module, which couples them to internal paths and gives them no automatic scoping to their plugin name.

The two existing TypeScript backend plugins (`context-compaction` and `user-message`) currently do no explicit logging, but as the plugin ecosystem grows, developers will need structured logging for debugging complex hook logic.

The current `Logger.withContext()` method only supports binding a `correlationId`. It does not support arbitrary base data injection (e.g., plugin name). This limitation must be addressed.

## Goals / Non-Goals

**Goals:**
- Provide each backend plugin module with a pre-scoped logger (category: `plugin`, plugin name in base data) via the `register()` call
- Extend `Logger.withContext()` to support `baseData` — a record that gets merged into every log entry's `data` field
- Propagate correlation ID to plugin loggers during hook dispatch by passing a request-scoped logger in the hook context
- Maintain backward compatibility of the hook dispatcher interface within the context object
- Keep the API surface minimal — a logger instance with `debug/info/warn/error/withContext` methods
- Update built-in plugins to demonstrate correct usage
- Document the API for third-party plugin developers

**Non-Goals:**
- Frontend module logging (frontend runs in the browser; browser console is appropriate there)
- Custom log levels or plugin-specific log configuration
- Plugin-specific log files or separate rotation
- Narrowing the Logger interface for plugins (plugins get the full Logger type including `withContext`)

## Decisions

1. **Extend `withContext()` to support `baseData`** — The `LoggerContext` interface gains an optional `baseData: Record<string, unknown>` field. When set, these key-value pairs are merged into every log entry's `data` field (plugin-supplied `data` at call time takes precedence over `baseData` on key collision). This enables scoping a logger with `{ plugin: "name" }` without changing the category system.

2. **Context object pattern** — Change `register(hookDispatcher)` to `register(context)` where `context` is `{ hooks: HookDispatcher, logger: Logger }`. This is extensible for future additions without further signature changes. The `hooks` property replaces the bare `hookDispatcher` parameter.

3. **Two-tier logger scoping** — The plugin manager creates a register-time logger via `createLogger("plugin").withContext({ baseData: { plugin: name } })`. This logger has the plugin name baked in but no correlationId. During hook dispatch, if the hook context includes `correlationId`, a request-scoped logger (with both plugin name + correlationId) is injected into the hook context as `context.logger`. This gives plugins the best of both worlds: a static logger for startup logging and a request-scoped logger for within-handler logging.

4. **Hook context logger injection** — `HookDispatcher.dispatch()` will check for `correlationId` in the hook context. When present, it creates a derived logger per plugin via `pluginLogger.withContext({ correlationId })` and injects it as `context.logger` before calling each handler. When absent, it injects the plugin's register-time logger.

5. **Type export for plugin authors** — Add a `PluginRegisterContext` interface to `writer/types.ts` so plugin authors can type their `register` function parameter.

6. **Backward compatibility within this project** — Since there are 0 external users and only 2 built-in plugins, we will migrate both immediately. No compatibility shim needed.

7. **getDynamicVariables context** — The `getDynamicVariables(context: DynamicVariableContext)` interface already has its own context object. Adding a logger there is out of scope for this change but can be done later.

8. **Documentation update** — Add a "Plugin Logging" section to `docs/plugin-system.md` with API reference, usage examples, and best practices.

## Risks / Trade-offs

- **Risk**: Changing `register()` signature breaks any external plugins. Mitigated by: 0 external users, project not yet released.
- **Trade-off**: Extending `withContext()` adds a small amount of complexity to the logger module. This is necessary to satisfy the plugin name requirement without polluting the category system.
- **Trade-off**: Injecting logger into hook context means hook handlers have two loggers available (register-time and context-scoped). Documentation should clarify: use `context.logger` inside handlers for request correlation; use the register-time logger for init-time logging only.
- **Trade-off**: Not providing a logger to `getDynamicVariables()`. If future plugins need logging in that path, it can be added later.

## MODIFIED Requirements

### Requirement: Plugin registration interface (CHANGED)

The plugin backend module registration function SHALL accept a `PluginRegisterContext` object instead of a bare `HookDispatcher`. The context object SHALL contain `hooks` (a `PluginHooks` wrapper that auto-binds plugin name and baseLogger) and `logger` (a `Logger` instance scoped to the plugin name). The plugin manager SHALL construct this context object when loading each backend module.

#### Scenario: Backend module receives context object
- **WHEN** the plugin manager loads a backend module that exports a `register` function
- **THEN** it SHALL call `register(context)` where `context` is `{ hooks: PluginHooks, logger: Logger }` instead of calling `register(hookDispatcher)` directly

#### Scenario: Plugin accesses hook dispatcher from context
- **WHEN** a plugin's `register(context)` function needs to register hooks
- **THEN** it SHALL use `context.hooks.register(stage, handler, priority)` to register handlers (plugin name and baseLogger are auto-bound)

#### Scenario: Plugin accesses logger from context
- **WHEN** a plugin's `register(context)` function needs to log information
- **THEN** it SHALL use `context.logger.info(message, data)` (or debug/warn/error) to emit structured log entries

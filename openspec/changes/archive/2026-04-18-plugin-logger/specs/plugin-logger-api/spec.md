## ADDED Requirements

### Requirement: Logger baseData support

The `LoggerContext` interface SHALL support an optional `baseData` field of type `Record<string, unknown>`. When a logger is created via `withContext({ baseData: { ... } })`, every log entry produced by that logger SHALL merge the `baseData` into the entry's `data` field. Call-site `data` SHALL take precedence over `baseData` on key collision. The `baseData` SHALL be immutable and cumulative (chaining `withContext` calls merges baseData).

#### Scenario: Logger with baseData
- **WHEN** `const pluginLog = logger.withContext({ baseData: { plugin: "my-plugin" } })` is called and then `pluginLog.info("Hello", { key: "val" })`
- **THEN** the log entry's `data` field SHALL be `{ plugin: "my-plugin", key: "val" }`

#### Scenario: Call-site data takes precedence
- **WHEN** a logger has `baseData: { plugin: "my-plugin" }` and the call passes `{ plugin: "override" }`
- **THEN** the log entry's `data.plugin` SHALL be `"override"` (call-site wins)

#### Scenario: Chained withContext merges baseData
- **WHEN** `logger.withContext({ baseData: { plugin: "x" } }).withContext({ correlationId: "abc" })` is called
- **THEN** the resulting logger SHALL emit entries with both `plugin: "x"` in data and `correlationId: "abc"` in the correlationId field

### Requirement: Plugin register context interface

The system SHALL define a `PluginRegisterContext` interface in `writer/types.ts` containing: `hooks` (a `PluginHooks` interface with a `register(stage, handler, priority?)` method) and `logger` (Logger instance scoped to the plugin). The `PluginHooks` interface provides a subset of `HookDispatcher` that auto-binds the plugin name and baseLogger via a wrapper in the plugin manager. This interface SHALL be the sole parameter type for plugin backend module `register()` functions.

#### Scenario: Context object structure
- **WHEN** a plugin's `register(context)` function is called
- **THEN** the `context` parameter SHALL have a `hooks` property satisfying the `PluginHooks` interface and a `logger` property of type `Logger`

#### Scenario: Hooks auto-bind plugin name and logger
- **WHEN** a plugin calls `context.hooks.register(stage, handler, priority)` inside its `register()` function
- **THEN** the system SHALL automatically bind the plugin's name and baseLogger to the underlying `HookDispatcher.register()` call — the plugin author does NOT need to pass these manually

#### Scenario: Logger is pre-scoped to plugin name
- **WHEN** the plugin manager loads a plugin named `"my-plugin"` and creates its context
- **THEN** the `context.logger` instance SHALL produce log entries with `category: "plugin"` and `data` containing `{ plugin: "my-plugin" }`

### Requirement: Plugin logger methods

The logger instance provided to plugins SHALL expose the standard logging methods: `debug(message, data?)`, `info(message, data?)`, `warn(message, data?)`, `error(message, data?)`, and `withContext(ctx)`. Each method SHALL produce a structured log entry with category `"plugin"` and the plugin name in the data via baseData.

#### Scenario: Plugin logs at info level
- **WHEN** a plugin calls `context.logger.info("Compaction applied", { chapters: 5 })`
- **THEN** a structured log entry SHALL be emitted with `level: "info"`, `category: "plugin"`, and `data` containing `{ plugin: "my-plugin", chapters: 5 }`

#### Scenario: Plugin logs at debug level
- **WHEN** a plugin calls `context.logger.debug("Processing chapter", { index: 3 })` and `LOG_LEVEL` is `debug`
- **THEN** a structured log entry SHALL be emitted with `level: "debug"` and the combined data fields

#### Scenario: Plugin log respects configured level
- **WHEN** a plugin calls `context.logger.debug(...)` and `LOG_LEVEL` is `info`
- **THEN** the debug entry SHALL be suppressed (not emitted)

### Requirement: Hook dispatch logger injection

When `HookDispatcher.dispatch()` is called, it SHALL always inject a `logger` property into the hook context object before calling each handler. If the hook context contains a `correlationId` field, the injected logger SHALL be derived from the plugin's register-time logger with that correlationId bound. If no correlationId is present, the register-time logger (with plugin name only) SHALL be injected directly.

#### Scenario: Hook dispatched with correlationId in context
- **WHEN** a hook is dispatched with `context.correlationId = "req-abc"` for a plugin named `"my-plugin"`
- **THEN** the handler SHALL receive `context.logger` that produces entries with `correlationId: "req-abc"` and `data: { plugin: "my-plugin", ... }`

#### Scenario: Hook dispatched without correlationId
- **WHEN** a hook is dispatched without a `correlationId` field in context
- **THEN** the handler SHALL still receive `context.logger` — the register-time logger with `data: { plugin: "my-plugin" }` and no correlationId bound


## ADDED Requirements

### Requirement: Universal `enabled` setting for every built-in plugin

Every built-in plugin SHALL declare a top-level `enabled` boolean entry in its `settingsSchema`, with `default: true` and zh-TW `title` / `description`.

When the resolved `enabled` for a plugin is `false`, the engine SHALL:

- Omit every `promptFragments[].file` contribution from that plugin from the rendered system prompt (handled centrally in `PluginManager.getPromptVariables()`).
- Omit every dynamic-variable contribution from that plugin from the rendered system prompt (same gate inside `getDynamicVariables()`).
- Filter out the plugin's `actionButtons` from `GET /api/plugins/action-buttons`.

When the resolved `enabled` for a plugin is `false`, the plugin SHALL itself:

- Return early (no side effects) from every registered frontend hook callback at the top of the handler.
- No-op every registered `action-button:click` handler at click time (defence against a stale `/api/plugins/action-buttons` cache).

The plugin's `promptStripTags` and `displayStripTags` declarations are explicitly NOT gated by `enabled`. This is an intentional trade-off so historical content emitted while the plugin was active continues to render cleanly after the user disables the plugin.

#### Scenario: Disabled plugin suppresses prompt fragments

- **WHEN** an operator sets `PUT /api/plugins/start-hints/settings` body `{ "enabled": false }`
- **AND** a chapter is generated immediately afterwards
- **THEN** the assembled system prompt MUST NOT contain any text from `plugins/start-hints/start-hints.md`

#### Scenario: Disabled plugin's action button is hidden

- **WHEN** the operator sets `PUT /api/plugins/polish/settings` body `{ "enabled": false }`
- **AND** the reader fetches `GET /api/plugins/action-buttons`
- **THEN** the response MUST NOT include the polish-plugin's action button entry

#### Scenario: Strip-tag declarations remain active when disabled

- **WHEN** the operator sets `PUT /api/plugins/thinking/settings` body `{ "enabled": false }`
- **AND** a previously-saved chapter contains a `<think>...</think>` block
- **THEN** the chapter's rendered HTML MUST still have the `<think>` block stripped (per the plugin's `displayStripTags` declaration)

### Requirement: Settings page covers six new plugins

The reader's plugin-settings page SHALL render a settings card for each of the following plugins, driven by the new `settingsSchema` block in their `plugin.json`:

- `dialogue-colorize` — `enabled`, `dialogueColor`, `enabledQuoteStyles`.
- `polish` — `enabled`.
- `response-notify` — `enabled`, `notifyTitle`, `notifyBody`, `notifyWhenVisible`, `notifyLevel`.
- `start-hints` — `enabled`.
- `thinking` — `enabled`, `injectInstruction`, `defaultCollapsed`, `completeSummaryLabel`, `streamingSummaryLabel`.
- `user-message` — `enabled`.

Default values for every new entry SHALL reproduce today's behaviour exactly, so a user who never opens the settings page sees zero behavioural change.

#### Scenario: Default-only settings reproduce baseline behaviour

- **WHEN** a user installs the image and never visits the plugin-settings page
- **THEN** every plugin's runtime behaviour MUST be byte-identical to the pre-change behaviour for the same input

### Requirement: Per-plugin handler honours its own settings at runtime

Plugins whose runtime output depends on a non-`enabled` setting (e.g., `dialogue-colorize.dialogueColor`, `thinking.defaultCollapsed`, `response-notify.notifyWhenVisible`, `response-notify.notifyLevel`) SHALL read the resolved setting at each hook invocation via `context.getSettings()` so that user changes take effect without a page reload.

Plugins MUST NOT cache resolved settings across hook invocations beyond the lifetime of a single invocation.

#### Scenario: Settings update is observed by the next hook invocation

- **WHEN** the user changes `dialogue-colorize.dialogueColor` from `""` to `"#aa5500"` on the settings page
- **AND** the reader receives the `plugin-settings:changed` event
- **AND** the chapter renderer re-dispatches `frontend-render`
- **THEN** the next paint MUST use `#aa5500` for dialogue quote highlights

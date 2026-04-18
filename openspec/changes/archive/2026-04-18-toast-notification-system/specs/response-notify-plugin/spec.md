## ADDED Requirements

### Requirement: Response notify plugin manifest

The `response-notify` plugin SHALL have a `plugin.json` manifest with:
- `name`: `"response-notify"`
- `description`: A description indicating it sends browser notifications on LLM response completion
- `type`: `"frontend-only"`
- `frontendModule`: `"./frontend.js"`
- No `backendModule`, `promptFragments`, `promptStripTags`, or `displayStripTags`

#### Scenario: Plugin is discoverable
- **WHEN** the server scans the `plugins/` directory at startup
- **THEN** the `response-notify` plugin SHALL be loaded and listed in the plugin registry

#### Scenario: Plugin manifest is valid
- **WHEN** the plugin manager validates `response-notify/plugin.json`
- **THEN** validation SHALL pass with no errors

### Requirement: Response notify frontend behavior

The `response-notify` plugin frontend module SHALL:
1. Register a `notification` hook handler
2. Listen for the `chat:done` WebSocket event via the hook context
3. Always fire a notification on completion:
   - When `document.visibilityState` is `'hidden'`: emit with `channel: 'auto'` (system notification with in-app fallback)
   - When `document.visibilityState` is `'visible'`: emit with `channel: 'in-app'` (toast only)
4. Use `level: 'success'` and a title indicating generation is complete

#### Scenario: Notification fires when tab is hidden
- **WHEN** the LLM generation completes (`chat:done` event received) and `document.visibilityState` is `'hidden'`
- **THEN** the plugin SHALL trigger a notification with `channel: 'auto'` and `level: 'success'`

#### Scenario: Toast notification fires when tab is visible
- **WHEN** the LLM generation completes (`chat:done` event received) and `document.visibilityState` is `'visible'`
- **THEN** the plugin SHALL trigger a notification with `channel: 'in-app'` and `level: 'success'`

#### Scenario: Notification title content
- **WHEN** the plugin triggers a notification
- **THEN** the notification title SHALL contain text indicating the story generation is complete (e.g., "故事生成完成" or similar Traditional Chinese text)

### Requirement: Response notify graceful degradation

The plugin SHALL handle notification failures gracefully:
- If `context.notify` is not a function (hook context incomplete), the plugin SHALL silently do nothing
- If notification permission is denied and channel is `'auto'`, the composable handles fallback internally — the plugin does not need additional logic

#### Scenario: Hook context missing notify function
- **WHEN** the `notification` hook is dispatched but `context.notify` is undefined or not a function
- **THEN** the plugin SHALL not throw an error and SHALL silently skip notification

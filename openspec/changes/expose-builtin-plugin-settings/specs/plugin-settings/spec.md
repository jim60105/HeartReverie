## ADDED Requirements

### Requirement: Settings-aware prompt-fragment rendering

`PluginManager.getPromptVariables()` SHALL consult each plugin's resolved settings before including any `manifest.promptFragments[].file` contribution. When the resolved `settings.enabled === false`, every fragment entry for that plugin SHALL resolve to the empty string, including unnamed fragments contributed to `plugin_fragments`.

The same gate SHALL apply inside `PluginManager.getDynamicVariables()`: when the owning plugin's resolved `enabled` is `false`, the engine MUST NOT invoke that plugin's dynamic-variable provider, and any name that provider would have set MUST resolve to its template default (typically empty string).

#### Scenario: Disabled plugin contributes nothing to assembled prompt

- **WHEN** a plugin's resolved `enabled` is `false`
- **AND** the engine assembles a system prompt
- **THEN** none of the plugin's `promptFragments[]` files appear in the rendered output
- **AND** none of the plugin's `getDynamicVariables()` output appears in the rendered output

### Requirement: Frontend `register` context exposes resolved plugin settings

The frontend hook-dispatcher SHALL pass a register context whose shape is `{ register, on, getSettings }` (in addition to any pre-existing fields). `getSettings(name?)` SHALL return a deep-frozen snapshot of the most recently resolved settings for the plugin (or, when called with another plugin's name, that plugin's settings).

The returned snapshot SHALL be synchronous. The dispatcher SHALL update the underlying store on every `plugin-settings:changed` event so subsequent calls within new hook invocations see the latest values.

#### Scenario: Plugin reads its own settings during a frontend-render hook

- **WHEN** a plugin's frontend `register()` runs and calls `context.getSettings()`
- **THEN** the return value is the resolved settings object for that plugin
- **AND** the object is frozen (mutation throws in strict mode / has no effect otherwise)

### Requirement: `plugin-settings:changed` broadcast

A successful `PUT /api/plugins/:name/settings` SHALL cause the reader to emit a `plugin-settings:changed` event with payload `{ name, settings }` on its event bus.

The settings store SHALL refresh its cached entry for `name` from the event payload (no follow-up fetch) and bump the reactive revision counter. The chapter renderer SHALL debounce 50 ms and re-dispatch `frontend-render` and `display-strip-tags` for the currently-mounted chapter when the changed plugin contributes to either hook. The action-button strip SHALL re-fetch `/api/plugins/action-buttons`.

The broadcast SHALL NOT fire for non-2xx PUT responses.

#### Scenario: Settings save triggers re-render

- **WHEN** the user saves new settings on the plugin-settings page
- **AND** the PUT returns 2xx
- **THEN** the chapter view updates within 100 ms without a page reload

### Requirement: Settings-aware action-button visibility

`GET /api/plugins/action-buttons` SHALL filter out every button whose owning plugin's resolved `enabled` is `false`.

The frontend hook dispatcher SHALL additionally no-op every `action-button:click` invocation when the originating plugin's `context.getSettings().enabled` is `false`, as a stale-cache safety net.

#### Scenario: Disabled plugin's button is hidden

- **WHEN** a plugin's `enabled` is `false` and the reader requests action buttons
- **THEN** none of that plugin's buttons appear in the response

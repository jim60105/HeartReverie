## ADDED Requirements

### Requirement: Plugin promptFragments validate against SSTI whitelist at load time

During plugin discovery/initialization, the engine SHALL read each `promptFragments[].file` source and invoke `validateTemplate(fragmentSource)`. If the result is non-empty (any forbidden tokens detected), the plugin SHALL fail to load: the manager SHALL log an `error`-level message naming the plugin, the offending fragment file, and the offending expressions, and SHALL NOT register the plugin's hooks, settings, or fragments. Other plugins SHALL remain unaffected. Validation SHALL occur before any hook is registered so that a failed plugin leaves no observable side effects (no orphaned hooks, no settings entries, no introspection records).

#### Scenario: Plugin with unsafe fragment fails to load

- **GIVEN** a plugin manifest with `promptFragments[0].file` containing `{{> jsExpression }}`
- **WHEN** the plugin manager initializes
- **THEN** that plugin is not present in the active list
- **AND** an `error`-level log entry is emitted naming the plugin, file, and the unsafe fragment
- **AND** the plugin's hooks, settings, and fragment variables are NOT registered

#### Scenario: Sibling plugins remain active

- **GIVEN** plugin A has an unsafe fragment and plugin B is clean
- **WHEN** the plugin manager initializes
- **THEN** plugin B is loaded and functions normally
- **AND** plugin B's hooks register and dispatch as usual

### Requirement: Plugin promptFragments revalidate before each render

The engine SHALL invoke `validateTemplate(fragmentSource)` again immediately before composing each `promptFragments[]` source into the system prompt at render time. This catches the case where a fragment file on disk has been edited between plugin load and the current render (e.g. plugin author saving from their own editor, or a deployment hot-swap). If the validator detects forbidden tokens, the render SHALL skip that fragment, log a warning naming the plugin and file, and continue with remaining fragments.

#### Scenario: Fragment edited on disk after load is caught

- **GIVEN** a plugin loaded successfully with a clean fragment
- **AND** the fragment file is subsequently modified on disk to contain `{{ include "./x.md" }}`
- **WHEN** `renderSystemPrompt()` is invoked
- **THEN** the render skips that fragment
- **AND** a warning log entry names the plugin and the offending fragment
- **AND** the rest of the prompt renders without error

### Requirement: Plugin promptFragments are not writable from the template editor

The `PUT /api/templates` endpoint SHALL refuse any `templatePath` beginning with `plugin:` with status `403`. The plugin manifest contract SHALL state that plugin promptFragments are owned by the plugin author and MUST be edited in the plugin's source repository. The engine SHALL NOT provide any UI affordance for saving plugin-fragment overrides.

#### Scenario: PUT to plugin: path returns 403

- **WHEN** the caller posts `PUT /api/templates` with `templatePath: "plugin:any-plugin:any-file.md"`
- **THEN** the response status is `403`
- **AND** no plugin file is modified

#### Scenario: Template editor UI hides save button for plugin entries

- **WHEN** the user selects a plugin-fragment entry in the template editor's left pane
- **THEN** the entry shows a "唯讀" (read-only) badge
- **AND** the save button is not rendered for that entry

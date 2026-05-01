## ADDED Requirements

### Requirement: Plugin manifest action buttons field

Plugin manifests SHALL accept an optional `actionButtons` field at the top level of `plugin.json` / `plugin.yaml`. The value SHALL be an array of `ActionButtonDescriptor` objects, defaulting to `[]` when absent. Each descriptor SHALL have the required fields `id` (kebab-case identifier matching `^[a-z0-9-]+$`, unique within the plugin) and `label` (non-empty string of 1..40 characters after trim), and the optional fields `icon` (short emoji or symbol prefix), `tooltip` (string of up to 200 characters), `priority` (finite number, defaulting to 100, lower renders first), and `visibleWhen` (one of the literal strings `"last-chapter-backend"` or `"backend-only"`, defaulting to `"last-chapter-backend"`). Invalid descriptor entries SHALL be dropped individually with a logged warning while the rest of the plugin continues to load. Duplicate `id` values within a single plugin's `actionButtons` array SHALL keep the first occurrence and drop subsequent duplicates with a warning.

#### Scenario: Manifest declares actionButtons
- **WHEN** a plugin directory contains a `plugin.json` with `"actionButtons": [{ "id": "recompute-state", "label": "🧮 重算狀態" }]`
- **THEN** the loader SHALL parse the manifest, record the descriptor with defaults filled (`priority: 100`, `visibleWhen: "last-chapter-backend"`), and surface the descriptor on the plugin record so the `GET /api/plugins` payload includes it

#### Scenario: Manifest omits actionButtons
- **WHEN** a plugin directory contains a `plugin.json` without an `actionButtons` field
- **THEN** the loader SHALL default `actionButtons` to `[]` on the parsed plugin record and `GET /api/plugins` SHALL serialise `"actionButtons": []` for that plugin

#### Scenario: Invalid actionButtons entry is dropped per-entry
- **WHEN** a plugin's `actionButtons` array contains one valid entry and one entry whose `id` violates the kebab-case regex
- **THEN** the loader SHALL register the valid entry, drop the invalid one with a logged warning, and continue loading the rest of the plugin

#### Scenario: Duplicate id within actionButtons
- **WHEN** a plugin's `actionButtons` array declares two entries with the same `id`
- **THEN** the loader SHALL register only the first occurrence, drop subsequent duplicates, and log a warning

#### Scenario: Unknown visibleWhen value rejected
- **WHEN** an `actionButtons` entry sets `"visibleWhen": "always"` or any other value outside the v1 enum
- **THEN** the loader SHALL drop that entry with a warning and SHALL NOT default it silently to a different value

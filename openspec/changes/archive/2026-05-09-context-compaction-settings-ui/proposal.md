## Why

The `context-compaction` plugin already supports two configuration fields (`recentChapters` and `enabled`) but they are only editable by writing a YAML file (`compaction-config.yaml`) on disk at story- or series-level scope. There is no in-reader UI for changing these values, which means an end user must:

1. SSH / shell into the server, or otherwise gain filesystem access to `playground/{series}/{name}/`;
2. Create or edit a YAML file by hand;
3. Get the path and field names exactly right (no validation feedback).

Other full-stack plugins in the ecosystem (e.g., `sd-webui-image-gen`) declare a `settingsSchema` in their `plugin.json` so the engine auto-renders a settings page in the reader and exposes `GET/PUT /api/plugins/:name/settings` with JSON Schema validation. We want the same UX for `context-compaction` so the most important knob — "how many recent chapters stay as full text (the L2 window)" — is one click away in the reader.

## What Changes

- `plugins/context-compaction/plugin.json` SHALL declare a `settingsSchema` (JSON Schema draft-07) with two properties:
  - `recentChapters` (integer, minimum 1, default 3, title and description in zh-TW). NOTE: the engine's lightweight validator currently enforces `type` only, not `minimum`. The `minimum: 1` in the schema is a UI hint and a documentation contract; runtime safety SHALL be provided by the existing `mergeConfig()` coercion in `config.ts` (non-positive integers fall back to the default). This proposal does NOT extend the engine validator.
  - `enabled` (boolean, default `true`, title and description in zh-TW).
- `plugins/context-compaction/config.ts` SHALL be extended to read engine-managed plugin settings *directly from the documented persistence path* (`playground/_plugins/context-compaction/config.json`) on each `loadCompactionConfig()` call, and to slot those values into the precedence chain below YAML. NOTE: `getSettings()` is exposed only on `PluginRouteContext` (for `registerRoutes()`), not on `PluginRegisterContext` (used by hook `register()`). To avoid engine churn, the plugin reads the settings file itself; the path is fully specified by the engine's `plugin-settings` capability so this is not duplication of an unrelated concern.
- The precedence order SHALL become: **story-level YAML > series-level YAML > plugin settings (global) > built-in defaults**. YAML-vs-YAML semantics are PRESERVED unchanged: story YAML and series YAML are still mutually exclusive (story wins as a whole if present; otherwise series wins as a whole if present). Plugin settings sit *under* the chosen YAML (or under defaults if no YAML exists) and fill in fields the chosen YAML omits. Rationale: keeps existing YAML-only setups behaviourally identical (issue raised by the rubber-duck pass — see design.md D2).
- `plugins/context-compaction/handler.ts` SHALL pass the playground directory it already receives into `loadCompactionConfig()` so the function can read the plugin settings file. The hook SHALL continue to call `loadCompactionConfig()` per request — the plugin settings are read fresh per call so a UI edit takes effect on the next chat turn without restart.
- The plugin's `README.md` SHALL document:
  - The new `設定欄位` section showing the two UI fields and their behaviour.
  - The full precedence order (`story YAML > series YAML > 全域 plugin 設定 > 預設值`).
  - A note that `compaction-config.yaml` is still supported and still wins for power users / per-story overrides.
- No backend / Vue UI code in `reader-src/` is touched: the settings UI is auto-rendered by the existing `plugin-settings` capability when `settingsSchema` is present.
- No data migration is performed — the new UI starts at the schema defaults; any existing YAML continues to win.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `context-compaction`: extends "Compaction configuration" requirement to add a third precedence layer (engine-managed plugin settings) and adds a new requirement covering the `settingsSchema` declaration and its UI semantics.

## Impact

- Affected files (HeartReverie core):
  - `plugins/context-compaction/plugin.json` — add `settingsSchema` block.
  - `plugins/context-compaction/config.ts` — accept plugin settings, apply new precedence.
  - `plugins/context-compaction/handler.ts` — pass an `onWarn` callback into `loadCompactionConfig()` so settings-file errors surface in the plugin logger.
  - `plugins/context-compaction/README.md` — document the new UI and precedence.
  - `tests/writer/context-compaction-config.test.ts` (new or extended) — tests for precedence rules.
- No breaking changes for existing users with `compaction-config.yaml` files — those continue to win.
- 0 users in the wild → no migration concerns. The settings UI starts empty and falls through to defaults.

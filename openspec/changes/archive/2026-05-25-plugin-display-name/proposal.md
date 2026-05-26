## Why

Plugin entries in the reader's `/settings/*` sidebar navigation are currently labelled with each plugin's technical `name` field (the kebab-case directory identifier, e.g. `chapter-bookmark`, `sd-webui-image-gen`, `hook-inspector-logger`). This identifier doubles as a security guard (it must match the plugin directory name to prevent impersonation), as a URL slug (`/settings/plugins/:name`), and as a stable key for settings storage — so it cannot be a Chinese display string without breaking those invariants. At the same time, the rest of the reader UI is fully zh-TW, and forcing readers to recognise plugins by Latin-script slugs is a regression against the project's localisation baseline.

The `description` field is already zh-TW but is paragraph-shaped (one or more sentences). It is not a substitute for a short navigation label.

Adding a dedicated `displayName` field to the plugin manifest cleanly separates the technical identifier (`name`) from the human-facing label (`displayName`), lets the sidebar show readable Chinese labels while preserving every existing invariant tied to `name`, and is the smallest possible surface change that satisfies the requirement.

## What Changes

- Add a required `displayName: string` field to the `plugin.json` manifest schema. The field is a short zh-TW label intended for UI navigation (sidebar, drawers, future plugin pickers). It is distinct from `name` (slug/identifier) and `description` (paragraph blurb).
- The manifest loader SHALL reject plugins whose manifest omits `displayName`, contains a non-string `displayName`, or contains an empty/whitespace-only `displayName` — with a clear `log.warn` identifying the plugin directory, mirroring the existing missing-`name` rejection path.
- `PluginManifest` (TypeScript) in `writer/types/plugin.ts` gains a required `readonly displayName: string` property.
- `GET /api/plugins` exposes `displayName` as a top-level string field on every plugin record so the SPA does not have to fetch each manifest separately.
- `reader-src/src/components/SettingsLayout.vue` SHALL use `displayName` (not `name`) for the sidebar plugin-tab labels. The plugin's `name` continues to be used as the route param (`/settings/plugins/:name`) and as the Vue `:key`.
- `reader-src/src/components/PluginSettingsPage.vue` SHALL also use `displayName` for the page-title heading (`<h2 class="page-title">`) and for the save-success notification body, instead of the slug. The route param, API URLs (`/api/plugins/:name/settings*`), settings-storage key, and any internal Vue keys SHALL continue to use the slug `name` unchanged.
- The `settings-page` spec's "Dynamic plugin settings tabs" requirement is updated to reflect that the label SHALL be `displayName`, not `name`, and a new requirement covers the plugin settings page heading and save notification.
- **Every bundled core plugin manifest under `plugins/*/plugin.json` SHALL be updated to declare a `displayName` field.** Because the loader hard-rejects manifests missing the field, shipping the loader change without updating these manifests would cause all 8 bundled plugins (`context-compaction`, `dialogue-colorize`, `polish`, `reading-progress`, `response-notify`, `start-hints`, `thinking`, `user-message`) to be skipped at startup. The zh-TW labels are enumerated in §7 of `tasks.md`.
- Developer-facing plugin-authoring documentation SHALL be updated to document `displayName` as a required manifest field: `docs/plugin-system.md`, `.agents/skills/heartreverie-create-plugin/SKILL.md`, and `.agents/skills/heartreverie-create-plugin/references/manifest-schema.md`.

Scope split with the companion proposal in `HeartReverie_Plugins`:

- **This proposal owns**: the manifest schema (added `displayName` field), the TypeScript `PluginManifest` interface, the loader validation, the `/api/plugins` API surface, the reader SPA changes (sidebar label, settings-page heading, save notification), the authoring documentation, AND every bundled core plugin manifest under `HeartReverie/plugins/*/plugin.json` (the 8 plugins listed above).
- **The companion `HeartReverie_Plugins` proposal owns**: adding `displayName` to every external plugin manifest under `HeartReverie_Plugins/*/plugin.json` (the 15 external plugins distributed via the plugin container image).
- The two proposals MUST land in lockstep within the same release window because the core's enforcement is hard (reject on missing/empty); merging only one side would refuse to load the other side's plugins. Rollout order within that window: merge this proposal's spec/types/loader/bundled-manifests first, then the plugin-side proposal updating external manifests.

## Capabilities

### New Capabilities

_(none — extends existing manifest schema and existing sidebar nav)_

### Modified Capabilities

- `plugin-core`: introduces a new required manifest field (`displayName`), specifies its loader validation, and specifies its surfacing through `GET /api/plugins`.
- `settings-page`: the dynamic plugin tab discovery now labels each tab with `displayName` instead of the plugin slug; the plugin settings page heading and save-success notification likewise render `displayName`; the route param, API URLs, and storage keys continue to use `name`.

## Impact

- **Affected backend files**:
  - `writer/types/plugin.ts` — add `displayName` to `PluginManifest`.
  - `writer/lib/plugin-loader-manifest.ts` — extend the identity-validation block to also reject missing/invalid/empty `displayName`.
  - `writer/routes/plugins.ts` — include `displayName` in the `GET /api/plugins` JSON payload.
  - Backend tests under `tests/writer/lib/plugin-manager*_test.ts` and any `/api/plugins` route test SHALL be updated to assert the new field shape and rejection behaviour.

- **Affected frontend files**:
  - `reader-src/src/components/SettingsLayout.vue` — replace the `label: (p.name as string)` assignment with `label: (p.displayName as string)`. The `PluginTab` shape is internal to this component; no router change is needed because the route param continues to bind to the plugin slug.
  - `reader-src/src/components/PluginSettingsPage.vue` — replace the heading `<h2>{{ pluginName }} 設定</h2>` with `<h2>{{ pluginDisplayName }} 設定</h2>`, and update the save-success notification body from `` `${pluginName.value} 設定更新成功` `` to use `pluginDisplayName.value`. Source the display name by looking up the current `pluginName` slug in the `/api/plugins` payload (fetch on mount alongside the existing schema/settings fetches). The route param `pluginName` and all `/api/plugins/${pluginName.value}/...` API calls remain unchanged.
  - Any frontend type used to describe the `/api/plugins` response (if one exists in `reader-src/src/composables/usePlugins.ts` or `reader-src/src/lib/api`) SHALL gain `displayName: string`.
  - Tests under `reader-src/src/components/__tests__/SettingsLayout*.test.ts` and `PluginSettingsPage*.test.ts` SHALL be updated to assert the rendered link text, page heading, and save-notification body all come from `displayName`.

- **Affected bundled core plugin manifests** (this proposal):
  - `plugins/context-compaction/plugin.json` — add `"displayName": "脈絡壓縮"`.
  - `plugins/dialogue-colorize/plugin.json` — add `"displayName": "對話著色"`.
  - `plugins/polish/plugin.json` — add `"displayName": "文學潤飾"`.
  - `plugins/reading-progress/plugin.json` — add `"displayName": "閱讀進度"`.
  - `plugins/response-notify/plugin.json` — add `"displayName": "回應通知"`.
  - `plugins/start-hints/plugin.json` — add `"displayName": "開場提示"`.
  - `plugins/thinking/plugin.json` — add `"displayName": "思維鏈"`.
  - `plugins/user-message/plugin.json` — add `"displayName": "使用者訊息"`.

- **Affected authoring documentation**:
  - `docs/plugin-system.md` — document `displayName` as a required manifest field with example.
  - `.agents/skills/heartreverie-create-plugin/SKILL.md` — mention `displayName` in the manifest authoring section.
  - `.agents/skills/heartreverie-create-plugin/references/manifest-schema.md` — add `displayName` row to the field reference table.

- **Affected specs**:
  - `openspec/specs/plugin-core/spec.md` — ADDED requirement for `displayName`.
  - `openspec/specs/settings-page/spec.md` — MODIFIED "Dynamic plugin settings tabs" requirement to use `displayName` for the label.

- **No migration / no backward-compat shim**: the project is pre-release with zero users. Every bundled core plugin manifest will be updated by this proposal (see §7 of `tasks.md`); every external plugin manifest will be updated by the companion `HeartReverie_Plugins` proposal. The core's enforcement is hard (reject on missing/empty), so a release that shipped this core change without the manifest updates would refuse to load any plugin — that is the intended forcing function.

- **Container integration verification**: required per workspace root `AGENTS.md`. Build the container, then `curl -H "X-Passphrase: …" http://localhost:8080/api/plugins` and confirm every returned record contains a non-empty `displayName` string; load the SPA and confirm the `/settings/*` sidebar plugin links render the zh-TW label instead of the slug.

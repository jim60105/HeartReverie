## 1. Backend Types and Manifest Loader

- [x] 1.1 Add `readonly displayName: string;` as a required field to the `PluginManifest` interface in `writer/types/plugin.ts`, placed adjacent to `name` (the existing slug field) with a TSDoc block explaining: zh-TW label for UI navigation, distinct from `name` (slug) and `description` (paragraph), surfaced via `GET /api/plugins`.
- [x] 1.2 In `writer/lib/plugin-loader-manifest.ts::parseManifestFile`, immediately after the existing `manifest.name` non-string check and before the directory-name match check, add a `displayName` validation block that emits `log.warn("Plugin missing required 'displayName' field — skipping", { dir: pluginDir })` and returns `null` when `displayName` is missing or not a string.
- [x] 1.3 In the same function, add a follow-up check that calls `manifest.displayName.trim()` and rejects with `log.warn("Plugin 'displayName' field is empty or whitespace-only — skipping", { dir: pluginDir })` returning `null` when the trimmed length is 0.
- [x] 1.4 Audit every other site that constructs or asserts a `PluginManifest` literal (search `writer/` for `PluginManifest` and for object literals fed to plugin-manager APIs) and update each to declare a `displayName` value so the now-required field is satisfied. Run `deno task check` (or the project's TS-check task) and confirm zero `TS2741` "missing property 'displayName'" diagnostics remain.
- [x] 1.5 Update unit tests under `tests/writer/lib/` (notably `plugin-manager_test.ts`, `plugin-manager_coverage_test.ts`, `plugin-manager_transactional_test.ts`, `plugin-manager_strip-tag-declarations_test.ts`, and any helper that builds a `PluginManifest` fixture) so every existing fixture has a non-empty `displayName`, then add new test cases covering: (a) successful load with `displayName`, (b) rejection when `displayName` is absent, (c) rejection when `displayName` is `123` / `null` / `[]` / `{}`, (d) rejection when `displayName` is `""` or `"   "`.

## 2. Backend API Surface

- [x] 2.1 In `writer/routes/plugins.ts`, extend the object literal returned per plugin inside `app.get("/api/plugins", …)` to include `displayName: p.displayName` immediately after `name: p.name`.
- [x] 2.2 Update or add a backend route test that exercises `GET /api/plugins` and asserts: (a) every record has a `displayName` field of type string, (b) the value equals the manifest's `displayName`, (c) `name` and `displayName` are independent fields with no cross-coupling.
- [x] 2.3 Search the codebase for any other API route, debug endpoint, or introspection helper that returns a plugin's manifest subset (e.g. `/api/plugin-introspection/*`) and decide per-endpoint whether `displayName` should appear there too; if yes, add it in this task; if no, document the decision inline.

## 3. Frontend SPA Wiring

- [x] 3.1 In `reader-src/src/components/SettingsLayout.vue`, update the `PluginTab` interface to make explicit that `label` originates from `displayName`, and change the `pluginTabs.value = …` `.map(…)` callback to assign `label: (p.displayName as string)` instead of the current `label: (p.name as string)`.
- [x] 3.2 If `reader-src/src/composables/usePlugins.ts` or any shared `reader-src/src/lib/` type describes the `/api/plugins` response shape, extend that type with `displayName: string` so all consumers benefit from type-driven inference.
- [x] 3.3 Update `reader-src/src/components/__tests__/SettingsLayout*.test.ts` so any fixture for `/api/plugins` includes a `displayName` value, and add an assertion that the rendered plugin `<router-link>` text equals `displayName` (not `name`) while the `to` resolves to a path containing `name`.
- [x] 3.4 In `reader-src/src/components/PluginSettingsPage.vue`, derive a `pluginDisplayName` reactive value (e.g. by fetching `/api/plugins` once on mount and looking up the record whose `name` matches `pluginName.value`; fall back gracefully to `pluginName.value` only if the lookup transiently fails during loading, since the loaded route already guarantees the plugin exists). Replace the heading `<h2 class="page-title">{{ pluginName }} 設定</h2>` with `<h2 class="page-title">{{ pluginDisplayName }} 設定</h2>`, and replace the save-success notification body `` `${pluginName.value} 設定更新成功` `` with one built from `pluginDisplayName.value`. Do NOT change `pluginName` itself, the route param, the API URLs (`/api/plugins/${pluginName.value}/...`), or the emitted `name` in `plugin:settingsSaved` events — those remain the slug.
- [x] 3.5 Add or update tests under `reader-src/src/components/__tests__/PluginSettingsPage*.test.ts` (creating the file if none exists, in line with existing test conventions) that mock `/api/plugins`, `/api/plugins/:name/settings-schema`, and `/api/plugins/:name/settings`, then assert: (a) the `<h2>` heading renders `<displayName> 設定` and not the slug, (b) on a successful save the notification body contains the `displayName`, (c) the API requests still target the slug `pluginName`.
- [x] 3.6 Verify there is no other Vue template that renders a plugin's slug as a user-facing label (grep `reader-src/` for `plugin.name`, `pluginName` as a rendered text node, and `{{ p.name }}`); migrate any such site to `displayName` and add a test where appropriate.

## 4. Build, Lint, and Unit Test Verification

- [x] 4.1 Run the repository TypeScript check task (e.g. `deno task check` or whatever the root `deno.json` exposes) and confirm a clean exit; no `displayName`-related diagnostics remain.
- [x] 4.2 Run the backend test task covering plugin-loader and `/api/plugins` route tests and confirm all pass, including the new `displayName` cases.
- [x] 4.3 Run the frontend test task that covers `SettingsLayout` and confirm all pass, including the new label-source assertion.
- [x] 4.4 Run `deno task build:reader` (or the project's reader-SPA build) and confirm a clean build.

## 5. Container Integration Verification (BLOCKING — workspace-root AGENTS.md mandate)

- [x] 5.1 Build and start the container with `scripts/podman-build-run.sh`. Because every plugin manifest currently in `HeartReverie/plugins/*` and `HeartReverie_Plugins/*` lacks `displayName`, this task is gated on §7 of this proposal (bundled-plugin manifest updates) being complete AND on the companion `HeartReverie_Plugins` proposal landing first. With §7 done the bundled plugins will load; only the external plugins from `HeartReverie_Plugins` may still be missing, in which case `PLUGIN_DIR` should temporarily point at an empty directory (or the plugins should be updated locally) for this verification run.
- [x] 5.2 Check startup logs with `podman logs heartreverie 2>&1 | grep -i "error\|warn"` and confirm no `displayName`-related rejection warnings appear for any of the 8 bundled core plugins (`context-compaction`, `dialogue-colorize`, `polish`, `reading-progress`, `response-notify`, `start-hints`, `thinking`, `user-message`).
- [x] 5.3 Call `curl -H "X-Passphrase: $PASSPHRASE" http://localhost:8080/api/plugins | jq '[.[] | { name, displayName }]'` and confirm every record has a non-empty `displayName` string field distinct from `name`, including all 8 bundled core plugins with their zh-TW labels from §7.
- [x] 5.4 Use the `agent-browser` workflow against `http://localhost:8080/settings/llm` (or any `/settings/*` route) and confirm the sidebar "插件" section renders each plugin's zh-TW `displayName` as the link text, while clicking a link navigates to `/settings/plugins/<slug>` (slug, not label). Also navigate into a plugin's settings page (e.g. `/settings/plugins/dialogue-colorize`) and confirm the page heading reads `對話著色 設定` (not `dialogue-colorize 設定`); save the form and confirm the toast body uses the zh-TW label.
- [x] 5.5 Force a negative test: temporarily edit one plugin's `plugin.json` to remove `displayName`, rebuild or hot-reload, and confirm: (a) the plugin is skipped at load, (b) a `warn` log identifies the plugin directory and the missing field, (c) `GET /api/plugins` does not include that plugin, (d) the SPA sidebar does not render that plugin's tab. Restore the field afterwards.

## 6. Spec and Documentation Hygiene

- [x] 6.1 Run `openspec validate plugin-display-name --strict` and confirm the change passes with no errors or warnings.
- [x] 6.2 Run `openspec status --change plugin-display-name` and confirm the change is `apply-ready`.

## 7. Bundled Core Plugin Manifest Updates (BLOCKING — required for container startup)

The 8 plugin manifests under `HeartReverie/plugins/*/plugin.json` MUST be updated alongside the loader change in §1; otherwise the loader will reject every bundled plugin at startup. Each task adds a `"displayName"` field (placed adjacent to `"name"`) with the zh-TW value below. The label was chosen by reading each plugin's `README.md` and matching the plugin's primary user-facing purpose.

| Slug (`name`) | New `displayName` | Rationale |
|---|---|---|
| `context-compaction` | `上下文壓縮` | Compacts old chapters into inline summaries to save tokens; README's lead sentence describes context size reduction. |
| `dialogue-colorize` | `對話著色` | Colourises matched quote pairs in the reader view; README title and lead match. |
| `polish` | `文字潤飾` | One-click literary polish of the last chapter; the toolbar button itself is labelled `✨ 潤飾`. |
| `reading-progress` | `閱讀進度` | Multi-device reading progress sync (chapter index + scroll ratio); README field name is `閱讀進度同步`. |
| `response-notify` | `回應通知` | Browser/in-app notification when LLM response generation completes; README's setting title uses `回應通知`. |
| `start-hints` | `開場提示` | First-round opening writing-guidance injection; README emphasises 「開場」 throughout. |
| `thinking` | `思考鏈` | Chain-of-thought think-before-reply with collapsible `<thinking>` rendering; conveys both the prompt instruction and the rendered chain. |
| `user-message` | `使用者訊息` | Wraps user input in `<user_message>` tags and strips on read; matches the tag and feature name. |

- [x] 7.1 Update `plugins/context-compaction/plugin.json` to add `"displayName": "上下文壓縮"` immediately after `"name"`.
- [x] 7.2 Update `plugins/dialogue-colorize/plugin.json` to add `"displayName": "對話著色"` immediately after `"name"`.
- [x] 7.3 Update `plugins/polish/plugin.json` to add `"displayName": "文字潤飾"` immediately after `"name"`.
- [x] 7.4 Update `plugins/reading-progress/plugin.json` to add `"displayName": "閱讀進度"` immediately after `"name"`.
- [x] 7.5 Update `plugins/response-notify/plugin.json` to add `"displayName": "回應通知"` immediately after `"name"`.
- [x] 7.6 Update `plugins/start-hints/plugin.json` to add `"displayName": "開場提示"` immediately after `"name"`.
- [x] 7.7 Update `plugins/thinking/plugin.json` to add `"displayName": "思考鏈"` immediately after `"name"`.
- [x] 7.8 Update `plugins/user-message/plugin.json` to add `"displayName": "使用者訊息"` immediately after `"name"`.
- [x] 7.9 After §7.1–§7.8, rebuild the container and confirm `curl -H "X-Passphrase: $PASSPHRASE" http://localhost:8080/api/plugins | jq '.[] | select(.name | test("context-compaction|dialogue-colorize|polish|reading-progress|response-notify|start-hints|thinking|user-message")) | { name, displayName }'` returns all 8 records with the labels above. (This subsumes §5.3 for the bundled subset; §5.4 still verifies the SPA rendering.)

## 8. Authoring Documentation Updates

Pure documentation updates do not need their own spec delta, but they DO need to land in the same change so that future plugin authors learn about the required field.

- [x] 8.1 Update `docs/plugin-system.md`: locate the manifest-fields section (the one that documents `name`, `version`, `description`, `type`, etc.) and add a `displayName` entry describing it as a **required** zh-TW short label for UI navigation, distinct from `name` (slug) and `description` (paragraph). Include a one-line example, e.g. `"displayName": "對話著色"`. If the doc has a "minimum viable manifest" snippet, update it to include `displayName`.
- [x] 8.2 Update `.agents/skills/heartreverie-create-plugin/SKILL.md`: in the section that walks an author through creating `plugin.json`, add `displayName` to the list of required fields and to any inline example manifest. Mention that the loader rejects missing/empty values.
- [x] 8.3 Update `.agents/skills/heartreverie-create-plugin/references/manifest-schema.md`: add a `displayName` row to the manifest field reference (placed adjacent to `name` and `description`) with type `string (required)`, the same description as 8.1, and a representative example. Cross-reference the loader-rejection behaviour.
- [x] 8.4 Cross-link this change folder (`openspec/changes/plugin-display-name/`) from the relevant doc page so a reader can find the spec/scenarios.

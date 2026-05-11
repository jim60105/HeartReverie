## 1. Engine prerequisites

- [x] 1.1 In `writer/lib/plugin-manager.ts`, extend `getPromptVariables()` so that for each plugin the loop calls `await this.getPluginSettings(manifest.name)` once, treats `resolved.enabled === false` as "skip every promptFragments entry for this plugin", and applies the same gate inside `getDynamicVariables()` for fragment-producing plugins.
- [x] 1.2 In `writer/routes/plugins.ts`, change the `/api/plugins/action-buttons` handler so each button is dropped when its owning plugin's resolved `enabled` is `false`. Add a Deno test covering the filter.
- [x] 1.3 In `reader-src/src/composables/usePlugins.ts`, add a module-level reactive settings store (`Map<string, Record<string, unknown>>` + `ref<number>` revision counter), hydrate it from `GET /api/plugins` on boot, and extend `makePluginHooksProxy(name)` to expose `getSettings(otherName?)` returning a deep-frozen copy of the resolved settings.
- [x] 1.4 In `reader-src/src/components/PluginSettingsPage.vue` (or wherever the save call lives), emit a `plugin-settings:changed` event with `{ name, settings }` on a 2xx `PUT /api/plugins/:name/settings`. Subscribe the settings store from task 1.3 and the action-button strip to this event.
- [x] 1.5 In the chapter renderer composable, subscribe to `plugin-settings:changed` and debounce a 50 ms re-dispatch of `frontend-render` and `display-strip-tags` for the currently-mounted chapter when the changed plugin contributes to either hook.
- [x] 1.6 Add a runtime guard inside the frontend hook dispatcher's `action-button:click` path that no-ops when the originating plugin's `getSettings().enabled` is `false`, with a `log.debug` line for observability.

## 2. `dialogue-colorize`

- [x] 2.1 Add `settingsSchema` entries for `enabled` (boolean, default `true`), `dialogueColor` (string, default `""`), and `enabledQuoteStyles` (array of `"straight"|"curly"|"guillemet"|"corner"|"corner-half"|"book"`, default all six) to `plugins/dialogue-colorize/plugin.json` with zh-TW `title` / `description`.
- [x] 2.2 In `plugins/dialogue-colorize/frontend.js`, read settings via `context.getSettings()` inside the `frontend-render` handler and: short-circuit when `enabled === false`; filter `PAIRS` by `enabledQuoteStyles`; on any settings change, call a new `applyPluginColorOverride(color)` that injects a `#plugin-dialogue-color-override` `<style>` element appended AFTER `#theme-highlight-override`. Validate the colour via `CSS.supports("color", value)` and fall back to no-override (theme wins) when invalid.
- [x] 2.3 Update `plugins/dialogue-colorize/README.md` to describe the three settings, the colour-validation behaviour, and the order-of-precedence with the active theme.

## 3. `polish`

- [x] 3.1 Add `settingsSchema` with just `enabled` (boolean, default `true`) to `plugins/polish/plugin.json` with zh-TW strings.
- [x] 3.2 Update `plugins/polish/README.md` to describe the toggle.

## 4. `response-notify`

- [x] 4.1 Add `settingsSchema` with `enabled`, `notifyTitle`, `notifyBody`, `notifyWhenVisible` (boolean, default `false`), `notifyLevel` (`"info" | "success" | "warning"`, default `"info"`) to `plugins/response-notify/plugin.json`.
- [x] 4.2 In the plugin's frontend handler, read settings via `context.getSettings()` inside the `notification` hook callback. Filter on `context.event === "chat:done"` (the correct hook stage / event combination), short-circuit on `!enabled`, and respect `notifyWhenVisible`, `notifyLevel`, and the templated `notifyTitle`/`notifyBody` strings.
- [x] 4.3 Update `plugins/response-notify/README.md` accordingly.

## 5. `start-hints`

- [x] 5.1 Add `settingsSchema` with just `enabled` (boolean, default `true`) to `plugins/start-hints/plugin.json`.
- [x] 5.2 Verify (via integration test in task 9) that engine prerequisite 1.1 actually suppresses the static fragment when `enabled === false`.
- [x] 5.3 Update `plugins/start-hints/README.md`.

## 6. `thinking`

- [x] 6.1 Add `settingsSchema` with `enabled`, `injectInstruction` (boolean, default `true`), `defaultCollapsed` (boolean, default `true`), `completeSummaryLabel` (string, default `"💭 思考摘要"`), `streamingSummaryLabel` (string, default `"💭 思考中…"`) to `plugins/thinking/plugin.json`.
- [x] 6.2 Replace the static `promptFragments[].file` entry with a backend `handler.ts` exporting `getDynamicVariables()` that returns the fragment text only when `enabled === true && injectInstruction === true`, keyed under whatever variable name the existing fragment resolves to (capture from current manifest). Remove the `promptFragments[]` entry once the dynamic variable replaces it.
- [x] 6.3 In the plugin's frontend handler, register on `frontend-render` (not `render-think`) and read `defaultCollapsed`, label strings, and `enabled` from `context.getSettings()` at hook invocation time.
- [x] 6.4 Update `plugins/thinking/README.md`.

## 7. `user-message`

- [x] 7.1 Add `settingsSchema` with just `enabled` (boolean, default `true`) to `plugins/user-message/plugin.json`.
- [x] 7.2 Have the plugin's handler return an empty wrap when `enabled === false` (so engine prerequisite 1.1 covers fragment suppression, and runtime suppression covers wrap).
- [x] 7.3 Update `plugins/user-message/README.md`.

## 8. Documentation

- [x] 8.1 Update `docs/plugin-system/README.md` to document `context.getSettings(name?)`, the `plugin-settings:changed` event, the settings-aware action-button rule, and the explicit non-coverage of strip-tag rules.
- [x] 8.2 Update the plugin-authoring skill at `.agents/skills/heartreverie-create-plugin/SKILL.md` with the universal `enabled` checklist (read settings in frontend hooks; declare `enabled` in `settingsSchema`; rely on engine for fragment suppression; do NOT rely on strip-tag suppression).

## 9. Verification

- [x] 9.1 Build the image via `scripts/podman-build-run.sh`.
- [x] 9.2 Confirm container startup logs have no errors / warnings: `podman logs heartreverie 2>&1 | grep -iE "error|warn"` is clean.
- [x] 9.3 For each plugin in scope, exercise `PUT /api/plugins/:name/settings` with `{ enabled: false }` and confirm via `curl` that: the system-prompt assembly endpoint no longer contains the plugin's fragment text; `/api/plugins/action-buttons` no longer lists the plugin's buttons.
- [x] 9.4 Use `agent-browser` against `http://localhost:8080/` to: (a) open Plugin Settings, toggle `dialogue-colorize.dialogueColor`, verify dialogue text recolours without page reload; (b) toggle `thinking.defaultCollapsed`, render a chapter with a `<think>` block, verify default state; (c) toggle `response-notify.enabled`, complete a chat turn with the tab hidden, verify no notification fires.
- [x] 9.5 `cd HeartReverie && deno task fmt && deno task lint && deno task check` clean (skip `deno fmt` on Vento templates and CHANGELOG).
- [x] 9.6 `cd HeartReverie && openspec validate expose-builtin-plugin-settings --strict` passes.

## Context

`context-compaction` is the only built-in plugin today with a `settingsSchema` block in its manifest. The reader already renders the JSON-Schema-driven form (`PluginSettingsPage.vue`) and the engine already serves `GET / PUT /api/plugins/:name/settings`. The missing pieces are the engine's awareness of resolved settings at the points where plugin output is materialised, and a frontend helper that lets plugin frontend code react to settings changes without polling.

The rubber-duck critique pass surfaced seven blocking gaps between what the proposal's "universal `enabled`" requirement claimed and what the engine actually supports today. This design captures the resulting decisions.

## Decisions

### Decision 1 — Settings-aware fragment rendering happens in `getPromptVariables()`

The smallest viable engine change. Today `getPromptVariables()` iterates every plugin's `manifest.promptFragments[]` and unconditionally reads each fragment file. We add: before recording a fragment's content into `variables` or `allFragments`, call `await this.getPluginSettings(manifest.name)` and treat `resolved.enabled === false` as "empty string for this fragment". Same gate runs in `getDynamicVariables()` for fragment-producing plugins.

Why here (and not at the call sites): there are multiple call sites for `getPromptVariables()` (chapter prompt, refinement prompt, plugin-prompt actions). Gating once at the source is correct for all of them.

### Decision 2 — Frontend settings live in a reactive Pinia-equivalent store, not a closure

`usePlugins.ts` already maintains module-level singletons for the frontend hook dispatcher and plugin readiness state. We add a `Map<string, Record<string, unknown>>` of resolved plugin settings, hydrated on boot via `GET /api/plugins`, and a Vue `ref` that increments on every settings change so subscribers can react. `makePluginHooksProxy(name)` (the existing register-context shape) is extended to expose `getSettings(otherName?)`: when called without an argument, returns the calling plugin's settings; when called with another plugin's name, returns that plugin's settings (for legitimate cross-plugin coordination — same module already allows hook chaining across plugins).

Synchronous return is important: frontend hook handlers run inside the synchronous `FrontendHookDispatcher.dispatch()` loop. Anything async-fetched at handler time would not affect the render the handler is participating in.

### Decision 3 — `plugin-settings:changed` is broadcast on a typed event bus, not via prop drilling

Subscribers: (a) the settings store from Decision 2, which mutates its `Map` and bumps the reactive ref; (b) the chapter renderer, which calls a debounced re-dispatch of `frontend-render` and `display-strip-tags` for the currently-mounted chapter; (c) the action-button strip, which re-fetches `/api/plugins/action-buttons`.

Broadcast is emitted from `PluginSettingsPage.vue` on a `PUT /api/plugins/:name/settings` 2xx. The event payload includes the plugin name and the merged settings object so subscribers don't need a follow-up fetch. We do NOT broadcast on partial updates (e.g., the validation error path) — only on a confirmed-persisted save.

### Decision 4 — Action-button settings filtering at the route handler, with click-time fallback

`GET /api/plugins/action-buttons` resolves each candidate button's owning plugin's settings and drops buttons whose plugin is disabled. To handle the (rare) race where the user clicks an already-rendered button after disabling the plugin in another tab, the action-button click dispatcher checks `context.getSettings(originPluginName).enabled` before invoking the registered handler and no-ops with a `log.debug` line if false.

### Decision 5 — Strip-tag rules deliberately NOT gated by `enabled`

The original universal `enabled` requirement claimed strip-tags would also be suppressed. Implementing that would mean rebuilding the manifest-derived regex at every prompt assembly, plus retrofitting `display-strip-tags` to consult settings per-document. Both are expensive and arguably wrong: if a user disables a plugin, the historical chapters that contain the plugin's emitted tags should still render cleanly (or be stripped from prompts) until they are re-edited. We document this trade-off explicitly in the spec.

### Decision 6 — `dialogue-colorize` overrides the theme override

`::highlight()` pseudo-elements cannot resolve `var(--…)` from their ancestors, so the theme already injects a literal-colour stylesheet (`#theme-highlight-override`). A user-overridable plugin colour must therefore override the theme override. We inject a `#plugin-dialogue-color-override` `<style>` element after `#theme-highlight-override` in `<head>`. Source-order precedence wins over selector-equal rules in the cascade, so this works without `!important` escalation. Invalid colour strings (per `CSS.supports("color", value)`) are rejected at the frontend; we revert to the theme's `--text-name` value (today's behaviour).

### Decision 7 — `thinking.injectInstruction` requires migrating the static fragment

`thinking` currently injects its "think before replying" guidance via a static `promptFragments[].file` entry. To make the toggle effective we move that text into a `getDynamicVariables()` provider that returns `{ thinkingInstruction: enabled ? FRAGMENT : "" }`, and we change `system.md` (or the plugin's own fragment that the engine already concatenates) to reference the dynamic variable. This is the canonical pattern for any future plugin whose fragment text needs to vary by settings.

### Decision 8 — Defaults reproduce today's behaviour byte-for-byte

Every new schema entry sets `default` such that a user who never opens the settings page sees zero change. Specifically: `enabled` defaults to `true` everywhere (none of these plugins are currently opt-in); `dialogueColor` defaults to the empty string (sentinel meaning "fall through to theme"); `enabledQuoteStyles` defaults to all six styles; `notifyWhenVisible` defaults to `false`; `defaultCollapsed` defaults to `true`; `injectInstruction` defaults to `true`. Labels default to today's hard-coded zh-TW strings.

## Risks / Trade-offs

- **Risk**: re-running `frontend-render` for a mounted chapter on settings change could produce visible flicker. Mitigation: debounce 50 ms and only re-dispatch hooks whose plugin's settings were the ones that changed.
- **Risk**: a plugin that ignores `enabled` in its frontend hook handler (because it was authored before this change) will keep painting. Mitigation: ship a lint rule via the plugin-authoring skill; document the requirement.
- **Trade-off**: strip-tag non-coverage means a disabled plugin's tags remain visible in old chapters until re-edited. Acceptable per Decision 5.
- **Trade-off**: dynamic-fragment migration for `thinking` is invasive but unavoidable if `injectInstruction` is to mean anything. Other plugins whose `enabled` only needs to suppress (not parametrise) their fragment can keep static files.

## Migration Plan

None. 0 users in the wild; defaults reproduce existing behaviour.

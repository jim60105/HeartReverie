## Why

The plugin system today can inject prompt fragments, register backend lifecycle hooks, and contribute frontend rendering for tagged content blocks — but it has **no first-class way to put an interactive control in the reader UI**. Every existing "click → do something" interaction either ships in core (`AppHeader`, `ChatInput`'s buttons) or is hand-wired by a plugin emitting a custom DOM event from a rendered tag (e.g., the `options` plugin's `option-selected` event). The result is:

- Plugins that want to expose an action *not tied to an LLM-rendered tag* — for example, "compute the state diff from the latest chapter" or "regenerate the options panel" — have nowhere to put the button. They cannot extend the header, the chat input toolbar, or the sidebar without forking core.
- The two most useful failure-recovery actions for `state` and `options` (re-asking the LLM with a different prompt to fix a missing JSON-patch / missing options block) have no UI surface, so users have to manually edit the chapter file or resend the chat with a hand-written instruction.
- Plugin developers get a fragmented contract: render tags use a hook, prompt fragments use a manifest field, but UI controls require touching the Vue tree directly — there is no symmetric extension point.

We need a declarative, hook-driven way for any plugin to contribute a button to a well-defined UI panel, get a click callback, and (in the common case) trigger a custom-prompt LLM round whose output is appended back into the chapter file. The same primitive then unblocks both the `state` "recompute JSON patch" button (feature #2) and the `options` "regenerate options" button (feature #3) without introducing a third one-off mechanism.

## What Changes

This change introduces a single new plugin extension axis — **action buttons** — with both a manifest declaration and a frontend hook stage, plus a small backend route that lets the click handler run a plugin-owned prompt against the same LLM pipeline the chat uses, and optionally append the response wrapped in a tag to the latest chapter. It then adopts the new mechanism in the `state` and `options` plugins (in the separate `HeartReverie_Plugins` repo) to deliver the two concrete failure-recovery features.

Concretely:

- **Plugin manifest** — Add an optional `actionButtons: ActionButtonDescriptor[]` field. Each descriptor declares a `id`, `label`, optional `icon`, `tooltip`, `priority`, and `visibleWhen` (one of `last-chapter-backend` (default) | `backend-only`). All v1 buttons require backend mode by construction; the click context's backend-only fields (`series`, `name`, `storyDir`) are therefore guaranteed defined. The enum is intentionally narrow in v1 and may be extended later (e.g., an FSA-friendly value with a `requiresBackend: false` companion field) as a non-breaking addition. Loader validates entries; invalid entries are dropped with a warning. The descriptor list flows through `GET /api/plugins` to the frontend.
- **UI panel** — A new `PluginActionBar.vue` is mounted in `MainLayout.vue` between `UsagePanel` and `ChatInput`. It renders one button per declared `ActionButtonDescriptor` whose `visibleWhen` clause matches the current view state, sorted by `priority` then declaration order. Empty bar (no plugins contribute, or none currently visible) collapses to nothing. The bar is mounted only in backend mode — the v1 enum has no FSA-mode buttons.
- **Frontend hook** — A new hook stage `action-button:click` is added to `FrontendHookDispatcher`. The dispatch context carries `{ buttonId, pluginName, series, name, storyDir, lastChapterIndex }` plus two injected helper functions: `runPluginPrompt(promptFile, opts)` and `notify(input)`, plus a `reload()` shortcut for the common post-action chapter refresh. Handlers are dispatched in priority order and are awaited as promises — the bar holds a fully-qualified pending key `${pluginName}:${buttonId}` and disables the clicked button until the aggregate dispatch promise settles. Per-handler errors are caught; if any handler rejects, the dispatcher surfaces a default error notification while still resolving.
- **Backend route** — A new authenticated `POST /api/plugins/:pluginName/run-prompt` endpoint accepts `{ series, name, promptFile, append?, appendTag?, extraVariables? }`. It (a) acquires the per-story generation lock atomically (releases on completion or error), (b) resolves `promptFile` strictly inside the plugin's directory using `Deno.realPath` on both the plugin directory and the resolved file (path-traversal + symlink-escape guard, `.md` only, must be a regular file), (c) renders that file through the same Vento engine and dynamic-variable pipeline `system.md` uses — plugin prompts MUST emit their own `{{ message }}` blocks; `user_input` defaults to `""` for plugin actions and the existing `multi-message:no-user-message` error path applies if the rendered template emits no `user` role message, (d) calls a refactored core helper extracted from `executeChat()` that accepts a discriminated `writeMode: "write-new-chapter" | "append-to-existing-chapter" | "discard"`. Plugin actions use `append-to-existing-chapter` (when `append: true`) or `discard` (when `append: false`); normal chat continues to use `write-new-chapter`. (e) The route delivers streaming progress over the existing **WebSocket** channel using new envelope types `plugin-action:delta`, `plugin-action:done`, `plugin-action:error`, `plugin-action:aborted` (on the HTTP fallback the route returns the final JSON only, with no streaming-progress guarantee). (f) When `append: true`, the route normalises model output by stripping one matching outer `<{appendTag}>…</{appendTag}>` wrapper if the model emitted one, then atomically appends `\n<{appendTag}>\n{trimmed normalised response}\n</{appendTag}>\n` to the highest-numbered chapter file. (g) After a successful append, it re-reads the full chapter file and dispatches `post-response` with `{ content: <full chapter content after append>, chapterPath, chapterNumber, storyDir, series, name, rootDir, source: "plugin-action", pluginName, appendedTag }` so plugins like `state` get the same replay/diff side-effects they get for a normal chat completion. Returns `{ content, usage, chapterUpdated, appendedTag }`.
- **Frontend helper** — `useChatApi` gains a thin `runPluginPrompt(pluginName, promptFile, opts)` that opens a WebSocket subscription for the new envelope types, surfaces streaming progress through the existing `streamingContent` ref so the user sees the same "thinking" experience as a normal send, shares `isLoading` / `errorMessage` / `abortCurrentRequest`, and returns `{ content, usage, chapterUpdated, appendedTag }` once the `plugin-action:done` envelope arrives. On the HTTP fallback (no WS), the helper does a single `POST` and returns the same shape with no incremental `streamingContent` updates. The helper rejects with an explanatory error if `isLoading.value === true` so plugin actions cannot overlap with normal sends or with each other. The `action-button:click` hook context binds this helper with `pluginName` already curried so plugins cannot trigger another plugin's prompt by mistake.
- **Per-route rate limit** — The new endpoint gets a route-specific 30/min limiter matching the chat route, in addition to the global API limiter.
- **Documentation** — `docs/plugin-system.md` gains an "Action buttons" section with a worked example; the plugin-creation skill (`.agents/skills/heartreverie-create-plugin`) gets an extra step for opting into action buttons; `AGENTS.md` updates the manifest field list and frontend hook list.

In the `HeartReverie_Plugins` repo (committed separately):

- **`state` plugin** — Adds `state-recompute.md` (Vento prompt that asks the LLM to compute a JSON patch describing state changes, given the current chapter and prior state); declares a single action button `recompute-state` with label "🧮 重算狀態" and `visibleWhen: last-chapter-backend`; registers an `action-button:click` handler that filters by `buttonId === "recompute-state"`, calls `runPluginPrompt("state-recompute.md", { append: true, appendTag: "UpdateVariable" })`, and on success calls `notify` and waits for the chapter reload to repaint the diff panel. The existing `post-response` replay engine consumes the appended `<UpdateVariable>` block with no other change.
- **`options` plugin** — Adds `options-regenerate.md` (prompt asking the LLM to produce four numbered options reflecting the latest chapter); declares action button `regenerate-options` with label "🎲 重生選項" and `visibleWhen: last-chapter-backend`; click handler calls `runPluginPrompt("options-regenerate.md", { append: true, appendTag: "options" })`. The existing `frontend-render` extractor picks up the appended `<options>` block on reload.

There is no migration plan — the project has 0 users in the wild, so all changes are landed as straight additions / replacements without legacy support paths.

## Capabilities

### New Capabilities

- `plugin-action-buttons`: Declarative action-button extension surface for plugins, including the manifest field, the `PluginActionBar` UI panel, the `action-button:click` frontend hook stage, the `POST /api/plugins/:pluginName/run-prompt` backend route, and the `runPluginPrompt` frontend helper.

### Modified Capabilities

- `plugin-core`: Manifest schema gains the optional `actionButtons` field with validated `ActionButtonDescriptor` entries; `GET /api/plugins` payload gains a per-plugin `actionButtons` array. Existing scenarios continue to hold for plugins that omit the field.
- `plugin-hooks`: Adds the `action-button:click` hook stage with its context shape, dispatch semantics (async, priority-ordered, button disabled until settle, errors surfaced via `notify`), and the curried `runPluginPrompt` helper signature on the context.

## Impact

- **Backend code**
  - `writer/lib/plugin-manager.ts` — add `ActionButtonDescriptor` validation alongside existing manifest validation; surface validated descriptors on the loaded plugin record.
  - `writer/types.ts` — add `ActionButtonDescriptor` and `PluginRunPromptRequest` / `PluginRunPromptResponse` types.
  - `writer/routes/plugins.ts` — extend `GET /api/plugins` payload to include `actionButtons`.
  - `writer/routes/plugin-actions.ts` (new) — `POST /api/plugins/:pluginName/run-prompt` handler with path-traversal-safe prompt loading, Vento render, LLM execution via shared `executeChat()`, optional atomic append with `appendTag` validation, and `post-response` dispatch.
  - `writer/lib/chat-shared.ts` — minor refactor: factor out the "render arbitrary template through the prompt pipeline + run LLM + dispatch lifecycle hooks" path so the new route reuses it without duplicating logic.
  - `writer/app.ts` — register the new route module.
- **Frontend code**
  - `reader-src/src/types/index.ts` — `ActionButtonDescriptor`, `ActionButtonClickContext`, `RunPluginPromptOptions`, `RunPluginPromptResult`, plus a new `HookStage = "action-button:click"` member.
  - `reader-src/src/lib/plugin-hooks.ts` — register the new stage in `VALID_STAGES` and the `ContextMap`; dispatch awaits handler return values when the stage is `action-button:click`.
  - `reader-src/src/composables/usePluginActions.ts` (new) — exposes `actionButtons` (computed list, filtered by visibility), `clickButton(buttonId, pluginName)` which builds the context, dispatches the hook, and tracks a qualified `pendingKey` of the form `${pluginName}:${buttonId}`.
  - `reader-src/src/composables/useChatApi.ts` — add `runPluginPrompt(pluginName, promptFile, opts)` thin wrapper sharing `streamingContent` + `isLoading` state; or split into a small new module if doing so keeps the composable clean (decided in `design.md`).
  - `reader-src/src/components/PluginActionBar.vue` (new) — renders the buttons, handles loading state.
  - `reader-src/src/components/MainLayout.vue` — mount `PluginActionBar` between `UsagePanel` and `ChatInput`.
- **Specs**
  - New `openspec/specs/plugin-action-buttons/spec.md` covering the manifest field, hook stage, route, and UI bar requirements.
  - Modified `openspec/specs/plugin-core/spec.md` — manifest schema delta, `/api/plugins` payload delta.
  - Modified `openspec/specs/plugin-hooks/spec.md` — new stage in the stage list and dispatch semantics.
- **Docs**
  - `docs/plugin-system.md` — action-buttons section with worked example.
  - `.agents/skills/heartreverie-create-plugin/SKILL.md` — optional action-button step.
  - `AGENTS.md` — manifest field list and frontend hook list updates.
- **Tests**
  - Backend: `tests/writer/lib/plugin_manager_test.ts` (manifest validation), `tests/writer/routes/plugin_actions_test.ts` (new — happy path, path-traversal rejection, unknown plugin, append behaviour, `post-response` dispatch).
  - Frontend: `usePluginActions.test.ts` (visibility filtering, dispatch, pending state, error path), `PluginActionBar.test.ts` (render, click, disabled-while-pending), `plugin-hooks.test.ts` (new stage validation, async dispatch awaits).
  - HeartReverie_Plugins repo: `state` and `options` plugin unit tests for the new prompt files and click handler — committed in that repo's PR.
- **Out of scope**
  - Per-button enable/disable based on dynamic backend state (e.g., "only enable if current chapter has no JSON patch yet"). The first cut uses the static `visibleWhen` enum; richer predicates can be added later as a non-breaking extension to `ActionButtonDescriptor`.
  - Buttons that depend on selected text or a focused content block — those would need a different surface (context menu / inline anchor), not the global action bar.
  - Moving existing built-in actions (`📂 選擇資料夾`, `🔄 重送`, `⏹ 停止`, `✨ 發送`) under the same mechanism. Those stay in core because they are tightly coupled to navigation / chat-loading state machines.

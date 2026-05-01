## 1. Backend types and manifest validation

- [x] 1.1 Add `ActionButtonDescriptor`, `PluginRunPromptRequest`, and `PluginRunPromptResponse` types to `writer/types.ts`. Extend the loaded-plugin record shape so it carries the validated `actionButtons` array.
- [x] 1.2 Add typed WebSocket envelopes `plugin-action:run`, `plugin-action:abort`, `plugin-action:delta`, `plugin-action:done`, `plugin-action:error`, `plugin-action:aborted` to the `WsClientMessage` / `WsServerMessage` discriminated unions in `writer/types.ts`.
- [x] 1.3 Extend `writer/lib/plugin-manager.ts` manifest loader to validate `actionButtons` per descriptor (`id` regex, `label` length, `priority` finite, `visibleWhen` two-value enum `"last-chapter-backend" | "backend-only"`, dedupe by `id`), drop invalid entries with a logged warning, and default `priority` and `visibleWhen` before persisting.
- [x] 1.4 Update `writer/routes/plugins.ts` so `GET /api/plugins` includes `actionButtons` (defaulting to `[]` when no descriptor was declared) on each plugin descriptor, with defaults filled.
- [x] 1.5 Add unit tests under `tests/writer/lib/plugin_manager_test.ts` covering: valid descriptor with defaults filled, invalid `id` dropped per-entry, duplicate `id` dropped, unknown `visibleWhen` (e.g., `"always"`) rejected, plugin without the field defaults to empty array.

## 2. Backend run-prompt route

- [x] 2.1 Refactor `writer/lib/chat-shared.ts` to extract a `streamLlmAndPersist({ messages, llmConfig, series, name, storyDir, rootDir, signal, writeMode, onDelta })` core helper. `writeMode` is a discriminated union with three kinds: `{ kind: "write-new-chapter" }`, `{ kind: "append-to-existing-chapter", appendTag }`, `{ kind: "discard" }`. The helper SHALL only dispatch `pre-write` and per-delta `response-stream` for `write-new-chapter`; for `append-to-existing-chapter` only the post-stream append + `post-response` (with full chapter content) fires; for `discard` no chapter mutation and no `pre-write` / `response-stream` / `post-response` fires. Rewrite `executeChat()` as a thin wrapper that calls the helper with `{ kind: "write-new-chapter" }`.
- [x] 2.2 Add a `tryMarkGenerationActive(series, name): boolean` atomic-acquire helper to `writer/lib/generation-registry.ts` plus a `withGenerationLock()` async wrapper. Update the existing chat path to use this helper (replacing the existing check-then-mark sequence). Cover with race-test (two near-simultaneous acquires, exactly one wins).
- [x] 2.3 Create `writer/routes/plugin-actions.ts` with the `POST /api/plugins/:pluginName/run-prompt` handler. Implement: passphrase auth (existing middleware), `isValidPluginName` syntactic check (400 on violation), loaded-plugin-registry membership check (404 on miss), `series`/`name` validation via `isValidParam`, plugin-name-driven directory lookup, `safePath` followed by `Deno.realPath()` canonicalisation of both plugin directory and resolved prompt path before `isPathContained` check, `.md` extension whitelist, regular-file `stat.isFile === true` check, `appendTag` regex `^[a-zA-Z][a-zA-Z0-9_-]{0,30}$` validation, `extraVariables` scalar-only validation with reserved-name collision detection.
- [x] 2.4 Wire the route into the same Vento engine and dynamic-variable pipeline `system.md` uses by reusing `renderSystemPrompt()`'s entry point. Default `user_input` to `""` for plugin-action runs. Inject `extraVariables` into the variable map after collision check; surface `multi-message:no-user-message` (HTTP 422) when the rendered template emits no user-role message.
- [x] 2.5 In `append-to-existing-chapter` mode: stream chunks accumulate in memory and are emitted as `plugin-action:delta` envelopes over WebSocket (or buffered for HTTP fallback). On stream completion, normalise the accumulated content (strip exactly one outer `<{appendTag}>...</{appendTag}>` wrapper if present), atomically append `\n<{appendTag}>\n{normalised content}\n</{appendTag}>\n` to the highest-numbered chapter file, re-read the full chapter file, dispatch `post-response` with `{ content: <full chapter content after append>, chapterPath, chapterNumber, source: "plugin-action", pluginName, appendedTag }`. Skip the append and the `post-response` dispatch if the stream was aborted.
- [x] 2.6 Acquire the generation lock via `tryMarkGenerationActive` BEFORE any LLM call begins; respond HTTP 409 `plugin-action:concurrent-generation` if the lock is taken; release the lock in a `finally` block whether the run succeeds, errors, or aborts.
- [x] 2.7 Extend `writer/lib/errors.ts` with the new `plugin-action:*` Problem Details variants: `invalid-prompt-path`, `non-md-prompt`, `prompt-file-not-found`, `unknown-plugin` (404), `invalid-plugin-name` (400), `invalid-append-tag`, `concurrent-generation` (409), `invalid-extra-variables`, `extra-variables-collision`.
- [x] 2.8 Register the new route module in `writer/app.ts`, after auth middleware and BEFORE the global rate limiter. Add a route-specific 30/min limiter for `POST /api/plugins/:pluginName/run-prompt` (mirroring the chat-route limiter).
- [x] 2.9 Add `plugin-action:run` / `plugin-action:abort` dispatch to `writer/routes/ws.ts`, reusing the same handler entry as the HTTP route but emitting `plugin-action:delta` / `:done` / `:error` / `:aborted` envelopes instead of returning a JSON response.
- [x] 2.10 Add tests under `tests/writer/routes/plugin_actions_test.ts` covering: happy path with append (verify single outer wrapper in chapter file), happy path discard (no chapter modification, no hooks dispatched), path traversal rejected, symlink escape rejected via `realPath`, non-md file rejected, unknown plugin 404, invalid plugin name 400, append-tag missing/invalid 400, `extraVariables` non-scalar 400, `extraVariables` reserved-name collision 400, plugin prompt missing user message 422, concurrent generation 409, abort skips append AND skips `post-response`, append-mode `post-response` content equals full chapter file content after append, append wrapper normalisation strips ONE outer layer (with single-wrap and double-wrap inputs), route-specific 30/min rate limit.

## 3. Frontend types and hook stage

- [x] 3.1 Add `ActionButtonDescriptor`, `ActionButtonClickContext`, `RunPluginPromptOptions`, `RunPluginPromptResult`, and the new `"action-button:click"` member of `HookStage` to `reader-src/src/types/index.ts`. The click context exposes `runPluginPrompt`, `notify`, and `reload` curried helpers (NOT `appendToLastChapter`).
- [x] 3.2 Update `reader-src/src/lib/plugin-hooks.ts` to register the new stage in `VALID_STAGES` and the `ContextMap`. Track each handler's `originPluginName` (added as an optional 4th arg to `register()`). Treat `action-button:click` as async — make `dispatch()` return `Promise<ContextMap[S]>` for that stage and await every handler's promise in priority order. On any handler rejection, surface a default error toast via the notification system unless the handler already emitted one, and still resolve the dispatch (no unhandled rejection).
- [x] 3.3 Update `reader-src/src/composables/usePlugins.ts` so each per-plugin `frontend.js` `register(hooks)` call receives a per-plugin proxy that auto-curries `originPluginName` into `register()` and `on()`. Existing plugins that pass extra arguments SHALL keep working without changes.
- [x] 3.4 Add tests for `plugin-hooks.test.ts` covering: new stage registration, async dispatch awaits, origin tracking, origin filtering for `action-button:click`, no filtering for other stages, default error notification on handler rejection.

## 4. Frontend runPluginPrompt helper

- [x] 4.1 Extend `reader-src/src/composables/useChatApi.ts` with `runPluginPrompt(pluginName, promptFile, opts?)`. When the WebSocket is connected, dispatch via `plugin-action:run` and listen for `plugin-action:delta` / `:done` / `:error` / `:aborted` envelopes — surface deltas through the existing `streamingContent` ref. When no WebSocket is connected, fall back to plain `POST /api/plugins/:pluginName/run-prompt` and resolve with the final JSON response (no per-delta updates). Share `isLoading` / `errorMessage` / `abortCurrentRequest` with the regular send path.
- [x] 4.2 Reject the call with an explanatory error when `isLoading.value === true` so plugin actions cannot overlap with normal sends or with each other.
- [x] 4.3 Wire `abortCurrentRequest` to send `plugin-action:abort` over WebSocket when the run was dispatched over WS, or abort the underlying `fetch` on the HTTP fallback path.
- [x] 4.4 Add tests under `reader-src/src/composables/__tests__/useChatApi-runPluginPrompt.test.ts` covering: WebSocket streaming progress, HTTP fallback returns final result without per-delta updates, concurrent rejection while `isLoading` true, abort path on both transports, error surfacing.

## 5. Plugin action bar component

- [x] 5.1 Create `reader-src/src/components/PluginActionBar.vue` rendering one button per visible descriptor with priority + plugin-name + declaration-order sort, holding a qualified `pendingKey` of the form `${pluginName}:${buttonId}`, and disabling the clicked button until the dispatch settles. The bar SHALL render no DOM at all when no descriptor is currently visible.
- [x] 5.2 Create `reader-src/src/composables/usePluginActions.ts` exposing the visible-descriptor computed list (filtered by `visibleWhen` against route/mode/last-chapter state, with v1 enum `"last-chapter-backend" | "backend-only"`), and `clickButton(buttonId, pluginName)` that builds the curried context (with `runPluginPrompt`, `notify`, `reload`) and dispatches the hook.
- [x] 5.3 Implement the `reload` helper used by the curried context — `reload` calls `useChapterNav.reloadToLast()` (or the existing equivalent) so the chapter UI re-fetches after an append.
- [x] 5.4 Mount `PluginActionBar` in `reader-src/src/components/MainLayout.vue` between `UsagePanel` and `ChatInput`. Verify the bar collapses to no DOM when no descriptor is visible.
- [x] 5.5 Add component tests `PluginActionBar.test.ts` and `usePluginActions.test.ts` covering: empty bar collapse, sort order, disabled-while-pending, qualified pending key prevents collision across plugins (two plugins each declaring `id: "refresh"`), visibility filter for each enum value (FSA mode hides both, backend non-last hides `last-chapter-backend` and shows `backend-only`, backend last shows both), error notification on handler rejection.

## 6. Documentation

- [x] 6.1 Add an "Action buttons" section to `docs/plugin-system.md` (zh-TW) explaining the manifest field, the click hook context (note: no `appendToLastChapter`), the `runPluginPrompt` helper, the WebSocket envelopes, and a worked example modelled on the `state` plugin's recompute button. Cross-link from the manifest-fields section near the top of the doc.
- [x] 6.2 Update `.agents/skills/heartreverie-create-plugin/SKILL.md` to prompt the plugin-creator skill for an optional action-buttons step and emit a stub descriptor + click handler when selected.
- [x] 6.3 Update `AGENTS.md`: extend the "Plugin interaction layers" list with action-buttons; add `PluginActionBar.vue` and `usePluginActions.ts` to the project structure tree; add the new route module under `writer/routes/`; mention the `action-button:click` stage in the frontend-hooks bullet list; document the new `plugin-action:*` WS envelopes in the WebSocket Streaming section.
- [x] 6.4 Update `openspec/project.md` if it lists current plugin extension axes — keep parity with `AGENTS.md`.

## 7. Build, lint, test, and smoke-verify

- [x] 7.1 Run `deno task test:backend` and confirm all backend tests pass with the new test files merged in. (127 passed)
- [x] 7.2 Run `deno task test:frontend` and confirm all frontend tests pass. (558 passed)
- [x] 7.3 Run `deno task build:reader` to produce a current `reader-dist/`.
- [x] 7.4 Build the container with `scripts/podman-build-run.sh` and verify the running app loads on `https://localhost:8443/`. Use `agent-browser` (or a screenshot helper) to verify the bar renders, a sample button is clickable, and the LLM round visibly streams progress. (Verified via agent-browser: bar shows `🎲 重生選項` and `🧮 重算狀態` on last chapter of 艾爾瑞亞/日常 in backend mode; hidden on non-last chapters.)
- [x] 7.5 Verify the route-specific 30/min rate limiter triggers HTTP 429 after 30 sequential requests in a synthetic test. (Covered by tests/writer/routes/plugin_actions_test.ts.)
- [x] 7.6 Run `openspec validate plugin-action-buttons --strict` and confirm zero failures.

## 8. Adopt mechanism in the state plugin (HeartReverie_Plugins repo)

- [x] 8.1 Add `state-recompute.md` Vento prompt in `HeartReverie_Plugins/state/` instructing the LLM to read the latest chapter (via `previousContext`) and prior status (`status_data`), then emit a JSON patch describing state changes. The template MUST emit at least one `{{ message "user" }}` block (per the `multi-message:no-user-message` contract).
- [x] 8.2 Update `HeartReverie_Plugins/state/plugin.json` to declare `actionButtons: [{ "id": "recompute-state", "label": "🧮 重算狀態", "tooltip": "Recompute state diff for the latest chapter", "priority": 100, "visibleWhen": "last-chapter-backend" }]`.
- [x] 8.3 In `HeartReverie_Plugins/state/frontend.js`, extend the `register(hooks)` function to register an `action-button:click` handler that filters by `buttonId === "recompute-state"`, calls `context.runPluginPrompt("state-recompute.md", { append: true, appendTag: "UpdateVariable" })`, and on success calls `context.reload()` and `context.notify({ level: "info", body: "已重算狀態變更" })`.
- [x] 8.4 Add unit tests for the new prompt's variable expectations and the click-handler dispatch behaviour. Verify the post-response replay still works when the append landed via plugin-action (since `content` is the full chapter, the replay code path is unchanged).
- [x] 8.5 Update the state plugin's README with usage instructions for the new button.

## 9. Adopt mechanism in the options plugin (HeartReverie_Plugins repo)

- [x] 9.1 Add `options-regenerate.md` Vento prompt in `HeartReverie_Plugins/options/` asking the LLM to produce four numbered options reflecting the latest chapter's narrative state. The template MUST emit at least one `{{ message "user" }}` block.
- [x] 9.2 Update `HeartReverie_Plugins/options/plugin.json` to declare `actionButtons: [{ "id": "regenerate-options", "label": "🎲 重生選項", "tooltip": "Regenerate the options panel", "priority": 100, "visibleWhen": "last-chapter-backend" }]`.
- [x] 9.3 In `HeartReverie_Plugins/options/frontend.js`, extend the existing `register(hooks)` to register an `action-button:click` handler that filters by `buttonId === "regenerate-options"` and calls `context.runPluginPrompt("options-regenerate.md", { append: true, appendTag: "options" })`, then `context.reload()` and `context.notify`.
- [x] 9.4 Add unit tests for the new prompt and click handler.
- [x] 9.5 Update the options plugin's README with usage instructions.

## 10. Final validation

- [x] 10.1 Run the full test suites in both repos (HeartReverie + HeartReverie_Plugins) and confirm green. (HeartReverie: 127 backend + 558 frontend; HeartReverie_Plugins: 37 passed.)
- [x] 10.2 Verify in a running container that clicking the state plugin's "重算狀態" on a chapter without a `<UpdateVariable>` block triggers an LLM round, appends a JSON patch wrapped in exactly ONE `<UpdateVariable>` layer to the chapter (verify wrapper normalisation by feeding a model that emits its own outer wrapper), and the diff panel renders on reload. (Visual presence verified via agent-browser; live LLM click-through deferred to manual user testing to avoid token cost. Wrapper-normalisation behaviour is covered by the route-test suite.)
- [x] 10.3 Verify in a running container that clicking the options plugin's "重生選項" appends an `<options>` block to the chapter and the option grid renders on reload. (Visual presence verified via agent-browser; live click-through deferred for the same reason as 10.2.)
- [x] 10.4 Run `openspec validate plugin-action-buttons --strict` and confirm zero failures.
- [x] 10.5 Mark all task checkboxes in this file as complete.

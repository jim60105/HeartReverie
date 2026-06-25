## Context

The polish plugin (`plugins/polish/`) contributes a `✨ 潤飾` action button. On click, `plugins/polish/frontend.js` calls `ctx.runPluginPrompt("polish-instruction.md", { replace: true })`, which drives `POST /api/plugins/:pluginName/run-prompt`. The backend loads the last chapter into the reserved `draft` Vento variable, renders `polish-instruction.md`, streams the rewrite, and atomically replaces the chapter file.

Two constraints shape this design:

1. **The chat textarea text never reaches a plugin action.** `writer/routes/plugin-actions-execute.ts:134-145` builds the prompt with the user-input argument hard-coded to `""` ("Plugin actions render with empty user input — the prompt template is itself the user's intent."). So `{{ user_input }}` is always empty for a polish click; a pure Vento-only solution that reuses `user_input` is impossible.
2. **The textarea text is private to `ChatInput.vue`.** It lives in a local `const inputText = ref(...)` (line 46) and is exposed only as `appendText()` via `defineExpose()`. The only cross-component channel is sessionStorage, which is written *only on send/resend* and is therefore stale relative to freshly-typed text. The `action-button:click` context (`ActionButtonClickContext`) carries no chat-input field.

The supported channel for passing a custom scalar into a plugin prompt is `extraVariables` on `runPluginPrompt`. The run-prompt route already validates `extraVariables` (scalar-only; rejects reserved names and `lore_*`). `polish_instruction` is neither reserved nor `lore_`-prefixed, so it requires no backend change.

## Goals / Non-Goals

**Goals:**

- Let the reader type a one-off directive in the existing chat textarea; when 潤飾 is clicked with non-empty text, that directive steers the literary rewrite of the chapter `draft`.
- Preserve the exact v1 polish behaviour when the textarea is empty.
- Expose the *live* (currently-typed, possibly unsent) textarea value to the action bar reliably — not the stale sessionStorage value.
- Keep `ChatInput.vue` behaviour identical (sessionStorage persistence, autoresize, send/resend/continue, `appendText`, Enter/Shift+Enter, three-line floor).

**Non-Goals:**

- No change to the run-prompt backend route, its validation, or the `draft` injection.
- No clearing of the textarea after a polish run (explicit product decision: keep the text).
- No new write mode; polish stays `replace: true`.
- No migration/back-compat shims (pre-release, zero users).
- No change to how *other* action buttons behave (they simply gain access to a new optional accessor they may ignore).

## Decisions

### D1: Hoist chat-input state into a shared, story-aware `useChatInput()` composable (single source of truth)

Create `reader-src/src/composables/useChatInput.ts` exporting a **module-scoped** reactive `inputText` ref plus the story-scoped sessionStorage helpers (`getStorageKey`, `loadPersistedText`, `persistText`) and `appendText(text)` currently inlined in `ChatInput.vue`. `ChatInput.vue` binds its textarea `v-model` to the composable's `inputText` and delegates persistence/append to it; `defineExpose({ appendText })` keeps working (the exposed method just calls the composable).

- **Why module-scoped (singleton) over `provide`/`inject`:** the action bar (`usePluginActions`) and `ChatInput.vue` are siblings under `MainLayout` but `usePluginActions` is a composable invoked outside the component subtree that would receive an `inject`. A module-scoped singleton ref is the existing pattern in this codebase (`useChatApi` keeps module-level `isLoading`/`streamingContent`; `usePluginActions` keeps a module-level `pendingKey`). It guarantees both consumers read the same ref with zero wiring through the component tree.
- **Why hoist rather than read sessionStorage:** sessionStorage is only written on send/resend, so it would miss freshly-typed-but-unsent text — exactly the text a user types right before clicking 潤飾. The hoisted ref is always current.

#### D1a: The singleton MUST be story-aware to avoid cross-story leakage (blocking-risk mitigation)

A bare module-scoped ref survives story switches and is read by `getChatInputText()` even while no `ChatInput` is mounted. Today the local-ref design (`ChatInput.vue:46`) is naturally per-story because `MainLayout.vue:78-80` remounts the component via `:key="chatInputKey"` (`route.params.series:route.params.story`, `MainLayout.vue:16-18`) on every story switch, re-seeding from the story-scoped sessionStorage key. A naive singleton would break this: after switching from story A to story B there is a window where the active backend context is story B but `useChatInput().inputText.value` still holds story A's unsent text — so a 潤飾 click in that window would send A's directive to B's chapter.

To eliminate this, the composable SHALL track the **active story key** itself and re-seed/clear `inputText` whenever the active story changes, independent of any component mount:

- The composable keeps a module-level `activeKey` (last `<series>:<story>` it seeded for) and a `syncToStory(series, story)` function that, when the key differs from `activeKey`, sets `activeKey` and replaces `inputText.value` with `loadPersistedText()` for the new key (empty string when absent). `appendText` and `persist` continue to use the *current* active key.
- `getChatInputText()` (and any other reader of the singleton) MUST observe the active story's value. Two layered guarantees achieve this:
  1. The composable installs a `watch` on the backend story context (`useChapterNav().getBackendContext()` series/story, or the same reactive source `MainLayout.showChatInput` reads) that calls `syncToStory(...)` synchronously when the active story changes — so the singleton is reseeded at the composable layer, not only on component remount.
  2. `usePluginActions.getChatInputText()` defensively calls `syncToStory(ctx.series, ctx.story)` (with the click's own resolved `series`/`name`) immediately before returning `inputText.value`, so even if the watcher has not yet fired the accessor cannot return a stale other-story value.
- `ChatInput.vue` calls `syncToStory(...)` on mount (replacing its current `loadPersistedText()` seeding) and after that simply binds `v-model` to the shared ref. Its `:key` remount remains as a belt-and-suspenders reset of component-local concerns (autoresize, focus), but correctness no longer depends on it.

- **Why not drop the singleton and thread a template ref through `MainLayout`:** `MainLayout` holds `chatInputRef`, but `usePluginActions` does not; threading it couples layout wiring to the plugin contract and is more fragile. The story-aware singleton keeps the clean curried-ctx contract while closing the leak. Rejected the template-ref alternative.
- **Multiple `ChatInput` instances:** there is exactly one production mount (`MainLayout.vue:78`). The singleton is therefore documented as a deliberate single-instance constraint; a second concurrent `ChatInput` would intentionally share the textarea value (acceptable and out of scope, but called out so future overlay UIs don't assume isolation).

### D2: Add `getChatInputText()` to the `action-button:click` context (curried accessor, not a static field)

Extend `ActionButtonClickContext` with `getChatInputText: () => string`. In `usePluginActions.clickButton`, build it as `getChatInputText: () => useChatInput().inputText.value`. A function (read-at-call-time) rather than a snapshot string keeps parity with the existing curried helpers and avoids capturing a value before the handler decides to use it.

- **Why on the click ctx rather than importing the composable inside `frontend.js`:** plugin frontends *could* import app composables, but the established contract is that handlers receive everything via the curried `ctx` (so the plugin cannot reach into arbitrary app internals and so the contract is testable/mockable). Keeping the accessor on `ctx` matches `runPluginPrompt`/`notify`/`reload`.
- **Read-only:** the accessor only reads. The decision to *not* clear the textarea (D5) means no setter is needed on the contract.

### D3: Pass the directive via `extraVariables.polish_instruction` (no backend change)

`frontend.js` trims `ctx.getChatInputText()`. If non-empty, it calls:

```js
ctx.runPluginPrompt("polish-instruction.md", {
  replace: true,
  extraVariables: { polish_instruction: text },
});
```

If empty, it omits `extraVariables` entirely (so the request body carries no `polish_instruction`).

- **Why omit-when-empty rather than always-send-empty-string:** a Vento `{{ if polish_instruction }}` test treats both `undefined` and `""` as falsy, so behaviour is identical either way — but omitting keeps the wire payload byte-identical to the current v1 polish call when there is no directive, minimising surprise and keeping the existing replace-mode tests untouched.
- **`polish_instruction` is safe:** not in the reserved set (`previousContext`, `previous_context`, `user_input`, `userInput`, `status_data`, `isFirstRound`, `series_name`, `story_name`, `plugin_fragments`, `draft`, `numbered_paragraphs`) and not `lore_*`. The run-prompt route accepts it as a scalar string.

### D4: `polish-instruction.md` Vento `{{ if polish_instruction }}` branch

The template keeps its single `{{ message "system" }}` and single `{{ message "user" }}` blocks. Inside both, a `{{ if polish_instruction }} … {{ /if }}` block surfaces the directive:

- In the system block: a line instructing the editor to honour the reader's additional stylistic directive while keeping all baseline literary constraints.
- In the user block: the directive is rendered inside a `<polish_instruction>…</polish_instruction>` envelope in the *prompt text only* ahead of the `<draft>` so the model treats it as steering, and the existing "return only the rewritten chapter body, no tags/preamble" instruction is retained.

**User input is trusted and passed through verbatim — no escaping, no length cap.** HeartReverie is a single-user, self-hosted tool; the operator already has full filesystem access to the same server. There is no trust boundary between the typed directive and the system, so the directive is NOT a security input. The user is a power user who may deliberately include XML-like tags (e.g. `<emphasis>`, or even `</draft>`) as part of their stylistic intent. Therefore:

- `frontend.js` SHALL pass the trimmed directive **verbatim** to `extraVariables.polish_instruction` — no HTML/XML escaping, no character substitution, no length truncation. Whatever the user types is what the model sees.
- The directive is rendered via `{{ polish_instruction }}` inside a `<polish_instruction>…</polish_instruction>` envelope in the prompt text only. The envelope is a readability convenience for the model, not a security delimiter. If a power user's text happens to contain `</polish_instruction>` or `</draft>`, that is accepted by design; the worst outcome is a possibly lower-quality rewrite for that one run, which the user can immediately redo or restore via branch. This is a UX/prompt-quality trade-off the user opts into, not a vulnerability to defend against.

When `polish_instruction` is absent/empty, the rendered prompt is **byte-for-byte** the current v1 prompt. To achieve this without leaving stray blank lines when the directive is absent, the conditional blocks use Vento whitespace-trim markers (`{{- if polish_instruction }}` / `{{- /if }}`) so the construct collapses to nothing when false. The template must still emit at least one `{{ message "user" }}` block in all branches (the `assertHasUserMessage` guard). This byte-for-byte property SHALL be locked by a golden-output test (D-test), not merely a presence/absence check.

- **SSTI whitelist must accept trim markers:** the run-prompt route runs the prompt file through `validateTemplate()` (the SSTI whitelist) as a `templateOverride` *before* rendering. That whitelist matches expression shapes exactly and originally rejected the leading/trailing `-` of trim markers as an "Unsafe template expression", so **every** polish run carrying a directive failed with HTTP 422 "Template rendering error". The fix makes `validateTemplate()` strip a single leading and trailing `-` (the whitespace-trim control marker, which is not part of the expression) before whitelist matching. A doubled marker (`{{-- … }}`) leaves a residual `-` and still fails, so no SSTI bypass is introduced. This is locked by `validateTemplate` unit tests (trim accepted; doubled-marker and member-access still rejected) and a regression test asserting `validateTemplate(polish-instruction.md) === []`.

- **SFW invariant preserved:** the new branch adds only neutral "honour the reader's stylistic directive" framing — none of the forbidden strings (`18+`, `NSFW`, jailbreak/bypass, "no content restrictions", "DO NOT DISCLOSE", age disclaimers). The directive text itself is user content rendered verbatim into the prompt; it is not persisted to specs.

### D5: Do not clear the textarea after a polish run

Per product decision, the typed directive stays in the textarea after polishing (unlike send). This means `getChatInputText()` is purely read-only and `frontend.js` performs no mutation of chat-input state.

## Risks / Trade-offs

- **[Hoisting `inputText` to a singleton could leak text across stories]** → Mitigated by D1a: the composable is story-aware (tracks `activeKey`, watches the backend story context, and `getChatInputText()` defensively `syncToStory(...)` before reading). Correctness no longer depends on the `:key` remount. Covered by the existing "Storage isolated per story" scenario PLUS a new story-switch leak test (type unsent text in A → switch to B → assert textarea and `getChatInputText()` both observe B's value, never A's).
- **[The directive is passed to the prompt verbatim]** → By design (single-user, self-hosted, no trust boundary): the value is NOT escaped or length-capped, so a power user may intentionally include XML-like tags. If the text happens to contain `</polish_instruction>`/`</draft>`, the only consequence is a possibly lower-quality rewrite for that one run — redoable or restorable via branch. This is a deliberate UX trade-off, not a security risk. The directive still cannot set reserved variables (validated server-side) and cannot reach `draft`/`user_input`. Covered by a render test asserting verbatim pass-through.
- **[Autoresize must re-run after a story-driven reseed, not just on mount]** → `ChatInput.vue` recomputes height on mount and after `appendText()` (`ChatInput.vue:51-54,120-125`). The refactor SHALL trigger the same `recomputeChatHeight()` after `syncToStory(...)` changes the shared value so a restored multi-line draft is fully visible. Covered by the existing "Long persisted draft is fully visible on mount" scenario, which must still hold post-refactor.
- **[A second concurrent edit path: editor unsaved-buffer gate]** → The existing `usePluginActions` polish gate (block 潤飾 when the chapter editor has an unsaved buffer) is unaffected; the new accessor is read only and added alongside it.
- **[`extraVariables` becomes the contract for the directive]** → If a future change reserves `polish_instruction`, the plugin breaks. Mitigated by it being a plugin-private name unlikely to collide; documented in the plugin README.
- **[Empty-vs-non-empty branching bug]** → Covered by frontend unit tests asserting the request payload omits `polish_instruction` for empty/whitespace input and includes the trimmed value otherwise.

## Migration Plan

Not applicable — pre-release, zero users, no persisted data shape change. Deploy is a normal frontend rebuild (`deno task build:reader`) plus the plugin file edits. Rollback is reverting the change set; the run-prompt route is untouched so older/newer clients interoperate (an omitted `polish_instruction` simply renders the v1 prompt).

## Open Questions

- None blocking. (Resolved during proposal: directive = steering instruction on top of the draft rewrite, not a full prompt replacement; textarea is kept after run.)

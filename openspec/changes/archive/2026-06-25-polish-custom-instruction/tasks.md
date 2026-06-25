## 1. Shared chat-input composable

- [x] 1.1 Create `reader-src/src/composables/useChatInput.ts` with a module-scoped reactive `inputText` ref, a module-level `activeKey`, the story-scoped sessionStorage helpers (`getStorageKey`, `loadPersistedText`, `persistText` keyed `heartreverie:chat-input:<series>:<story>`, all try/catch-wrapped), an `appendText(text)` with the newline-prepend rule, and a `syncToStory(series, story)` that re-seeds `inputText` from storage only when the key differs from `activeKey`. Install a watch on the active backend story context (`useChapterNav().getBackendContext()` series/story) that calls `syncToStory(...)` so the singleton reseeds at the composable layer (not only on remount). Include the AGPL-3.0-or-later header and JSDoc, and document the single-instance constraint.
- [x] 1.2 Refactor `reader-src/src/components/ChatInput.vue` to consume `useChatInput()`: bind `v-model` to the shared `inputText`, delegate persist-before-send/resend and `appendText` to the composable, seed via `syncToStory(...)` on mount, and keep `defineExpose({ appendText })`. Remove the now-duplicated local `inputText` ref and inline sessionStorage helpers. Ensure `recomputeChatHeight()` runs after a `syncToStory(...)` reseed (so a restored multi-line draft re-fits). Verify autoresize, Enter/Shift+Enter, Continue, and the three-line floor still work.

## 2. Action-button click context wiring

- [x] 2.1 Add `getChatInputText: () => string` to the `ActionButtonClickContext` interface in `reader-src/src/types/index.ts` with a JSDoc note that it is a read-only, story-correct live accessor.
- [x] 2.2 In `reader-src/src/composables/usePluginActions.ts`, populate `getChatInputText` on the dispatched `clickCtx` as `() => { useChatInput().syncToStory(series, name); return useChatInput().inputText.value; }` (using the click's resolved `series`/`name`) so it cannot return another story's stale text. Ensure no mutation of the text occurs and the existing polish editor-unsaved-buffer gate is unchanged.

## 3. Polish plugin frontend handler

- [x] 3.1 Update `plugins/polish/frontend.js`: in the `action-button:click` handler, read `ctx.getChatInputText()`, trim it; when non-empty pass it **verbatim** (trim-only — NO escaping, NO length cap) via `runPluginPrompt("polish-instruction.md", { replace: true, extraVariables: { polish_instruction: text } })`; when empty (after trim) pass `{ replace: true }` with no `extraVariables`. Keep the `chapterReplaced → ctx.reload()` behaviour and do NOT clear the textarea.

## 4. Polish prompt template

- [x] 4.1 Update `plugins/polish/polish-instruction.md` to add a Vento `{{- if polish_instruction }} … {{- /if }}` branch (whitespace-trim markers) in BOTH the system block (honour-the-directive framing) and the user block (render the directive inside a `<polish_instruction>…</polish_instruction>` envelope ahead of `<draft>`). Ensure the without-directive branch is byte-for-byte the v1 prompt and that exactly one `{{ message "user" }}` block is emitted in every branch.
- [x] 4.2 Confirm SFW invariant in every branch (no `18+`, `NSFW`, `RPJB`, `no content restrictions`, `jailbreak`, `bypass`, `DO NOT DISCLOSE`, or age-disclaimer strings).
- [x] 4.3 Make `validateTemplate()` (writer/lib/template.ts SSTI whitelist) strip a single leading/trailing `-` (Vento trim marker) from each tag body before whitelist matching, so the trim-marked polish template passes the run-prompt route's `templateOverride` validation. Verify doubled markers (`{{-- … }}`) and member access still fail (no SSTI bypass). Add `validateTemplate` unit tests + a regression test asserting `validateTemplate(polish-instruction.md) === []` + an integration test rendering the real polish template through `renderSystemPrompt` with a directive. Fixes the HTTP 422 "Template rendering error" on every polish run carrying a directive.

## 5. Documentation

- [x] 5.1 Update `plugins/polish/README.md` (zh-TW): document that typing a directive in the chat textarea before clicking 潤飾 steers the rewrite, that an empty textarea uses the default polish, that the directive is passed via the `polish_instruction` prompt variable, and that the textarea is kept (not cleared) after a run. Update the file-structure list to include `frontend.js`.

## 6. Tests

- [x] 6.1 Add a frontend unit test asserting `useChatInput()` shares one `inputText` ref across two callers and that a write in one is visible to the other (live, without send).
- [x] 6.2 Add a frontend unit test for the story-switch leak case: type unsent text for story A, call `syncToStory(B)` (or simulate the active-story watch firing), and assert both the shared `inputText` and `getChatInputText()` observe story B's value (empty when B has no stored draft), never story A's text.
- [x] 6.3 Add a frontend unit test for the polish click handler: empty/whitespace input → `runPluginPrompt` called with NO `polish_instruction`; non-empty input → called with `extraVariables.polish_instruction` set to the trimmed value; textarea unchanged after run.
- [x] 6.4 Add a frontend unit test that a directive containing XML-like tags (e.g. `<emphasis>` or a literal `</draft>`) is passed through **verbatim** (trim-only, no escaping, no truncation) to `runPluginPrompt`.
- [x] 6.5 Add a Vento-render test (or extend an existing one) that asserts `polish-instruction.md` renders the directive inside the `<polish_instruction>` envelope when `polish_instruction` is set, and renders the v1 prompt with a valid user message when it is absent/empty.
- [x] 6.6 Add a golden-output test locking the no-directive render to be byte-for-byte identical to the current (pre-change) `polish-instruction.md` render baseline — not merely a presence/absence check.

## 7. Style gates and integration verification

- [x] 7.1 Run `deno task fmt` and `deno task lint`; fix any findings and commit results within this change.
- [x] 7.2 Run `deno task build:reader` (vue-tsc + Vite) and `deno task test:frontend`; ensure green.
- [x] 7.3 Mandatory container verification: `scripts/podman-build-run.sh`, then `podman logs heartreverie 2>&1 | grep -i "error\|warn"` is clean; via the reader at `http://localhost:8080/` (agent-browser) confirm: (a) typing a directive + clicking 潤飾 produces a steered rewrite and the textarea is retained; (b) empty textarea + 潤飾 produces the default rewrite. Only mark the change done after this passes.

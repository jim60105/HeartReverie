## Why

Today the **✨ 潤飾** action button always runs a fixed literary-rewrite prompt against the current chapter draft, giving the reader no way to steer the rewrite ("make it darker", "trim the dialogue", "emphasise the rain"). The chat textarea sits right above the button but its content never reaches a plugin action — the backend hard-codes `user_input` to the empty string for plugin-action runs (`writer/routes/plugin-actions-execute.ts`), and the textarea text is private component state inside `ChatInput.vue` that no composable, store, or `action-button:click` context can read. Letting users type a one-off directive and have 潤飾 honour it makes the feature dramatically more useful with a tiny, well-scoped surface change.

## What Changes

- The polish action button reads the **current** chat textarea content at click time. If it is non-empty, that text is injected into the polish prompt as a custom directive that steers the literary rewrite of the chapter draft; if empty, the existing default polish behaviour is preserved verbatim.
- Chat-input text is hoisted from a private `ref` inside `ChatInput.vue` into a new shared composable `useChatInput()` so other parts of the reader (the action bar) can read the live value. `ChatInput.vue` consumes the composable as the single source of truth for its `v-model`; all existing behaviour (sessionStorage persistence, autoresize, send/resend/continue, `appendText`) is preserved.
- The `action-button:click` context gains a read-only `getChatInputText(): string` accessor (curried per click, like `runPluginPrompt`/`notify`/`reload`) returning the live textarea value at the moment of the click.
- The bundled `polish` plugin's `frontend.js` calls `ctx.getChatInputText()`, trims it, and passes it through `runPluginPrompt(..., { extraVariables: { polish_instruction: <text> } })` (omitting the key when empty). The textarea is intentionally **NOT** cleared after a polish run.
- `polish-instruction.md` gains a Vento `{{ if polish_instruction }}` branch that surfaces the user directive in both the system framing and the user message when present, and renders exactly the v1 prompt when absent.
- The `polish` plugin manifest already declares `type: "full-stack"` with a `frontendModule`; no manifest shape change is required. `polish_instruction` is a fresh, non-reserved scalar `extraVariables` key (validated by the existing run-prompt route), so no backend route change is needed.

No backward-compatibility or migration handling is in scope — the project is pre-release with zero users.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities

- `chat-input`: Add a requirement that the chat textarea state is owned by a shared `useChatInput()` composable (single source of truth for the `v-model`, sessionStorage, and `appendText`), exposing a live read accessor for the current text so non-`ChatInput` consumers (the plugin action bar) can read freshly-typed-but-unsent text.
- `plugin-action-buttons`: Add `getChatInputText()` to the `action-button:click` context contract; extend the bundled `polish` plugin requirement so the button forwards the current chat-input text as the `polish_instruction` extra variable (empty → omitted, falling back to default polish behaviour), and so `polish-instruction.md` conditionally honours that directive. The plugin remains a `full-stack` plugin (it already ships a `frontendModule`).

## Impact

- **Frontend (reader-src/)**:
  - New `reader-src/src/composables/useChatInput.ts` (module-scoped reactive `inputText` + story-scoped sessionStorage helpers + `appendText`).
  - `reader-src/src/components/ChatInput.vue` — replace local `inputText` ref and sessionStorage helpers with the composable; keep `defineExpose({ appendText })`.
  - `reader-src/src/composables/usePluginActions.ts` — add `getChatInputText` to the dispatched `clickCtx`.
  - `reader-src/src/types/index.ts` — add `getChatInputText: () => string` to `ActionButtonClickContext`.
- **Bundled plugin (plugins/polish/)**:
  - `frontend.js` — read + trim chat input, pass `extraVariables.polish_instruction` when non-empty.
  - `polish-instruction.md` — add `{{ if polish_instruction }}` branch.
  - `README.md` — document the new typed-directive flow and the keep-text-after-run behaviour.
- **No backend change**: `polish_instruction` flows through the existing `extraVariables` channel of `POST /api/plugins/:pluginName/run-prompt`; it is non-reserved and scalar, so existing validation accepts it.
- **Tests**: frontend unit tests for `useChatInput` sharing semantics and for the polish click handler's empty/non-empty branching; Vento-render check that `polish_instruction` is honoured/omitted.

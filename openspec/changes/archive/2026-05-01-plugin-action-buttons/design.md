## Context

The plugin system currently surfaces capabilities to the frontend through three channels:

1. **Tag rendering** — Plugins extract custom XML tags from chapter Markdown and replace them with rendered HTML via the `frontend-render` hook (e.g., the `options` plugin renders `<options>…</options>` into a 2×2 button grid; the `state` plugin renders `<UpdateVariable>…</UpdateVariable>` into a collapsible details element).
2. **Prompt fragments** — Plugins inject Vento-template variables into `system.md` via the `promptFragments` manifest field.
3. **Side-effect hooks** — Plugins observe chat lifecycle stages (`prompt-assembly`, `response-stream`, `post-response`, etc.) via `FrontendHookDispatcher` / `HookDispatcher`.

What is missing is a **non-tag-anchored, user-initiated action** surface. The `options` plugin's clipboard-copy buttons exist only because that plugin chose to render its tag as buttons; the same plugin cannot place a "regenerate options" button that should be visible **even when the current chapter has no `<options>` block** (i.e., precisely the failure case the user wants to recover from). The `state` plugin has the same gap — its diff panel is rendered inline within a chapter's `<UpdateVariable>` block, so when the LLM forgets to emit a JSON patch, the user has no UI to ask the LLM to compute one retroactively.

The MainLayout currently composes (top-to-bottom): `AppHeader` (sticky, holds folder/story/settings/navigation controls) → `ContentArea` (chapter content + sidebar) → `UsagePanel` (collapsible token usage) → `ChatInput` (textarea + send/resend/stop, mounted only on the last chapter in backend mode).

There is a clear horizontal slot above `ChatInput` that is currently empty for plugin contributions; that's the natural location for a plugin action bar.

`useChatApi` already centralises LLM streaming, abort handling, and usage tracking. `executeChat()` in `writer/lib/chat-shared.ts` is the shared backend entry that both HTTP `/api/chat` and WebSocket `chat:send`/`chat:resend` route through; it builds the upstream LLM request body from a `ChatMessage[]`, streams the SSE response, dispatches `response-stream` per chunk, dispatches `post-response` on completion, and writes/appends to the chapter file.

Lore-codex retrieval, status-data injection, plugin prompt fragments, and the new `{{ message }}` multi-message tag all flow through `renderSystemPrompt()` in `writer/lib/template.ts` — that's the single rendering entry point we want plugin-owned prompt files to share.

## Goals / Non-Goals

**Goals:**

- Provide one extension axis (declarative + hook) that any plugin can use to contribute a button to the reader UI without touching core Vue components.
- Cover the most common click-callback shape — "render a plugin-owned `.md` template through the same prompt pipeline as `system.md`, send to the LLM, optionally append the wrapped output to the latest chapter, re-dispatch `post-response`" — as a built-in helper so plugin developers don't reimplement the chat plumbing.
- Keep the panel itself dead simple: it is a horizontal bar, buttons are flat, no submenus, no parameter dialogs in v1.
- Preserve the existing plugin contract (`export function register(hooks)`) — new hook stage and new manifest field are both additive.
- Make the new endpoint reuse `executeChat()` (or a small refactored core of it) so streaming, error mapping, abort, usage accounting, and lifecycle hooks behave identically to a normal chat send.
- Reuse the existing `streamingContent` / `isLoading` state in `useChatApi` so the UI feedback during a plugin-triggered LLM round is indistinguishable from a normal send.
- Each plugin's action button only fires that plugin's own hook handlers, not other plugins' (curry `pluginName` into the helper, filter handlers by manifest origin).

**Non-Goals:**

- Per-click parameter prompts / dialogs (e.g., "ask the user to type a hint before regenerating"). v1 is fire-and-forget; configurable via `runPluginPrompt` `extraVariables` field but with no built-in UI.
- Keyboard-shortcut bindings.
- Buttons in the `AppHeader`, sidebar, or rendered chapter HTML — those are different surfaces.
- Dynamic enable/disable based on chapter content (e.g., "only enable if no `<UpdateVariable>` exists in the last chapter"). The static `visibleWhen` enum covers the v1 use cases; predicate functions can be added in a later non-breaking extension.
- Buttons that target chapters other than the last one. Append-to-last-chapter is the only mode in v1; if a plugin wants to run a prompt without appending, it sets `append: false` and consumes the returned `content` itself.
- Cross-plugin button reordering or grouping — buttons are flat, sorted by `priority` (lower first) then by `(pluginName, declaration order)`.

## Decisions

### Decision 1 — Manifest field: `actionButtons: ActionButtonDescriptor[]`

**Shape:**

```ts
interface ActionButtonDescriptor {
  id: string;                                        // [a-z0-9-]+, unique within a plugin
  label: string;                                     // 1..40 chars, non-empty after trim
  icon?: string;                                     // optional emoji or short symbol prefix
  tooltip?: string;                                  // optional, 0..200 chars
  priority?: number;                                 // default 100; lower renders first
  visibleWhen?: "last-chapter-backend" | "backend-only";
                                                     // default "last-chapter-backend"
}
```

**Why a manifest field rather than runtime registration:**
- Symmetric with existing capabilities (`promptFragments`, `displayStripTags`, `frontendStyles`) — these are also declarative.
- The `GET /api/plugins` payload remains the single source of truth the frontend reads to know what a plugin contributes; no extra round-trip.
- Easier to reason about in tooling (the plugin-creation skill, future plugin marketplace, etc.).

**Why the v1 `visibleWhen` enum has only two backend-mode values:**
- All concrete v1 use cases (state, options) want exactly `last-chapter-backend`. The two-value enum covers the immediate need plus the obvious extension to "every chapter in backend mode" without forcing us to define FSA-mode click semantics.
- The click context exposes `series`, `name`, `storyDir`, `lastChapterIndex` and a backend-targeted `runPluginPrompt` helper. With only backend-mode enum values these fields are guaranteed defined; we don't have to widen them to nullable types now (which would be a breaking change to soften later).
- Adding an FSA-mode value later is non-breaking: introduce a discriminated companion field (e.g., `requiresBackend: false`) plus a separate FSA-action context shape with nullable backend fields. We don't pre-commit now.
- Dynamic predicates require either a string DSL (security risk re-runs SSTI concerns) or shipping handler code in `plugin.json` (mixes data and code). Better to defer.

**Validation rules** (enforced in `writer/lib/plugin-manager.ts`):
- `id`: required, `^[a-z0-9-]+$`, unique within the plugin's `actionButtons` array; duplicates are dropped (warn).
- `label`: required, non-empty after trim; longer than 40 chars is rejected (warn) to keep the bar usable on narrow screens.
- `priority`: if present, must be a finite number; otherwise default 100. `Infinity`/`NaN` rejected.
- `visibleWhen`: if present, must be one of the literal enum values; unknown values rejected and the entry dropped.
- Invalid entries are dropped individually, not the whole plugin — same forgiving approach as existing manifest fields.

### Decision 2 — Frontend hook stage: `action-button:click`

**Why a new stage instead of overloading `frontend-render`:**
- `frontend-render` runs once per chapter render; click events are unrelated to render lifecycle.
- A dedicated stage means handlers stay scoped to clicks and don't get accidental re-entry on every chapter switch.

**Context shape:**

```ts
interface ActionButtonClickContext {
  buttonId: string;
  pluginName: string;
  series: string;
  name: string;          // story name
  storyDir: string;      // for plugins that want to surface it in notify text
  lastChapterIndex: number | null;
  // Curried helpers — pluginName is bound:
  runPluginPrompt(promptFile: string, opts?: RunPluginPromptOptions): Promise<RunPluginPromptResult>;
  notify(input: { level: "info" | "warning" | "error"; title?: string; body: string }): void;
  reload(): Promise<void>;   // triggers useChapterNav.reloadToLast()
}
```

`appendToLastChapter` is intentionally **not** exposed in v1. The state and options use cases write to the chapter file via `runPluginPrompt({ append: true, appendTag })`, which carries the same `safePath` + `realPath` + auth + generation-lock + `appendTag` regex contract the route already enforces. Adding a free-form `appendToLastChapter(text)` would expose a parallel arbitrary-write surface to plugin code without that contract; we defer until a concrete use case justifies the extra surface and lets us specify validation rules side by side.

**Dispatch semantics:**
- Handlers are invoked in priority order (existing dispatcher contract).
- The stage is **async**: `dispatch()` collects every handler's return value and the caller awaits the aggregate via `Promise.all`. This is symmetric with how `chat:send:before` is treated as a pipeline stage; we extend the dispatcher to recognise `action-button:click` as awaiting all handlers.
- The bar holds a fully-qualified pending key `${pluginName}:${buttonId}` (NOT `buttonId` alone — two plugins can both declare `id: "refresh"`) until the aggregate settles, then clears it.
- Per-handler errors are caught (existing try/catch); if any handler rejected, the dispatcher surfaces a default `notify({ level: "error", … })` toast. Plugin developers should still wrap runtime errors in `try/catch` and emit user-facing notifications themselves — the default toast is a safety net.
- Origin filtering: the dispatcher only invokes handlers whose owning plugin matches `context.pluginName`. Implementation: each handler is registered with an `originPluginName` (auto-curried by the per-plugin proxy in `usePlugins.ts` — see Decision 6), and `action-button:click` dispatch filters `originPluginName === context.pluginName`. Other stages preserve existing behaviour (origin tracked but not filtered).

**Why curried helpers on the context:**
- `runPluginPrompt` already needs `pluginName` for path resolution — passing it through the context guarantees the plugin cannot accidentally trigger another plugin's prompts (no privilege escalation between plugins).
- `reload` is bound to the current series/story; the plugin doesn't need to read route state itself.
- `notify` re-exports the existing `useNotification` composable already used elsewhere — no new notification surface.

### Decision 3 — Backend route: `POST /api/plugins/:pluginName/run-prompt`

**Request body:**

```ts
interface PluginRunPromptRequest {
  series: string;
  name: string;                  // story name
  promptFile: string;            // relative to plugin dir
  append?: boolean;              // default false
  appendTag?: string;            // required when append=true; [a-zA-Z][a-zA-Z0-9_-]{0,30}
  extraVariables?: Record<string, string | number | boolean>;
                                 // exposed to Vento as extra dynamic variables
                                 // for the plugin prompt only (NOT system.md)
}
```

**Response body:**

```ts
interface PluginRunPromptResponse {
  content: string;                              // full LLM response, post-strip
  usage: TokenUsageRecord | null;               // same shape chat-done emits
  chapterUpdated: boolean;                      // true iff append succeeded
  appendedTag: string | null;                   // appendTag echoed when used
}
```

**Resolution rules:**
1. Auth (passphrase) required; same middleware as other authed routes. A new route-specific 30/min rate limiter (matching the chat route limit) gates the endpoint in addition to the global 300/min API limiter.
2. Validate `pluginName` against `isValidPluginName()`. If the name is syntactically invalid, return HTTP 400. If syntactically valid but no plugin with that name is in the loaded-plugin registry, return HTTP 404. Use distinct `plugin-action:invalid-plugin-name` (400) and `plugin-action:unknown-plugin` (404) Problem Details types.
3. Validate `series`/`name` via `isValidParam()`; resolve `storyDir` via `safePath(playgroundDir, series, name)`; require directory exists (404 otherwise).
4. Acquire the per-story generation lock atomically via a new `tryMarkGenerationActive(series, name): boolean` helper. If the lock cannot be acquired (an existing chat or plugin-action run is in flight), return HTTP 409 with `plugin-action:concurrent-generation` Problem Details and DO NOT touch the chapter file. Both the normal chat path and the new route MUST use the same atomic acquire helper. The lock is released in a `finally` block whether the run succeeds, errors, or aborts.
5. Validate `promptFile`: resolve absolute path with `safePath(pluginDir, promptFile)`; verify `Deno.realPath(pluginDir)` and `Deno.realPath(resolvedPromptFile)` to canonicalise both paths through any symlinks; reject if `!isPathContained(realPluginDir, realResolvedPromptFile)` or extension is not `.md` or the entry is not a regular file (`stat.isFile === false`). All rejections return HTTP 400 with RFC 9457 Problem Details type `plugin-action:invalid-prompt-path` (path violations) or `plugin-action:non-md-prompt` (extension violation) or `plugin-action:prompt-file-not-found` (ENOENT).
6. Validate `appendTag` (when `append: true`): regex `^[a-zA-Z][a-zA-Z0-9_-]{0,30}$`; missing or violation returns HTTP 400 with `plugin-action:invalid-append-tag`.
7. Validate `extraVariables`: object whose values are scalars only (`string | number | boolean`); reject any non-scalar value with `plugin-action:invalid-extra-variables` (HTTP 400). Reject any key collision with the system prompt variable map (e.g., `previousContext`, `lore_*`) with `plugin-action:extra-variables-collision` (HTTP 400).
8. Read the prompt file. Render it through the same `renderSystemPrompt()` entry point `system.md` uses, with `extraVariables` merged into the variable map under their request keys (collisions already rejected in step 7) AND with `user_input` defaulted to `""` so plugin prompts inherit the existing variable set without the request having to supply chat-style input.
9. **Plugin prompts MUST emit at least one `{{ message "user" }}…{{ /message }}` block.** The existing `assertHasUserMessage` guard in the rendering pipeline already enforces this and surfaces `multi-message:no-user-message` (HTTP 422) — this is the canonical failure for a plugin prompt that forgets to declare a user turn.
10. Call the refactored core helper extracted from `executeChat()` (see Decision 8) with the rendered messages, the resolved per-story LLM config, and a discriminated `writeMode`:
    - `write-new-chapter` — existing chat behaviour: open/truncate the next chapter file, dispatch `pre-write`, write each delta, dispatch `response-stream` per delta, dispatch `post-response` with `{ source: "chat" }`. Plugin actions never use this mode.
    - `append-to-existing-chapter` — used when `append: true`. Stream chunks accumulate in memory and are emitted to the WebSocket as `plugin-action:delta` envelopes (or buffered for the HTTP fallback). On stream completion, normalise the accumulated content (Decision 9), atomically append `\n<{appendTag}>\n{trimmed normalised content}\n</{appendTag}>\n` to the highest-numbered chapter file, then re-read the full chapter file and dispatch `post-response` with `{ content: <full chapter content after append>, chapterPath, chapterNumber, storyDir, series, name, rootDir, source: "plugin-action", pluginName, appendedTag }`. `pre-write` and `response-stream` are NOT dispatched in this mode (no per-delta chapter write happens). On abort, the append step is skipped and `post-response` is NOT dispatched.
    - `discard` — used when `append: false`. Stream chunks accumulate to a string returned in the response, are emitted as `plugin-action:delta` envelopes for live progress, but are NOT written to any chapter file. `post-response` is NOT dispatched (no chapter content changed). `pre-write` and `response-stream` are NOT dispatched.
11. Streaming protocol: when the request originates over WebSocket (the default frontend path), the server emits `plugin-action:delta`, `plugin-action:done`, `plugin-action:error`, and `plugin-action:aborted` envelopes typed in `writer/types.ts`. Each `:delta` envelope carries `{ correlationId, chunk }`; `:done` carries `{ correlationId, content, usage, chapterUpdated, appendedTag }`; `:error` carries `{ correlationId, problem }` (RFC 9457); `:aborted` carries `{ correlationId }`. On the HTTP fallback (no WS connection), the route does NOT emit per-delta progress; it returns the final JSON response only. The frontend `runPluginPrompt` adapter therefore depends on the WS connection for live `streamingContent` updates and silently degrades to "spinner only" on the HTTP path.
12. On any error before append, do not modify the chapter file; surface the error as RFC 9457 Problem Details with the appropriate `plugin-action:*` or `multi-message:*` type and emit `plugin-action:error` over WS.

**`appendTag` validation:** must match `^[a-zA-Z][a-zA-Z0-9_-]{0,30}$`. This is stricter than HTML tag rules but mirrors the regex we already use in display-strip patterns. Disallows angle brackets, slashes, dots, spaces — protects the chapter file from injection of attributes or nested wrappers.

**Path-traversal hardening:** the existing `safePath()` lexical guard is insufficient on its own because plugins (especially external `PLUGIN_DIR` plugins) may contain symlinks. The route therefore canonicalises both the plugin directory and the resolved prompt path through `Deno.realPath()` before the containment check. We additionally pin extension to `.md` so a misconfigured plugin can't ask the server to render `plugin.json` (information leak) and require `stat.isFile === true` to reject directory or device-file targets.

### Decision 4 — UI placement: bar between `UsagePanel` and `ChatInput`

**Why not in the header:** `AppHeader` is already crowded (folder picker, story selector, folder name, reload, settings cog, prev / chapter progress / next, hamburger). Adding a plugin slot there pushes existing controls onto a second row on narrower screens and makes the header less scannable.

**Why not in the sidebar:** the sidebar holds plugin-rendered content (state diff, options grid). Mixing per-chapter rendered content with global action buttons would conflate two different mental models.

**Why not inside `ChatInput`'s tools slot:** the slot already exists (line 73 of `MainLayout.vue`) — but `ChatInput` only renders when `showChatInput` is true (last chapter, backend mode). For `visibleWhen: "backend-only"` we need a surface that doesn't share `ChatInput`'s render gate.

**Therefore:** new `PluginActionBar.vue` mounted directly in `MainLayout`, with its own internal visibility gate that combines plugin-supplied `visibleWhen` with the route's current state. Because v1 only supports backend-mode `visibleWhen` values, the bar itself never renders in FSA mode.

### Decision 5 — Reuse `useChatApi` streaming state vs new composable

**Reuse:** `useChatApi.runPluginPrompt()` shares `isLoading`, `streamingContent`, `errorMessage`, and `abortCurrentRequest` with the regular send path. This means a plugin-triggered LLM round looks visually identical to a normal send and the user can stop it the same way. The trade-off is that the user can't trigger a plugin action while a normal send is in flight, and vice versa — `isLoading` is shared. For v1 that's acceptable: we don't want concurrent LLM rounds anyway (token cost, race conditions on chapter file, doubled `post-response` dispatches).

**Reject:** spawning a new composable with its own state ring would let two LLM rounds overlap, which immediately becomes a footgun for the chapter-file append path.

### Decision 6 — Hook origin filtering

`FrontendHookDispatcher.register()` will be extended to optionally accept the registering plugin's name — this is already implicit in the way `frontendHooks` is passed to `register(hooks)`, but currently the dispatcher doesn't track origin. We add `register(stage, handler, priority, originPluginName)` and have `usePlugins.ts` curry the `originPluginName` when wrapping `frontendHooks` per-plugin (similar to how the backend `HookDispatcher` already auto-binds plugin name via `PluginRegisterContext`).

For the `action-button:click` stage specifically, dispatch checks `originPluginName === context.pluginName` and only invokes matching handlers. For all other stages this is a no-op and existing behaviour is preserved (origin tracked but not filtered).

### Decision 7 — `extraVariables` typing

Restricted to JSON-serialisable scalars only (`string | number | boolean`). Rejecting objects/arrays keeps the surface small and avoids encoding ambiguity for Vento (`{{ var.foo }}` access on dynamic shapes is brittle and SSTI-adjacent). Plugins that need richer state should bake it into the prompt template itself or extend their backend module's `getDynamicVariables`.

`extraVariables` keys are checked for collision against the system prompt variable map BEFORE the merge. A collision (e.g., `extraVariables.previousContext`) returns HTTP 400 `plugin-action:extra-variables-collision` and the run does not start. This avoids silently shadowing critical values like `previousContext` or `status_data`.

### Decision 8 — Refactor `executeChat()` into a reusable LLM helper

`executeChat()` today is tightly coupled to writing a brand-new chapter file: it resolves the next chapter number, opens/truncates the file, dispatches `pre-write` once before streaming starts, writes every content delta to disk, dispatches `response-stream` per delta, and dispatches `post-response` with the new chapter's content/path/number. This shape is wrong for plugin actions: an `append-to-existing-chapter` run does not create a new chapter, MUST NOT write per-delta to disk (a partial stream would corrupt an existing chapter file mid-edit), and runs `post-response` only once at the end with full chapter content. A `discard` run never touches the file system at all.

We therefore extract a small core helper from `executeChat()` and refactor the existing entry to call it. The helper signature is:

```ts
async function streamLlmAndPersist(args: {
  messages: ChatMessage[];
  llmConfig: ResolvedLlmConfig;
  series: string;
  name: string;
  storyDir: string;
  rootDir: string;
  signal: AbortSignal;
  writeMode:
    | { kind: "write-new-chapter" }
    | { kind: "append-to-existing-chapter"; appendTag: string }
    | { kind: "discard" };
  onDelta: (chunk: string) => void;       // emits live progress to the caller
}): Promise<{
  content: string;                        // accumulated normalised content
  usage: TokenUsageRecord | null;
  chapterPath: string | null;             // for write-new-chapter & append modes
  chapterNumber: number | null;
  chapterContentAfter: string | null;     // for append mode (post-append re-read)
  aborted: boolean;
}>;
```

Hook dispatch is conditional on `writeMode.kind`:

| Hook | `write-new-chapter` | `append-to-existing-chapter` | `discard` |
|------|---------------------|------------------------------|-----------|
| `pre-write` | dispatched | NOT dispatched | NOT dispatched |
| `response-stream` (per delta) | dispatched | NOT dispatched | NOT dispatched |
| `post-response` | dispatched after stream completes (success); `content = chapter content`, `source = "chat"` | dispatched after successful append; `content = full chapter content after append`, `source = "plugin-action"`, `pluginName` set, `appendedTag` set | NOT dispatched |

Justification: the `pre-write`/`response-stream` hooks were designed for *the* per-chunk write-and-process pipeline; reusing them in modes that don't write deltas (or write them in a different shape) would feed plugins misleading `chapterPath`/`chapterNumber` and could trigger streaming side effects (e.g., real-time content compaction) on content that never lands in any chapter. Plugins that legitimately need per-delta visibility for plugin-action runs can be addressed in a future hook (`plugin-action:delta`) — out of scope for v1.

The append step uses the existing atomic-rename write helper used elsewhere in the codebase (write to a temp file in the same directory, fsync, rename). After the rename succeeds the route re-reads the chapter file and uses its full new content for the `post-response` dispatch — this guarantees `state` (and any other consumer) sees identical content semantics whether the patch came from a normal chat completion or a plugin-action append.

`executeChat()` is rewritten as a thin wrapper that calls `streamLlmAndPersist({ writeMode: { kind: "write-new-chapter" } })` and emits `chat:delta`/`chat:done` envelopes from the per-chunk callback. Existing chat behaviour and existing tests must remain green after this refactor.

### Decision 9 — Append normalisation: strip matching outer wrapper from model output

When `append: true` and the model emits its response wrapped in the same `<{appendTag}>…</{appendTag}>` pair the route is about to add (e.g., the model replies with a full `<UpdateVariable>{ patch }</UpdateVariable>` block when the prompt asks it to), the route's outer wrap would produce nested wrappers like `<UpdateVariable><UpdateVariable>…</UpdateVariable></UpdateVariable>` which break downstream extractors.

The route therefore normalises the accumulated content before wrapping:

1. Trim leading/trailing whitespace.
2. If the trimmed content matches `^<{escaped appendTag}\b[^>]*>([\s\S]*)</{escaped appendTag}>\s*$` (a single matching outer wrapper for that exact tag), strip exactly that one outer wrapper layer and use the inner content.
3. Re-trim and wrap with `\n<{appendTag}>\n{normalised content}\n</{appendTag}>\n`.

Only ONE outer wrapper layer is stripped (no recursion) so a model response that legitimately contains nested same-name elements is preserved. Tests cover (a) model emits no wrapper → wrapped once, (b) model emits exactly one outer wrapper → unwrapped then re-wrapped exactly once, (c) model emits two nested wrappers → outer stripped, inner preserved.

## Risks / Trade-offs

- **LLM cost amplification**: a plugin button that runs its own LLM round increases token spend per user interaction. Mitigation: visible streaming progress + abort button + the same usage tracker (`UsagePanel`) records the round so the user can see the cost impact in real time. Documentation makes this trade-off explicit.
- **Atomic append vs concurrent edits**: if a user clicks the action button while another tab is editing the same chapter, the append could land between an edit's read and write. Mitigation: reuse the existing `generation-registry` + atomic-rename write path used by chapter editing (and refuse to append while a generation is in flight, returning HTTP 409).
- **Chapter file growth from accidental clicks**: the `appendTag` wrapper makes accidental output identifiable and removable, but spam-clicking the button could write multiple identical `<UpdateVariable>` blocks. Mitigation: button is disabled during dispatch (per Decision 2), and the per-story LLM config's existing rate-limit middleware applies to the new route too.
- **Manifest field bloat**: `plugin.json` is gradually accumulating fields (`promptFragments`, `displayStripTags`, `promptStripTags`, `frontendStyles`, `tags`, `parameters`, now `actionButtons`). Mitigation: keep validation and types centralised in `plugin-manager.ts` + `types.ts`; document the field in the same section as the others rather than in a new doc.
- **Plugin prompt files vs `system.md` parity**: plugin prompts share the same Vento engine and dynamic variables as `system.md`, but they don't get any additional sandbox. A malicious plugin already has full backend access (it can register `prompt-assembly` hooks); the action-button route therefore doesn't materially expand the trust boundary, but it does expose a new code path. Mitigation: action-button prompts are only loaded by `pluginName` from the request, plugin-name validation is unchanged (`isValidPluginName`), and we keep the `safePath` + extension whitelist on `promptFile`.
- **Cross-plugin handler leak**: prior to Decision 6's origin filtering, a malicious plugin could subscribe to `action-button:click` and fire on every other plugin's button click. Origin filtering closes that, but only if `usePlugins.ts` correctly curries the origin into `register()` for every plugin module load. Tested explicitly in `plugin-hooks.test.ts`.
- **Visibility enum may grow into a predicate API anyway**: if state/options needs "only show when chapter has no `<UpdateVariable>` block" later, we'll need to widen the API. Pre-empting: the `visibleWhen` field is typed as a string union so adding new enum values is non-breaking; if we eventually need predicates we can introduce `visibleWhen: { kind: "predicate", … }` as a discriminated union without touching existing manifests.
- **Streaming abort semantics**: a plugin's prompt is mid-stream and the user clicks "stop". `executeChat()` already handles the abort path (via `AbortSignal`), but the new route's append step must not run if the stream was aborted. Mitigation: the `writeMode: "append-tag"` post-stream step checks the abort flag and skips on cancellation — verified in tests.
- **Discoverability**: plugin developers may not realise they can declare buttons. Mitigation: `docs/plugin-system.md` adds a worked example; the plugin-creation skill prompts about it; sample state/options PRs serve as templates.

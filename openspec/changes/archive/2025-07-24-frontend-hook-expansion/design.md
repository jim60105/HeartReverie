## Context

The HeartReverie frontend plugin system (`reader-src/src/lib/plugin-hooks.ts`, `reader-src/src/composables/usePlugins.ts`) loads plugin `frontend.js` modules at app startup, calls each plugin's `register(hooks)` function, and dispatches lifecycle events to registered handlers. Today only two stages exist:

- `frontend-render` — dispatched by `useMarkdownRenderer.renderChapter()` during markdown → HTML transformation so plugins can extract custom XML tags (e.g., `<thinking>`, `<user_message>`) into placeholders and return rendered HTML.
- `notification` — dispatched by `useChatApi.ts` on chat lifecycle events (`chat:done`, `chat:error`) so plugins can emit user-facing notifications via `ctx.notify()`.

Both stages are **informational** — handlers receive a context object and have no return-value contract. Context objects are mutable (plugins mutate `context.text`, `context.placeholderMap`), but the dispatcher itself always returns the same reference passed in.

Existing plugins:
- `plugins/thinking/frontend.js` and `plugins/imgthink/frontend.js` — use `frontend-render` to fold thinking/imgthink tags into collapsible `<details>` elements.
- `plugins/user-message/frontend.js` — extracts `<user_message>` blocks.
- `plugins/start-hints/frontend.js` — potentially surfaces hints in-app.

There is no way for a plugin to:
1. Rewrite the user's chat input before it leaves the browser (e.g., translate, slash-command expansion, macro substitution).
2. Mutate the rendered chapter output after markdown parsing (e.g., inject annotation overlays, decorate entities, attach tooltips).
3. React to story switches (e.g., reset plugin-local caches, prefetch per-story data).
4. React to chapter navigation (e.g., update a plugin-provided mini-map, track "last read").

The project has **zero external users** (per task brief), so no backward-compatibility shims are required; we can change the dispatcher's return-value contract cleanly.

## Goals / Non-Goals

**Goals:**
- Add four new frontend hook stages: `chat:send:before`, `chapter:render:after`, `story:switch`, `chapter:change`.
- Preserve the existing `register()` API shape — plugins continue to call `hooks.register(stage, handler, priority?)`.
- Allow `chat:send:before` handlers to **transform** the outgoing message text by returning a string from the handler (pipeline semantics). All other new stages remain informational (void return).
- Keep error isolation: a throw inside one handler MUST NOT stop other handlers from running, matching current behaviour in `FrontendHookDispatcher.dispatch()`.
- Ensure hook dispatch points in the core composables are placed so that plugin mutations take effect before the side-effect they target (e.g., `chat:send:before` dispatched strictly before both the WebSocket `chat:send` message and the HTTP POST fallback).

**Non-Goals:**
- No changes to backend hooks (`writer/lib/hooks.ts`) — scope is frontend only.
- No asynchronous hook handlers. All existing frontend handlers are synchronous (`HookHandler<T>` returns `void`); adding async support is a larger change and not needed by the target use-cases.
- No new plugin manifest fields. `frontendModule` continues to be the sole frontend integration point.
- No changes to `frontend-render` or `notification` semantics or context shapes.
- No ship-it-plugins in this change — only the extension points. New plugins that use these stages can be added in follow-up changes.

## Decisions

### Decision 1: Return-value contract for `chat:send:before` uses a dedicated dispatch path

`FrontendHookDispatcher.dispatch()` today returns the context untouched. For `chat:send:before` we need handlers to progressively rewrite `context.message`. Options considered:

- **A (chosen)**: Add a specialised code branch in `dispatch()` for `chat:send:before`: if the handler's return value is a string, assign it to `context.message` before calling the next handler. Other stages keep the current behaviour.
- **B**: Introduce a second method, e.g. `dispatchPipeline()`, and call it only for `chat:send:before`. Rejected: two methods increase API surface for plugin authors and core callers must remember which to use.
- **C**: Make every stage pipeline-capable by convention. Rejected: changes semantics of `frontend-render` and `notification` (handlers that accidentally return a truthy value would mutate shared state).

Rationale: option A is the smallest, most targeted change and keeps the `HookHandler<T>` type signature unchanged for existing stages. The `chat:send:before` handler type is widened to `(ctx) => void | string`.

### Decision 2: Hook context field naming — `previousIndex` / `index`

For `chapter:change` and `story:switch` we expose `previousX` and `X` fields so handlers can detect "from → to" transitions. Alternative was a single `index` plus a separate history ref; rejected because plugins would have to track history themselves.

### Decision 3: Dispatch `chapter:change` on initial load, not only on user navigation

When a story loads, `currentIndex` is set (usually to 0 or a resumed index). We dispatch `chapter:change` once the index is committed, with `previousIndex: null`. This gives plugins a single uniform path to react to "which chapter is visible now" instead of having to listen to both `story:switch` and a separate "first-chapter" event.

### Decision 4: `chapter:render:after` dispatches once per `renderChapter()` call (every chapter, not only the last)

Reason: plugins like "highlight character names" need to decorate every chapter, not only the active one. The context includes `isLastChapter` (already passed in `RenderOptions`) so plugins can gate behaviour themselves.

### Decision 5: Token array mutation model for `chapter:render:after`

`renderChapter()` returns `RenderToken[]`. We pass the array by reference on the context (`context.tokens`) and allow plugins to mutate it in place (push, splice, reassign `.content`). Alternative was returning a new array from the handler; rejected because it forces plugins to always construct a fresh array even for no-op inspection.

The array is mutated **after** the initial DOMPurify sanitization in `renderChapter()`. Because handler mutations occur outside the core sanitization pass, the dispatcher MUST re-sanitize any mutated token HTML through DOMPurify before `renderChapter()` returns the tokens to the caller. This closes the XSS regression that would otherwise arise if a plugin (maliciously or by accident) assigned unsanitized HTML — e.g., `<script>` tags, inline event handlers, `javascript:` URIs — into a token's `.content` field.

Concretely: `useMarkdownRenderer.renderChapter()` SHALL track which tokens (or which fields of which tokens) changed during the hook dispatch (by snapshotting references/content before dispatch and comparing after), and SHALL re-run DOMPurify on those changed HTML-bearing tokens with the same configuration used for the primary sanitization pass. Tokens that were not mutated are returned as-is (no wasted sanitization work). Plugins are still encouraged to sanitize their own HTML defensively, but the dispatcher provides the authoritative safety net and no plugin contract is relied upon to preserve the XSS guarantee.

Alternatives considered: (a) trust plugins to self-sanitize — rejected because it introduces a single point where any plugin bug becomes a reader XSS; (b) always re-sanitize the entire tokens array unconditionally — rejected as wasteful when no handler is registered or no mutation occurred; (c) forbid handlers from mutating `.content` and only allow adding wrapper decorations — rejected as too restrictive and still requires sanitization of the added wrappers.

### Decision 6: Dispatch `story:switch` from both `loadFromBackend()` and `loadFromFSA()`

Both entry points change the active story, so plugins must see both. The context exposes `mode: "fsa" | "backend"` so plugins can conditionally handle local-file mode (where `series`/`story` are absent).

### Decision 7: No new `VALID_STAGES` runtime check beyond the existing one

`FrontendHookDispatcher.register()` already guards against unknown stages with a `VALID_STAGES` set and a `console.warn`. We extend the set with the four new stage names; no new mechanism needed.

### Decision 8: Keep all existing singleton behaviours

`frontendHooks` remains a single process-wide singleton exported from `plugin-hooks.ts`. No changes to `usePlugins.initPlugins()` beyond the fact that plugin `register()` callbacks can now subscribe to the new stages.

## Risks / Trade-offs

- [Risk] **Plugin handler that returns a non-string from `chat:send:before` silently drops the transformation.** → Mitigation: in `dispatch()` only accept `typeof result === "string"` as a replacement; any other value is ignored. Document the contract explicitly in the spec scenario.
- [Risk] **Plugin handler in `chat:send:before` throws after partially mutating context** → handled by the existing try/catch in `dispatch()` — the error is logged via `console.error` and the next handler receives the current `context.message` (which may be the pre-throw mutation). This matches current `frontend-render` semantics and is acceptable.
- [Risk] **`chapter:change` firing too often causes performance regressions.** Handlers run on every next/previous navigation and on `chapters:content` WebSocket updates that change the index. → Mitigation: dispatch only when `currentIndex` actually changes (we already compare in the route watcher). Document that handlers must be cheap.
- [Risk] **`chapter:render:after` mutation could re-introduce XSS if a plugin injects unsanitized HTML into a token's `.content`.** → Mitigation: the dispatcher MUST re-run DOMPurify on any HTML-bearing tokens that were mutated (added, replaced, or had their `.content` changed) during the `chapter:render:after` hook dispatch, using the same configuration as the primary sanitization pass. This keeps sanitization authoritative in the core and does not rely on every plugin being written correctly. See Decision 5 for the implementation model.
- [Trade-off] **Synchronous-only handlers** constrain what `chat:send:before` can do (no await on network calls to transform messages). Acceptable for v1; async pipeline is a separate future change.
- [Trade-off] **No deduplication of dispatches.** `chapter:change` may fire twice in rapid succession (e.g., route watcher + index watcher). We'll use a single canonical dispatch site per state transition to avoid this, documented in tasks.

## Migration Plan

No external users, so no migration is needed. Follow-up documentation PRs will update `docs/plugin-system.md` and the `heartreverie-create-plugin` skill templates to describe the new stages. Existing bundled plugins (`thinking`, `imgthink`, `user-message`, `start-hints`, `context-compaction`) continue to work unchanged.

Rollback: revert the four dispatch call sites in `useChatApi.ts`, `useChapterNav.ts`, `useMarkdownRenderer.ts` and remove the four stage names from `VALID_STAGES`, `HookStage`, and `ContextMap`. No data migration.

## Open Questions

- Should `chat:send:before` context expose `series` / `story` (the current target)? Decided **yes** — useful for macros like `/whoami` and keeps the context self-contained without forcing plugins to read composables.
- Should `chapter:render:after` include the raw markdown text? Decided **no** — `frontend-render` already sees the raw text; `chapter:render:after` is about the token output stage specifically. Plugins needing raw text should use both hooks.

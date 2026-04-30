## Context

`reader-src/src/lib/markdown-pipeline.ts:normalizeQuotes()` is called unconditionally for every chapter render in `useMarkdownRenderer.renderChapter()` (line 113). It rewrites Unicode quote pairs into ASCII `"` so that a single CSS selector targeting `"…"` runs can colourize dialogue. Storage formats (chapter `.md` files, prompt assembly in `writer/lib/template.ts`, LLM request body in `writer/lib/chat-shared.ts`, story export in `writer/lib/export.ts`) all use the original characters; only the rendered HTML diverges.

The current behaviour is locked into the `md-renderer` spec (Requirement "Quote character normalisation", line 27) and exercised by six unit tests in `markdown-pipeline.test.ts`.

The CSS Custom Highlight API (`CSS.highlights` + `::highlight()`) lets JS register `Range` objects against a named highlight; the browser then paints those ranges according to a `::highlight(name)` rule in CSS. Crucially, **the DOM tree is not modified** — no elements are inserted, no text is mutated, copy/paste/find-in-page/screen-readers see clean text. Browser support: Chrome 105+ (Aug 2022), Safari 17.2+ (Dec 2023), Firefox 140+ (mid-2025). Older browsers receive a no-op fallback.

The existing frontend hook `chapter:render:after` runs while the renderer is still building the token list, BEFORE Vue commits `v-html` to the DOM, so it cannot expose live DOM nodes for `Range` construction. A new hook stage is required.

Verified facts about the codebase relevant to this change:
- Frontend plugins receive the hook dispatcher directly: `await mod.register(frontendHooks)` in `usePlugins.ts:115`. Handlers are registered as `register(hooks) { hooks.register('<stage>', …) }`.
- `HookDispatcher` sorts handlers ascending by priority (`a.priority - b.priority`); default priority `100`.
- `response-notify/plugin.json` (`type: "frontend-only"`) ships a frontend-only plugin with frontend module and CSS, so the loader accepts `frontend-only` for our shape.
- `ChapterContent.vue` renders chapter tokens via a `<template v-for>` whose `:key` is `\`${idx}-${renderEpoch}\``, all sibling under a `<div class="chapter-content">` root. That root element is the natural per-chapter container for `chapter:dom:ready` dispatch.

## Goals / Non-Goals

**Goals:**
- Preserve the original quote characters in rendered HTML and DOM (no replacement, no removal, no element insertion).
- Provide a built-in plugin that visually distinguishes dialogue runs via CSS, driven by `Range` objects registered to named `Highlight` instances.
- Keep the wrapping logic robust against existing DOM emitted by the chain `marked` → DOMPurify → Vue v-html (no element insertion, no `innerHTML` writes, no interference with other plugins observing the DOM).
- Match every quote pair `normalizeQuotes()` previously normalized (`"…"`, `"…"`, `«…»`, `「…」`, `｢…｣`, `《…》`).
- Provide a new generic frontend hook stage `chapter:dom:ready` that any plugin can use to inspect live DOM after a chapter render commits (not just dialogue colorization).
- Cover the plugin and the new hook stage with unit tests at the same fidelity that `markdown-pipeline.test.ts` covered `normalizeQuotes()`.

**Non-Goals:**
- Internationalised opening/closing rules per locale. Pair detection is purely character-level.
- Locale-specific European pairs `„…"` / `„…"`. The German low quote `U+201E` was previously normalized as a singleton; pair recognition for it is **deferred** because both potential closers (`U+201C` and `U+201D`) are already used by other pairs in the matched set.
- The CJK white square brackets `『…』`. Previously not handled by `normalizeQuotes()`; deferred.
- Nested-quote handling. With the leftmost-longest single-pass rule (Decision 3), the outer pair wins and the inner pair of a different supported type is not separately highlighted. Documented behaviour, not an accident.
- Highlighting unmatched orphan quotes. Only properly closed runs are highlighted.
- User-configurable colour themes in this change. The CSS ships one default colour driven by `var(--dialogue-color, …)`; theming is left to a future change.
- Backwards-compatibility shim for code still importing `normalizeQuotes`. The function is removed outright (per project policy, 0 users in the wild).
- Highlight effects beyond `color`, `background-color`, `text-decoration`, and `text-shadow`. The Custom Highlight API does not support layout-affecting properties (margin, padding, border, etc.); this plugin uses `color` only.

## Decisions

### Decision 1: Use the CSS Custom Highlight API instead of DOM mutation

The plugin builds `Range` objects pointing at the live text nodes inside the chapter container, registers them on per-suffix `Highlight` instances, and stores the registry on `CSS.highlights`. Painting is performed by the browser via `::highlight(dialogue-quote-<suffix>) { color: … }` rules in `styles.css`.

**Why over span wrapping:**
- No DOM modification, so no interference with copy/paste, find-in-page, screen readers, or other plugins that observe the rendered DOM.
- No need to round-trip through DOMPurify or worry about resanitization.
- No serialisation/deserialisation cost (the previous span-wrapper design parsed and reserialised every `html` token's content).
- Highlights stack naturally: another future plugin painting the same range with `background-color` will compose, not collide.

**Trade-offs accepted:**
- Browser baseline rises to Chrome 105 / Safari 17.2 / Firefox 140; older browsers see uncoloured (but otherwise correct) text.
- The Custom Highlight API only supports paint properties; we cannot add a border or padding to a dialogue run. Acceptable: the goal is colour only.

### Decision 2: New frontend hook stage `chapter:dom:ready`

`chapter:render:after` fires inside `useMarkdownRenderer.renderChapter()`, before tokens become live DOM. To get live `Text` nodes for `Range` construction, plugins need a hook that fires AFTER Vue commits the v-html update.

We add a new stage `chapter:dom:ready` with context:

```ts
interface ChapterDomReadyContext {
  container: HTMLElement;        // the chapter root (div.chapter-content)
  tokens: RenderToken[];          // same array passed to chapter:render:after, for cross-reference
  rawMarkdown: string;
  chapterIndex: number;
}
```

`ChapterContent.vue` dispatches it via a `watch([tokens, renderEpoch], …, { flush: "post", immediate: true })` so it fires (a) once on mount after the initial v-html commit and (b) on every subsequent render-epoch bump or token change. The `flush: "post"` option ensures the watcher runs AFTER Vue's DOM patch.

**Why a new hook (not `MutationObserver`, not `nextTick` from `chapter:render:after`):**
- A `MutationObserver` set up in `register()` would need a global root and is hostile to Vue's render lifecycle.
- Calling `nextTick` from inside `chapter:render:after` would lose access to the specific chapter's container element (the renderer composable doesn't know its consumer).
- A first-class hook with the live container as context is the cleanest abstraction and benefits any future "annotate the rendered DOM" plugin.

### Decision 3: Match resolution is leftmost-longest, single pass, non-overlapping

For each text node visited via `TreeWalker(SHOW_TEXT)`:
1. Run each of the six pair regexes independently and collect all candidate matches as `{ start, end, suffix }` triples.
2. Sort by `start` ascending, then by `end - start` descending (longest wins on ties).
3. Sweep left-to-right keeping the next match whose `start >= previousMatch.end`; discard overlapping matches.
4. For each surviving match, build a `Range` whose start is `(textNode, start)` and end is `(textNode, end)`.

Properties:
- A nested case like `「她說『…』」` yields one outer corner highlight; the inner `『…』` is not in our supported set anyway.
- A symmetric ASCII case `"foo" bar "baz"` yields two non-overlapping highlights.
- A degenerate case `"a "b" c"` yields one highlight `"a "` then orphan text.

### Decision 4: Quote pairs and Highlight registry names

| Opener | Closer | Suffix | Highlight registry name |
|--------|--------|--------|-------------------------|
| `"` (U+0022) | `"` (U+0022) | `straight` | `dialogue-quote-straight` |
| `"` (U+201C) | `"` (U+201D) | `curly` | `dialogue-quote-curly` |
| `«` (U+00AB) | `»` (U+00BB) | `guillemet` | `dialogue-quote-guillemet` |
| `「` (U+300C) | `」` (U+300D) | `corner` | `dialogue-quote-corner` |
| `｢` (U+FF62) | `｣` (U+FF63) | `corner-half` | `dialogue-quote-corner-half` |
| `《` (U+300A) | `》` (U+300B) | `book` | `dialogue-quote-book` |

For symmetric pairs (ASCII straight only) the regex `/"([^"\n]+?)"/g` consumes opener…body…closer in one match (first-quote-is-opener convention). For asymmetric pairs the regex is `/<open>([^<close>\n]+?)<close>/g`. Body length must be ≥1; empty pairs (`""`, `「」`) are skipped.

The CSS file declares per-suffix rules:

```css
::highlight(dialogue-quote-straight),
::highlight(dialogue-quote-curly),
::highlight(dialogue-quote-guillemet),
::highlight(dialogue-quote-corner),
::highlight(dialogue-quote-corner-half),
::highlight(dialogue-quote-book) {
  color: var(--dialogue-color, <theme-default>);
}
```

Per-suffix rules let downstream stylesheets override individual pair colours later.

### Decision 5: Highlight registry lifecycle

The plugin maintains six module-scoped `Highlight` instances (one per suffix), created lazily on first dispatch. On every `chapter:dom:ready` dispatch:

1. Look up the chapter container's previously-registered ranges via a `WeakMap<HTMLElement, Range[]>` keyed by container.
2. For each previously-registered range belonging to that container, call `highlight.delete(range)` on the appropriate suffix's `Highlight`.
3. Walk the container with `TreeWalker(SHOW_TEXT)`, computing fresh ranges using the leftmost-longest rule.
4. Add fresh ranges to the appropriate suffix's `Highlight` and store them in the `WeakMap` for the next dispatch.
5. Re-call `CSS.highlights.set(name, highlight)` once per suffix only when its highlight was just created (idempotent for established names; the `Highlight` object is the same reference across dispatches, so its membership changes are seen automatically by the browser).

Properties:
- Ranges from removed chapter containers garbage-collect with the container (the `WeakMap` releases them).
- Re-renders of the same container correctly clear old ranges before adding new ones, so no stale highlights persist on edited or rewound chapters.
- Multiple chapters render simultaneously; each gets its own ranges in the same global `Highlight`, which is the API's intended model.

### Decision 6: TreeWalker filter (ancestor exclusions)

The `TreeWalker(SHOW_TEXT)` filter rejects text nodes whose ancestor chain includes any of `<code>`, `<pre>`, `<kbd>`, `<samp>`. This prevents code samples (rare but possible in interactive fiction prose) from being treated as dialogue.

No exclusion is needed for "text already inside a `dialogue-quote` span" because the plugin never inserts spans.

### Decision 7: Browser-support fallback

At plugin module load time the `register()` function checks:

```js
const supported =
  typeof CSS !== "undefined" &&
  typeof CSS.highlights !== "undefined" &&
  typeof Highlight !== "undefined";
```

If `supported === false`, `register()` SHALL register no handler and emit one `logger.info` message (via the `PluginRegisterContext.logger`). Behaviour is otherwise identical to the plugin being absent. Users on legacy browsers see uncoloured but otherwise correct text.

### Decision 8: Plugin scaffolding

```
plugins/dialogue-colorize/
  plugin.json          # name, type=frontend-only, frontendModule, frontendStyles
  frontend.js          # registers chapter:dom:ready handler, manages Highlights
  styles.css           # ::highlight(dialogue-quote-*) { color: var(--dialogue-color, …) }
  README.md            # zh-TW user docs
```

### Decision 9: Spec scope

This change touches four specs:

- `md-renderer` (modified): remove `Quote character normalisation`; add `Quote character preservation`.
- `plugin-hooks` (modified): add the new stage `chapter:dom:ready` to the hook-stages requirement.
- `vue-component-architecture` (modified): add a new requirement that `ChapterContent.vue` dispatches `chapter:dom:ready` after each v-html commit.
- `dialogue-colorize-plugin` (new): full capability spec for the plugin.

## Risks / Trade-offs

- **[Risk] Custom Highlight API not yet shipped in the user's browser.** Mitigation: explicit feature-detection at `register()` time (Decision 7); plugin is a no-op when unsupported. Smoke-test plan covers the no-op path on a deliberately-disabled-API page.
- **[Risk] jsdom (used by vitest) does not implement `CSS.highlights` or the `Highlight` constructor.** Mitigation: unit tests stub `globalThis.CSS = { highlights: { set: vi.fn(), … } }` and `globalThis.Highlight = class { … }` before importing the module, then assert the plugin called `set` with the right names and that ranges have correct text offsets. Integration tests covering the no-op fallback simply omit the stub.
- **[Risk] `flush: "post"` watcher fires before the browser paints.** That is fine — the DOM is committed before the post-flush phase; only paint is deferred. Ranges are valid as soon as the DOM commits.
- **[Risk] Visual regression for users who expected ASCII-only dialogue.** Mitigation: pre-release rebuild + agent-browser smoke test on a representative chapter that contains all six pair types; the test verifies highlights apply AND original characters render unchanged.
- **[Risk] Streaming partial pairs.** During streaming the closer may not yet have arrived. The handler requires both opener and closer in the same text node; partial pairs are simply not highlighted on the partial render and become highlighted on the next render that includes the closer. Brief uncoloured flash of opening character is acceptable.
- **[Risk] Range invalidation on edit/rewind.** The recent `renderEpoch` `:key` fix in `ChapterContent.vue` means edited chapters get fresh DOM nodes. Old ranges, if not deleted, would point to detached nodes (harmless, but accumulates). Mitigation: Decision 5's WeakMap-keyed cleanup deletes prior ranges for the same container before adding new ones.
- **[Risk] Removing `normalizeQuotes` outright.** Per `tmp/propose.md`, no migration concern. Any external consumer breaks at compile time, surfacing the change cleanly.
- **[Risk] Plugin runs on every render commit during streaming, which is frequent.** Mitigation: the handler short-circuits when `container.textContent.length === 0` or contains none of the six opener characters (one `String.prototype.includes` per opener as a fast path). The TreeWalker pass is O(n) on text content; profiling will confirm sub-millisecond costs on typical chapters.

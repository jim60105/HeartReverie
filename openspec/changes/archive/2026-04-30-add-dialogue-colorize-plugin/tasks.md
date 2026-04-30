## 1. Remove the legacy `normalizeQuotes` path

- [x] 1.1 Delete the `normalizeQuotes` export, its JSDoc, and its regex from `reader-src/src/lib/markdown-pipeline.ts`
- [x] 1.2 Remove the `normalizeQuotes` import and call site (line ~113) from `reader-src/src/composables/useMarkdownRenderer.ts`
- [x] 1.3 Remove the `normalizeQuotes` `describe` block and its individual tests from `reader-src/src/lib/__tests__/markdown-pipeline.test.ts`
- [x] 1.4 Run `deno task test:frontend` and confirm the remaining markdown-pipeline tests still pass

## 2. Add the `chapter:dom:ready` hook stage

- [x] 2.1 In `reader-src/src/lib/plugin-hooks.ts`, add `ChapterDomReadyContext` interface (`{ container: HTMLElement; tokens: RenderToken[]; rawMarkdown: string; chapterIndex: number }`); extend the `FrontendHookContexts` map with `"chapter:dom:ready": ChapterDomReadyContext`; add `"chapter:dom:ready"` to `KNOWN_FRONTEND_STAGES`
- [x] 2.2 In `reader-src/src/types/index.ts`, add `"chapter:dom:ready"` to the `FrontendHookStage` union (currently lines 215–224)
- [x] 2.3 In `reader-src/src/components/ChapterContent.vue`, add a `watch([() => props.tokens, renderEpoch], (newVals, oldVals, onCleanup) => { … }, { flush: "post", immediate: true })` that captures the chapter root container element via `templateRef` (or by querying the component's root element), and dispatches `frontendHooks.dispatch("chapter:dom:ready", { container, tokens, rawMarkdown, chapterIndex })`. Suppress dispatch in edit mode
- [x] 2.4 Confirm via test that the dispatch fires on initial mount, on `bumpRenderEpoch()`, and on token-prop changes; does NOT fire while edit mode is active; fires once after cancel-edit re-mounts the v-html template
- [x] 2.5 Add a unit test in `reader-src/src/lib/__tests__/plugin-hooks-new-stages.test.ts` (or a fresh file) verifying handlers registered via `dispatcher.register("chapter:dom:ready", …)` are invoked exactly once per `dispatcher.dispatch("chapter:dom:ready", …)` call with all four context fields

## 3. Scaffold the `dialogue-colorize` plugin

- [x] 3.1 Create directory `plugins/dialogue-colorize/` with files `plugin.json`, `frontend.js`, `styles.css`, `README.md`
- [x] 3.2 Author `plugin.json` declaring `name: "dialogue-colorize"`, `version`, `description`, `type: "frontend-only"`, `frontendModule: "./frontend.js"`, and `frontendStyles: ["./styles.css"]`; do NOT declare `tags`, `displayStripTags`, `promptFragments`, or `backendModule`
- [x] 3.3 Boot the dev server and confirm `PluginManager` discovers the plugin without warnings; confirm `GET /plugins/dialogue-colorize/styles.css` serves with `Content-Type: text/css` and the manifest endpoint includes the plugin

## 4. Implement the frontend handler

- [x] 4.1 In `frontend.js`, export `function register(hooks, context)` that:
  - feature-detects `globalThis.CSS?.highlights` AND `typeof Highlight === "function"`
  - if unsupported, calls `context.logger.info("CSS Custom Highlight API unavailable; dialogue-colorize is a no-op on this browser")` and returns without registering
  - if supported, calls `hooks.register("chapter:dom:ready", handler)` at default priority 100
- [x] 4.2 Define module-scoped state: a `Map<suffix, Highlight>` for the six suffixes (lazily populated on first run, each registered via `CSS.highlights.set("dialogue-quote-<suffix>", highlight)`), and a `WeakMap<HTMLElement, Array<{ suffix: string; range: Range }>>` for per-container range bookkeeping
- [x] 4.3 Implement the handler `(ctx) => { … }`:
  - read `container` from ctx
  - retrieve the previous range list for `container` from the WeakMap; for each `{ suffix, range }`, call `highlights.get(suffix).delete(range)`
  - run a fast-path early return if `container.textContent` does not contain ANY of the six opener characters (single `String.prototype.includes` per opener)
  - walk text nodes via `document.createTreeWalker(container, NodeFilter.SHOW_TEXT, { acceptNode })` where `acceptNode` walks the ancestor chain (stopping at `container`) and rejects if any element matches `code|pre|kbd|samp`
  - for each accepted text node, run all six pair regexes, collect `{ start, end, suffix }` matches, sort and sweep for leftmost-longest non-overlapping
  - for each surviving match, build `range = new Range(); range.setStart(textNode, start); range.setEnd(textNode, end);` and add to the appropriate suffix's `Highlight`
  - store the new `[{ suffix, range }, …]` list in the WeakMap under `container`
- [x] 4.4 Verify via test that the handler never calls `innerHTML`, never modifies `tok.content`, and produces the correct ranges for all the spec scenarios

## 5. Style the dialogue runs

- [x] 5.1 In `styles.css`, define the six `::highlight(dialogue-quote-<suffix>)` rules (chained via comma) with `color: var(--dialogue-color, <theme-default>);`, picking the default colour from `reader-src/src/styles/theme.css`
- [x] 5.2 Verify the colour passes minimum WCAG AA contrast against the reader's main background (manual check or contrast-tool)

## 6. Plugin tests

- [x] 6.1 Create `tests/plugins/dialogue-colorize/highlight-ranges_test.ts` covering: each of the six supported pairs produces one range under the correct registry name; lone `„` produces no range; quotes inside `<a href="…" title="…">` produce no ranges (only the visible text yields a range); pair spanning `<br>` produces no range; empty body produces no range; nested supported pair (`「outer "inner" outer」`) yields outer-only range; `<code>` and `<pre>` content produces no ranges; re-dispatch on the same container clears prior ranges before adding new ones
- [x] 6.2 Tests SHALL stub `globalThis.CSS = { highlights: new Map() }` and `globalThis.Highlight = class { add(){…}; delete(){…} }` (or equivalent) before importing the plugin module so the feature-detect succeeds in jsdom; assert `set`/`add`/`delete` are called with the expected arguments
- [x] 6.3 Create `reader-src/src/composables/__tests__/ChapterContent-dom-ready.test.ts` (mounting `ChapterContent.vue` with the existing test-utils setup) verifying:
  - `chapter:dom:ready` fires once on initial mount with the live root element
  - it fires again after `renderEpoch.value++`
  - it does NOT fire while the edit textarea is shown
  - it fires after exiting edit mode and re-mounting the v-html template
- [x] 6.4 Add a regression test asserting `markdown-pipeline.ts` no longer exports `normalizeQuotes` (e.g., assert `expect("normalizeQuotes" in markdownPipeline).toBe(false)`)
- [x] 6.5 Add a no-op-fallback test that strips `globalThis.CSS.highlights` and `globalThis.Highlight`, imports the plugin, calls `register(mockHooks, { logger })`, and asserts no handler is registered AND `logger.info` is called once

## 7. Documentation

- [x] 7.1 Author `plugins/dialogue-colorize/README.md` in zh-TW following the chinese-content-writing-guideline (no banned phrases, no em-dashes); cover purpose, manifest excerpt, hook stage `chapter:dom:ready`, supported pair table, CSS theming via `--dialogue-color`, browser support note, deferred items (`„…`, `『…』`)
- [x] 7.2 Update `AGENTS.md`:
  - add `dialogue-colorize/` under built-in plugins in the `## Project Structure` section
  - update the prose summary that says "There are 6 built-in plugins" to "There are 7 built-in plugins"
  - extend the hook-stages bullet list under "Plugin System" to add `chapter:dom:ready` between `chapter:render:after` and `story:switch`
- [x] 7.3 If `docs/plugin-system.md` enumerates built-in plugins or hook stages, add `dialogue-colorize` and `chapter:dom:ready` there too

## 8. Container & end-to-end smoke test

- [x] 8.1 Build and run via `scripts/podman-build-run.sh`
- [x] 8.2 Use the `agent-browser` skill to load `https://localhost:8443/`, authenticate with the local passphrase, navigate to a chapter that exercises every supported pair (write a small fixture chapter under an existing series if needed), and confirm:
  - the rendered DOM contains the original quote characters byte-for-byte (verify via `agent-browser eval` reading `outerHTML`)
  - selected/copied dialogue text contains only the original characters (verify via clipboard or selection text)
  - the visible quote runs are coloured (verify via `agent-browser eval` reading computed style `getComputedStyle(textNode).color` is not the inherited paragraph colour, OR by snapshotting a screenshot)
  - the reader view does not throw runtime errors and other plugins (thinking, options, status, etc.) still render normally
  - editing a chapter and saving (or cancelling) re-applies highlights without leaving stale colour from the prior render
- [x] 8.3 Tear down the container after smoke testing

## 9. Spec validation and rubber-duck review

- [x] 9.1 Run `openspec validate add-dialogue-colorize-plugin --strict` and ensure it passes
- [x] 9.2 Run the full backend + frontend test suites (`deno task test`) and the plugin tests (`deno test --allow-read --allow-write --allow-env --allow-net tests/plugins/`)
- [x] 9.3 Per `tmp/propose.md`'s "call rubber-duck once after the whole proposal is done" instruction, the rubber-duck pass already ran during proposal authoring; if the implementation diverges materially from the design, run one additional sync rubber-duck pass focused on the implementation

## Context

The reader frontend uses a manifest-driven plugin system. Each plugin's `frontend.js` registers handlers on the global `frontendHooks` dispatcher (`reader-src/src/lib/plugin-hooks.ts`). The two stages relevant to chapter rendering are:

- `frontend-render` — runs **inside** `useMarkdownRenderer.renderChapter()`, before `marked.parse()`. Plugins extract their custom XML blocks (e.g. `<status>`), render them to HTML strings, and stash placeholders in `context.placeholderMap`. If a handler is not registered when this dispatch runs, the corresponding tags are passed through to `marked` and DOMPurify, which strip or escape them.
- `chapter:render:after` — runs at the end of `renderChapter()` and lets plugins mutate the `RenderToken[]` array. Re-sanitization is enforced for any HTML token that was added or whose `.content` changed.

`renderChapter()` is invoked from a Vue `computed()` inside `ChapterContent.vue` whose dependencies are `props.rawMarkdown` (sourced from `useChapterNav().currentContent`), `props.isLastChapter`, and `chapters[currentIndex].stateDiff`. The component itself is mounted by `ContentArea.vue` with `v-if="currentContent"`.

`ContentArea.vue` additionally runs a `watchPostEffect` that **physically relocates** every `.plugin-sidebar` DOM node from inside `<ChapterContent>` into the `<Sidebar>` element. The effect's tracked dependencies today are only `currentContent.value` and `isLastChapter.value`. The `status` plugin produces panels with class `plugin-sidebar`, so this relocation is the contract that makes the panel actually appear in the sidebar.

Plugin loading happens in `usePlugins.initPlugins()` via `fetch('/api/plugins')` followed by parallel dynamic `import()` of every backend-listed `frontend.js`. Today the function:

- Has only an `if (initialized.value) return;` guard — two concurrent callers can race and double-register handlers.
- Calls `mod.register(frontendHooks)` synchronously and discards any returned promise — async `register()` functions are not honored.
- Silently swallows fetch and import errors (`try/catch { /* silently ignore */ }`), so a transient `/api/plugins` failure produces a "no plugins" experience with no user-visible signal.

App boot sequence today (relevant excerpt of `App.vue`):

```ts
async function handleUnlocked() {
  await Promise.all([initPlugins(), applyBackground()]);
  connect(`${proto}//${host}/api/ws`, passphrase.value);
  if (series && story) {
    await loadFromBackend(series, story, startChapter);
    return;
  }
  // FSA restore...
}
```

`PassphraseGate` flips `isAuthenticated` to `true` and emits `unlocked` in the **same tick**. `<router-view />` mounts after `nextTick`. `currentContent` starts as the empty string, so `ChapterContent` is gated by `v-if="currentContent"` and does not mount until `loadFromBackend` commits content. In the **current code path**, `Promise.all([initPlugins(), …])` is awaited *before* `loadFromBackend()`, so plugins should be registered before `currentContent` is set. The "reload race" path is therefore not yet proven to fire in production.

Edit-save sequence today (relevant excerpt of `ChapterContent.vue`):

```ts
async function saveEdit(): Promise<void> {
  await editChapter(...);
  isEditing.value = false;
  await reloadToLast();        // jumps to the LAST chapter, not the edited one
}
```

`reloadToLast()` reloads chapters via `loadFromBackendInternal()` (which assigns a fresh array to `chapters.value`) and then sets `currentContent.value = chapters.value[lastIdx].content`. Two distinct symptoms follow:

1. The user has been silently teleported to a different chapter than the one they were editing.
2. Vue's reactivity for primitive refs is `Object.is`-equality based: assigning the same string to `currentContent` does not trigger dependents. Even when the `tokens` computed does re-run (because content differs), the **sidebar relocation effect** does not necessarily re-run, because its dependencies are `currentContent` and `isLastChapter` — both of which can be unchanged across an edit-save reload that lands on the same chapter the user was already on.

## Goals / Non-Goals

**Goals:**
- Eliminate the **confirmed** edit-save bugs: jumping to the wrong chapter and the byte-identical-content invalidation gap.
- Eliminate the **confirmed** sidebar relocation staleness — `.plugin-sidebar` content produced after any chapter content change MUST end up inside `<Sidebar>`.
- Provide a deterministic readiness gate so any chapter view, in any navigation path, always renders against a populated plugin hook registry.
- Make plugin-load failures observable rather than silent, while still allowing the page to render without plugins (matching today's "no plugins" path in the renderer).
- Add instrumentation that confirms or rules out the suspected reload race **before** any deeper refactor of deep-link load ownership.
- Keep the public hook surface (`HookStage`, context shapes, registration order) unchanged so existing third-party plugins continue to work.

**Non-Goals:**
- No backend changes. The chapter-edit, rewind, branch, and chat endpoints stay exactly as they are.
- No change to the plugin manifest schema, plugin loading order, or hook dispatch semantics.
- No migration tooling, deprecation shims, or compatibility flags — the project has zero deployed users.
- No redesign of the FSA (File System Access) reading path beyond what the readiness gate uniformly applies.
- **No deep-link route-watcher refactor in the initial implementation.** That refactor is risky (introduces new races with mid-load route changes and other `loadFromBackend` callers like branch). It is gated behind Phase 2: only proceed if instrumentation confirms a residual reload race after Phase 1.

## Decisions

### Decision 1: `pluginsSettled` gate (correctness) and `pluginsReady` signal (diagnostic)

`usePlugins` exposes two reactive flags:

```ts
const pluginsReady = ref(false);     // true only on full success
const pluginsSettled = ref(false);   // true after init runs (success or failure)
let initPromise: Promise<void> | null = null;

async function initPlugins(): Promise<void> {
  if (pluginsSettled.value) return;
  if (initPromise) return initPromise;

  initPromise = doInit();
  try {
    await initPromise;
    pluginsReady.value = true;
  } catch (err) {
    // Surface failure via the existing notification toast composable, log
    // the error, and proceed — chapter rendering continues with the empty
    // hook set, matching the existing "no plugins registered" path in the
    // md-renderer spec.
    notifyPluginLoadFailure(err);
  } finally {
    pluginsSettled.value = true;
  }
}

async function doInit(): Promise<void> {
  const res = await fetch("/api/plugins", { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list: PluginDescriptor[] = await res.json();
  // ...inject styles, compile strip patterns...
  await Promise.all(list.filter(p => p.hasFrontendModule).map(async (p) => {
    const mod = await import(/* @vite-ignore */ `/plugins/${p.name}/frontend.js`);
    if (typeof mod.register === "function") {
      await Promise.resolve(mod.register(frontendHooks));   // honor async register
    }
  }));
  plugins.value = list;
}
```

`ContentArea.vue` gates `<ChapterContent>` on `pluginsSettled && currentContent` (rather than `pluginsReady`) so a plugin-load failure does not permanently hide the chapter — it is still rendered, just without plugin handlers. `pluginsReady` is exposed for the sidebar-relocation watch and for tests/diagnostics.

**Alternative considered:** A single `pluginsReady` ref that flips on both success and failure. Rejected because (per rubber-duck critique) it conflates "fully healthy" with "settled enough to render", masking real plugin-load bugs that may explain the reported reload symptom.

**Alternative considered:** Awaitable `pluginsReadyPromise` instead of refs. Rejected because Vue's reactivity needs ref/computed deps to re-run effects.

### Decision 2: `ContentArea.vue` sidebar relocation watch tracks render invalidation

This is the single most important fix for the reported `status` plugin symptom. The current `watchPostEffect` is replaced by an explicit `watch`:

```ts
const sidebarTriggers = computed(() =>
  // Read all relevant signals so the watch runs on any of them.
  [currentContent.value, isLastChapter.value, pluginsReady.value, renderEpoch.value]
);

watch(
  sidebarTriggers,
  async () => {
    await nextTick();
    const wrapper = contentRef.value;
    if (!wrapper) return;
    const sidebar = wrapper.querySelector(".sidebar");
    if (!sidebar) return;
    sidebar.innerHTML = "";
    if (!currentContent.value || !pluginsSettled.value) return;
    const panels = wrapper.querySelectorAll(".plugin-sidebar");
    panels.forEach((panel) => sidebar.appendChild(panel));
  },
  { flush: "post", immediate: true },
);
```

Key changes vs. the current `watchPostEffect`:

- Tracks `pluginsReady` and `renderEpoch` so the relocation re-runs whenever the rendered DOM is invalidated.
- Always clears the sidebar first so stale panels from a previous chapter cannot leak.
- Skips the `querySelectorAll` step when not renderable (no content or plugins not settled) so no orphan DOM is captured.
- Uses `await nextTick()` before reading `.plugin-sidebar` so Vue's `v-html` patches have completed.

### Decision 3: `currentContent` becomes `shallowRef`, with `commitContent` helper

```ts
import { shallowRef, triggerRef, ref } from "vue";

const currentContent = shallowRef("");
const renderEpoch = ref(0);

function commitContent(next: string): void {
  if (currentContent.value === next) {
    triggerRef(currentContent);
    renderEpoch.value++;
  } else {
    currentContent.value = next;
    renderEpoch.value++;
  }
}
```

`commitContent` is called by every load path (`loadFromBackend`, `reloadToLast`, the new `refreshAfterEdit`, `pollBackend`, the WebSocket `chapters:content` handler). The dual `triggerRef` + `renderEpoch` mechanism is intentional:

- `triggerRef(currentContent)` invalidates the `tokens` computed in `ChapterContent.vue` (which reads `props.rawMarkdown` ← `currentContent`).
- `renderEpoch++` invalidates non-`shallowRef`-aware effects, specifically the sidebar relocation watch in `ContentArea.vue`. Vue's `triggerRef` only signals dependents that read the ref; a separate watch that doesn't read `currentContent` for that render needs an alternative dependency.

`renderEpoch` is monotonically non-decreasing. Wraparound at `Number.MAX_SAFE_INTEGER` is a non-issue.

**Alternative considered:** `Ref<{ text: string }>` so identity changes on every assignment. Rejected because it requires touching every read site and brings no extra correctness over `shallowRef + triggerRef`.

### Decision 4: `refreshAfterEdit(targetChapter)` replaces `reloadToLast()` for edit-save

```ts
async function refreshAfterEdit(targetChapter: number): Promise<void> {
  if (!currentSeries || !currentStory) return;
  clearPolling();
  const token = ++loadToken;
  await loadFromBackendInternal(currentSeries, currentStory);
  if (token !== loadToken) return;

  if (chapters.value.length === 0) {
    commitContent("");
    startPollingIfNeeded();
    return;
  }

  const targetIdx = Math.max(
    0,
    Math.min(targetChapter - 1, chapters.value.length - 1),
  );
  const prevIdx = currentIndex.value;
  currentIndex.value = targetIdx;
  commitContent(chapters.value[targetIdx]?.content ?? "");
  if (prevIdx !== targetIdx) dispatchChapterChange(prevIdx, targetIdx);

  syncRoute();
  startPollingIfNeeded();
}
```

`ChapterContent.vue#saveEdit`:

```ts
await editChapter(ctx.series, ctx.story, currentChapterNumber.value, editBuffer.value);
isEditing.value = false;
await refreshAfterEdit(currentChapterNumber.value);
```

`reloadToLast()` is preserved unchanged for callers whose semantics genuinely are "go to the new last chapter": the post-LLM-stream `handleSend`/`handleResend` in `MainLayout`, the rewind toolbar action, and (after a server-assigned new name) the branch action.

### Decision 5: `tokens` computed reads `pluginsReady` and `renderEpoch`

```ts
const { pluginsReady } = usePlugins();
const { renderEpoch } = useChapterNav();
const tokens = computed(() => {
  void pluginsReady.value;
  void renderEpoch.value;
  return renderChapter(props.rawMarkdown, {
    isLastChapter: props.isLastChapter,
    stateDiff: chapters.value[currentIndex.value]?.stateDiff,
  });
});
```

This is defense-in-depth. The primary correctness mechanism is the gate in `ContentArea` and the sidebar-relocation watch; the explicit reads here ensure that any code path that bypasses the gate still self-corrects.

### Decision 6: Phase-2 deep-link route-watcher refactor is gated on instrumentation

We do **not** move `loadFromBackend()` from `App.vue` to a route watcher in the initial implementation. Per the rubber-duck critique, that refactor introduces a new race class:

- The route watcher would need a "desired route key" model to handle mid-load route changes (browser back/forward landing on a different chapter while a load is in flight). The current `currentSeries === series` check is set **before** `await loadFromBackendInternal` returns, so a watcher that uses it would call `navigateTo()` against an empty `chapters.value`.
- Other `loadFromBackend` callers (branch flow in `ChapterContent.vue#handleBranch`, story-selector flow in `useStorySelector`) would all need to be audited and possibly rewritten to push the route and let the watcher pick up the change.

We add `frontendHooks.getHandlerCount(stage)` and console-log instrumentation (`RENDER_DEBUG` env var) that records the ordering of `auth verified`, `plugins settled`, `loadFromBackend committed`, and `renderChapter dispatched (handler count: N)` events. If, after Phase 1, instrumentation confirms a residual reload race (e.g. async `register()` finishing after `currentContent` is set despite being awaited), Phase 2 introduces the route-watcher refactor as a separate change.

### Decision 7: Drop the "defensive logging in renderChapter" task

The original task to log when `renderChapter()` runs with zero `frontend-render` handlers is replaced by the more general `getHandlerCount(stage)` API + instrumentation gated on `RENDER_DEBUG`. That gives clean, opt-in diagnostics without false positives on chapters that legitimately contain no plugin tags.

## Risks / Trade-offs

- **[Risk]** `pluginsSettled` gating means a plugin-load failure produces a chapter rendered without plugin handlers, possibly with a degraded UI.
  → **Mitigation:** failures are surfaced via a visible toast (using the existing `useNotification` composable). The behavior matches today's "no plugins registered" rendering path, which is already specced and tested.

- **[Risk]** `shallowRef + triggerRef` is unfamiliar to contributors and easy to use incorrectly.
  → **Mitigation:** all writes go through the private `commitContent` helper; direct `currentContent.value = ...` assignments are removed from the codebase. A short JSDoc comment on `commitContent` explains the rationale.

- **[Risk]** Adding `renderEpoch` as a watch dependency in `ContentArea` could cause excessive re-runs (e.g. on polling updates that don't change content).
  → **Mitigation:** `commitContent` only bumps `renderEpoch` when content is actually committed; idle polling that finds no change does not call `commitContent`. The relocation work is cheap (single `querySelectorAll` + `appendChild` loop) and runs after `nextTick`.

- **[Risk]** Async `register()` support could change the registration order of plugins relative to today.
  → **Mitigation:** all plugin registrations still occur within the same `Promise.all`, so observable ordering between plugins is unchanged. A plugin that previously registered synchronously will continue to do so. No third-party plugin in the bundled set today uses async `register`, so the change is forward-compatible.

- **[Risk]** Tests that mount `ChapterContent.vue` directly without going through `ContentArea` will need to set `pluginsSettled.value = true` (and `pluginsReady.value = true` if the test cares).
  → **Mitigation:** update the existing test helper in `ChapterContent.test.ts` `beforeEach`. The change is small and localized.

- **[Trade-off]** The user briefly sees a loading placeholder on initial reload between "auth ok" and "plugins settled". On a typical localhost the gap is ≤50 ms; on a slow network it could be a few hundred ms. We accept this in exchange for never showing a half-rendered chapter.

- **[Trade-off]** Specs use "the rendered chapter view SHALL be invalidated such that, when ChapterContent renders, chapter:render:after is dispatched for that render" rather than "fires exactly once". This avoids brittle tests that assert exact dispatch counts under Vue's lazy computed evaluation.

## Migration Plan

There is no migration. The project has zero deployed users, no public API changes, and no plugin author–visible changes. The code change is committed, the frontend is rebuilt with `deno task build:reader`, the tests are run with `deno task test`, and the change is shipped as a single commit on `master`.

## Open Questions

1. **Should `pluginsSettled` stay `false` after a transient `/api/plugins` failure so a retry can flip it later?** Decision: no — the page lifecycle is short, plugins load once, and a permanently-`false` `pluginsSettled` would permanently hide every chapter on a transient failure. The toast surfaces the failure and the user can refresh.
2. **Should we also fix the related "scroll-to-top on chapter change" effect to track `renderEpoch`?** Out of scope. That effect intentionally does NOT scroll on edit-save because the user expects to stay where they were.
3. **If Phase 2 confirms a reload race, is the route-watcher refactor preferable to awaiting `pluginsReadyPromise` inside `App.vue#handleUnlocked`?** TBD — Phase 2 will evaluate both options against the instrumentation evidence.

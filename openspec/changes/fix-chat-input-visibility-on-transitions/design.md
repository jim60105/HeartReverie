# Design — fix-chat-input-visibility-on-transitions

## Context

The chat-input visibility gate (`MainLayout.vue:22-25`) is the user-facing contract: the input box appears when the reader is positioned on the last chapter of a loaded story. The repro cases show that the gate evaluates correctly on a page reload but stays at the wrong value after in-app transitions. The investigation (see `proposal.md` § Why) traced this to three reactivity defects in `useChapterNav.ts`. This document explains the chosen fix and the alternatives considered, so the implementation stays minimal and the reviewer can audit the trade-offs.

The relevant existing code surface (read-only baseline):

- `reader-src/src/composables/useChapterNav.ts`
  - Lines 19–20: `const currentIndex = ref(0); const chapters = ref<ChapterData[]>([]);`
  - Lines 48–49: `let currentSeries: string | null = null; let currentStory: string | null = null;` ← **defect site 1**
  - Lines 85–87: `const isLastChapter = computed(() => chapters.value.length > 0 && currentIndex.value === chapters.value.length - 1);`
  - Lines 305–348: `async function loadFromBackend(series, story, startChapter, options)` ← **defect site 2** (two-step update with plugin-hook dispatch between)
  - Lines 413–419: `function getBackendContext()` reads the `let` bindings.
  - Lines 449–451: `watch(currentIndex, () => syncRoute())`
  - Lines 454–466: chapter-route-param watcher; early returns when nothing changed.
  - Lines 469–482: series/story-route-param watcher; calls `loadFromBackend(s, st, startChapter)`.
- `reader-src/src/composables/useStorySelector.ts` line 35: `navigateToStory` pushes `{ name: "story", params: { series, story } }` without a chapter param.
- `reader-src/src/components/MainLayout.vue` lines 22–25: `showChatInput` computed.

## Goals / Non-Goals

**Goals.**

- The chat-input visibility computed evaluates correctly on every state transition the user can reach, not only on initial mount.
- `currentSeries` and `currentStory` participate in Vue reactivity so any consumer (current or future) sees the same guarantees as `currentIndex` and `chapters`.
- Inside `loadFromBackend`, observers (plugin hooks, watchers, computeds, renders) never see a state in which `chapters.length` and `currentIndex` disagree about which chapter is current.
- New tests cover the two failing user flows from the bug report, exercised through the real composable state (not a fully mocked computed).

**Non-Goals.**

- Refactoring `useChapterNav.ts` into a Pinia store or a class. The composable shape is fine; only three lines of state and one ordering inside `loadFromBackend` change.
- Changing the public composable surface (`useChapterNav()` return shape). Plugin hook payloads remain the same; consumers continue to read `chapters`, `currentIndex`, `isLastChapter`, etc.
- Changing the router shape. We keep the `{ name: "story" }` and `{ name: "chapter" }` route names.
- DNS / hostname allowlist changes. Unrelated capability.
- Touching `HeartReverie_Plugins/`. The bug is fully inside the core reader frontend.

## Decisions

### 1. Convert `currentSeries` / `currentStory` to `ref<string | null>(null)`

We change:

```ts
let currentSeries: string | null = null;
let currentStory: string | null = null;
```

to:

```ts
const currentSeries = ref<string | null>(null);
const currentStory = ref<string | null>(null);
```

and update every read/write site in the module to use `.value`. `getBackendContext()` becomes a function whose returned `isBackendMode` is a derived value computed from `.value` reads, so any reactive caller that invokes it inside a computed (`showChatInput` does) will subscribe to those refs.

**Alternatives considered.**

- Convert `getBackendContext()` into a `computed()` instead. Rejected: the function is also called from non-reactive code paths (e.g. the dispatch helper) where a `computed` would be silently consumed without subscription. Keeping it a plain function that *reads* refs is simpler and correct in both contexts.
- Wrap the two `let`s in a single `reactive({ series, story })` object. Rejected: equivalent at runtime but slightly noisier at call sites; we lose the per-field type narrowing `null | string` that the refs give us.

### 2. Atomic `chapters` + `currentIndex` update inside `loadFromBackend`

The relevant sequence today (paraphrased):

```ts
await loadFromBackendInternal(series, story);     // sets chapters.value = loaded
// ... derives total / loaded counts ...
if (isTransition) dispatchStorySwitch(series, story);
const startIdx = startChapter
  ? Math.max(0, Math.min(startChapter - 1, chapters.value.length - 1))
  : 0;
currentIndex.value = startIdx;
commitContent(chapters.value[startIdx]?.content ?? "");
if (isTransition) dispatchChapterChange(null, startIdx);
```

The defect is the gap between `chapters.value = loaded` (deep inside `loadFromBackendInternal`) and `currentIndex.value = startIdx`. We close it by setting `currentIndex.value` to the resolved start index **before** `dispatchStorySwitch` fires, and we set both refs together so that no observer can see a state where `currentIndex` points outside `[0, chapters.length - 1]`.

The fix is structural rather than algorithmic: extract the `chapters.value = loaded` assignment out of `loadFromBackendInternal` (or have that helper return the loaded array) so `loadFromBackend` can perform the atomic update:

```ts
const loaded = await fetchChaptersFromBackend(series, story);  // pure fetch, no ref writes
const resolvedStartIdx = startChapter
  ? Math.max(0, Math.min(startChapter - 1, loaded.length - 1))
  : 0;
// Atomic update: assign currentIndex first to ensure isLastChapter is never stale
// against the new chapters array.
currentIndex.value = resolvedStartIdx;
chapters.value = loaded;
commitContent(loaded[resolvedStartIdx]?.content ?? "");
if (isTransition) dispatchStorySwitch(series, story);
if (isTransition) dispatchChapterChange(null, resolvedStartIdx);
```

The exact ordering (`currentIndex` first or `chapters` first) is debatable; Vue batches reactive writes inside the same tick. The key invariant is that both refs are written *before* any plugin hook fires and *before* the next microtask boundary. Writing `currentIndex` first means that the `isLastChapter` computed, if read between the two writes, sees `(chapters.length=N_old, currentIndex=resolvedStartIdx)` rather than `(chapters.length=N_new, currentIndex=stale_high)`; the former is at worst a stale `false` (acceptable), the latter is an invalid pair (the bug). Once `chapters.value = loaded` lands, the computed re-fires with the consistent `(N_new, resolvedStartIdx)` pair and `isLastChapter` settles on the correct value.

**Alternatives considered.**

- Wrap the two assignments in `unref`-style transaction code. Rejected: Vue already batches synchronous writes in the same tick; explicit transactions add complexity for no observable benefit.
- Add a watcher that clamps `currentIndex` whenever `chapters.length` changes. Rejected: a watcher fires on `nextTick`, which is too late — plugin hooks have already fired by then. The clamp must happen synchronously inside `loadFromBackend`.
- Keep two writes but reverse the order (`chapters` then `currentIndex`). Rejected: matches the buggy current behavior; the stale-`currentIndex`-against-new-`chapters` window is exactly the bug.

### 3. Leave `navigateToStory` as-is

We do **not** change `useStorySelector.ts:35`. The story-selector legitimately pushes `{ name: "story" }` without a chapter param because it does not know how many chapters the new story has; the route-watcher in `useChapterNav` resolves chapter 1 from there. Once defects 1 and 2 are fixed, this path renders the chat input correctly when the new story has exactly one chapter (chapter 1 = last chapter).

**Alternative considered.** Pre-fetch the chapter count and route to `{ name: "chapter", chapter: <last-or-first> }`. Rejected: bloats the selector with backend awareness it does not need, and conflicts with the existing F5 path which works fine after the upstream fixes.

### 4. Test strategy

The existing unit tests mock `useChapterNav` with synthetic refs (`MainLayout.test.ts:21 const isLastChapterRef = ref(false)`), so they cannot catch this class of bug. We add:

- `useChapterNav.test.ts`: a transition-reactivity test that calls `loadFromBackend` from initial empty state with a 1-chapter story and asserts `isLastChapter.value === true` synchronously after the awaited call, and asserts no intermediate render observed `isLastChapter === false` after `chapters.value.length === 1`. We can verify the latter by reading `isLastChapter.value` inside a `watch` registered just before the call and counting `false` observations.
- `useChapterNav.test.ts`: a test that calls `loadFromBackend` with a 3-chapter story, then `loadFromBackend` again with a 1-chapter story (different series/story), and asserts the same invariant.
- `useChapterNav.test.ts`: a test that calls `loadFromBackend` to a 5-chapter story landing on chapter 1, then `goToLast()`, and asserts `isLastChapter.value === true` synchronously.
- `MainLayout.test.ts`: keep the existing tests; add one that wires real `useChapterNav` (or a thinner mock that exposes the real refs) and exercises a story-switch transition, asserting `ChatInput` is rendered after the transition.

The transition tests are the contract; they will fail today and pass after the fix.

### 5. In-container smoke verification

The CI suite covers unit-level reactivity. The user reproductions are end-to-end. The apply phase MUST run `cd HeartReverie && scripts/podman-build-run.sh`, then use `agent-browser` (or equivalent) to:

1. Open `http://localhost:8080/`, unlock with the test passphrase.
2. Pick `櫻帝學園 / 商店街散步` via the top-left story-selector.
3. Assert the chat-input textarea is rendered without pressing F5.
4. Pick `櫻帝學園 / 日常`, then press the `goToLast` (`⇉`) header button.
5. Assert the chat-input textarea is rendered without pressing F5.

If `agent-browser` semantics are too brittle for the `<details>` story-selector (observed during the propose phase), the smoke test MAY drive the SPA via direct router pushes / store calls evaluated through the dev console, but it MUST exercise the real `useChapterNav` state machine in the live container — not a Vitest mock.

## Risks / Trade-offs

- **Test seam.** Converting `currentSeries`/`currentStory` to refs means any test that monkey-patched the module-internal `let` to bypass state — none currently exist — would break. Searched the repo; nothing matches. Low risk.
- **Plugin hooks.** `dispatchStorySwitch` and `dispatchChapterChange` are called with positional arguments; they do not introspect module-internal state. Moving them after the ref assignments is therefore semantically equivalent; if any plugin reads `useChapterNav()` state during a hook, it now sees the consistent post-transition state, which is the more correct contract.
- **Order of writes.** As discussed in decision 2, the order matters only for the intermediate observable state. Vue's batched-effects guarantee that downstream effects fire once both writes have landed. The fix is robust against future refactors that introduce additional refs as long as the same atomicity discipline is maintained.
- **Two-stage SSRF host-policy memory.** The previous archived change (`trust-hostname-skip-ip-allowlist`) touched unrelated capability. This change does not interact with host-policy logic.

## Migration Plan

None. Single-deploy switchover. After deployment, existing stories load identically; the bug stops reproducing.

## Open Questions

None known. The bug report is unambiguous, the code paths are localized, and the fix is internal to one composable.

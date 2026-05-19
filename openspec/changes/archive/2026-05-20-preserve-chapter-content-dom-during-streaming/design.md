## Context

`useChapterNav.ts` exposes a single `renderEpoch` counter that today does double-duty:

1. **Notification signal** for downstream watchers (`ContentArea.vue` sidebar relocation; `ChapterContent.vue` `chapter:dom:ready` dispatch) that need to react on every chapter view re-render — including byte-identical content commits triggered by polling/WebSocket pushes.
2. **Force-remount signal** baked into `ChapterContent.vue`'s v-for key (`:key="\`${idx}-${renderEpoch}\`"`), which tears down and recreates every `<div v-html>` node whenever the counter changes.

The second role was added by the archived change `2026-04-30-fix-frontend-render-on-edit-and-reload` to recover from a specific race: after cancel-edit, the v-html string is byte-identical to before edit, but `ContentArea`'s relocation watch had already moved `.plugin-sidebar` children OUT of the v-html div. Without forcing a remount, Vue's `v-html` would short-circuit (string unchanged), and the sidebar panels would never reappear.

WebSocket streaming (added in `2026-04-13-websocket-streaming`) now pushes deltas at ~10–100 messages per second during generation. Each push calls `commitContent(content)`, which always bumps `renderEpoch`. With the v-for keyed on `renderEpoch`, the entire rendered token list churns at the streaming frequency:

- Each remount briefly removes the rendered DOM, so the chapter container's measured height collapses for one frame.
- Browsers anchor scroll position to the document — when the document shortens, the visible region above the cursor disappears, so the browser re-clamps scrollTop to the new (much smaller) maximum, which is effectively the top of the page.
- The end-user experience is a constant scroll-snap-to-top during streaming, plus visible flicker.

Plugins that rely on `chapter:dom:ready` (e.g. `dialogue-colorize`) also redo expensive Range-registration work per chunk under the current contract. While not the primary motivation, it is a positive side effect of the fix.

## Goals / Non-Goals

**Goals:**
- During streaming, the rendered chapter DOM is patched in place — no remount of v-html nodes per chunk.
- Scroll position is preserved across streaming commits (the user sees the streaming text grow under a stable scroll anchor).
- The cancel-edit recovery path continues to work: after pressing 取消, sidebar panels reappear correctly.
- The contract for plugins listening to `chapter:dom:ready` is unchanged — they still receive a dispatch per commit. Plugins that perform DOM mutations on the rendered container continue to function.
- No backend changes; no protocol changes; no new dependencies.

**Non-Goals:**
- Optimising plugin work (e.g. throttling `chapter:dom:ready` during streaming). That is a separate concern and could be addressed in a future change if profiling shows it matters.
- Changing the streaming protocol (WebSocket vs polling). The fix is orthogonal to how chunks arrive.
- Preserving the cursor position when the user is editing a chapter — that path uses a textarea, unaffected.

## Decisions

### Decision 1: Split `renderEpoch` into two counters

**Choice:** Introduce a new `remountToken` ref alongside `renderEpoch`. Use `remountToken` as the v-for key suffix; keep `renderEpoch` as the notification signal.

**Why:** Two semantically distinct events ("content commit" vs "force-remount") deserve two signals. A single counter forces every caller to pay the most expensive interpretation (remount) for the cheapest event (streaming chunk).

**Alternatives considered:**
- **A. Remove `renderEpoch` from the v-for key entirely; rely on Vue's natural diffing.** Rejected because cancel-edit requires byte-identical-string remount which Vue's diffing intentionally skips. We would have to either keep the old broken behaviour for cancel-edit or invent a different fix for that path (e.g. force-clear `innerHTML` imperatively from inside the cancel handler). The latter is more invasive and harder to test than a second counter.
- **B. Hash `token.content` into the key.** Stable identical tokens would not remount, fixing streaming. But cancel-edit's byte-identical token also has an identical hash, so it would *not* remount and the bug returns. Hashing doesn't help unless we mix in the force-remount signal — at which point we have effectively reinvented `remountToken`.
- **C. Bypass Vue and mutate `innerHTML` imperatively in a watch.** Rejected: gives up Vue's batching and `VentoErrorCard` component lifecycle, and complicates SSR-style testing.

### Decision 2: Replace `bumpRenderEpoch()` with two narrower helpers — `notifyRenderInvalidated()` and `forceTokenRemount()`

**Choice:** Remove the single misleadingly-named `bumpRenderEpoch()`. Add:
- `notifyRenderInvalidated(): void` — increments `renderEpoch` only. This is what most current callers actually need.
- `forceTokenRemount(): void` — increments BOTH `remountToken` and `renderEpoch`. Reserved for callers that have externally mutated the rendered DOM and need a true remount to recover.

**Why:** Auditing the current `bumpRenderEpoch()` call sites reveals two different intents:
- `ChapterContent.vue#cancelEditAction` — needs the relocation watch in `ContentArea` to re-run AFTER the v-if-driven recreation of the tokens template. Both counters bumping is acceptable (the v-if already recreates the subtree, so the `remountToken` bump is redundant but harmless).
- `usePlugins.ts#subscribeSettingsChanged` — needs downstream watchers to re-run after a plugin's settings change so plugins can re-walk and re-apply. It does NOT externally mutate the rendered DOM; a remount of every v-html element is unwanted work that briefly tears down plugin-attached state for no benefit.

A single function cannot serve both intents safely. Splitting makes the contract obvious at the call site.

**Alternatives considered:**
- Keep a single `forceTokenRemount()` and have `usePlugins.ts` call it. Rejected: produces unnecessary remounts on every settings change, including tiny toggles unrelated to rendering.
- Keep a single `notifyRenderInvalidated()` and remove the force-remount path entirely. Rejected: cancel-edit's "byte-identical tokens + externally-mutated DOM" case genuinely needs the remount as a safety net for any future cancel-style path that doesn't already remount via v-if.

### Decision 2b: Cancel-edit calls `forceTokenRemount()`, not `notifyRenderInvalidated()`

**Choice:** Even though `isEditing` flipping false → true causes Vue's v-if to recreate the rendered subtree on its own (making the `remountToken` bump technically redundant for the canonical cancel path), `cancelEditAction` SHALL still call `forceTokenRemount()`.

**Why:** Defensive. If a future refactor changes the template structure (e.g. removes the v-if textarea fork in favour of a CSS toggle, or replaces it with a different v-if condition), the cancel-edit DOM may no longer be recreated automatically. Calling `forceTokenRemount()` keeps the behavioural contract stable without depending on the template's accidental side effect. The `renderEpoch` half of the bump is the load-bearing part today; the `remountToken` half is insurance.

### Decision 3: `commitContent()` bumps only `renderEpoch`

**Choice:** Inside `commitContent()`, do not touch `remountToken`. The function continues to call `triggerRef(currentContent)` for byte-identical commits and continues to increment `renderEpoch`.

**Why:** Streaming commits are the hot path. They must never force a remount of v-html nodes.

**Implication:** For byte-identical commits (e.g. a re-poll where the content is unchanged), Vue's v-html will correctly skip the patch. That is desirable in the streaming path. The only consumer that needs byte-identical-remount semantics is cancel-edit, which now goes through `forceTokenRemount()`.

### Decision 4: Keep the v-for itself; only change the key

**Choice:** The template structure (`<template v-for="(token, idx) in tokens">` plus per-type child rendering) is unchanged. Only the `:key` expression changes from `\`${idx}-${renderEpoch}\`` to `\`${idx}-${remountToken}\``.

**Why:** Minimises the blast radius of the change; preserves all existing test scaffolding around the v-for; keeps `VentoErrorCard` lifecycle behaviour intact for error tokens.

### Decision 5: Update mocks across the test suite

`useChapterNav` is mocked in multiple test files. Per the rubber-duck sweep this includes at minimum: `ChapterContent.test.ts`, `ContentArea.test.ts`, `ChatInput.test.ts`, `ChatInput.continue.test.ts`, `Sidebar.test.ts`, `MainLayout.test.ts`, `HookInspectorPage.test.ts`, `usePluginActions.test.ts`, and any `PromptEditor*` tests that touch navigation. Each mock MUST:
- Expose `remountToken` as a real `ref(0)` (so the v-for key works under test).
- Expose `forceTokenRemount` as a function that bumps both refs.
- Expose `notifyRenderInvalidated` as a function that bumps `renderEpoch` only.
- Drop any `bumpRenderEpoch` key (hard rename; no alias; project policy disclaims back-compat).

Tasks 3.1 and 5.x enforce this with an `rg` sweep across `reader-src/` AND `plugins/`.

### Decision 6: Container element identity is sufficient — no chapter-identity in the v-for key

**Choice:** The v-for key is `${idx}-${remountToken}` and does NOT include a chapter / story identity component.

**Why:** Plugin lifecycle hooks (`chapter:dom:ready` and `chapter:dom:dispose`) are dispatched from `ChapterContent` based on the `containerRef` element, not the v-html children. The containerRef is the outer `<div ref="containerRef" class="chapter-content">`, which persists as long as the `ChapterContent` instance lives. Today, navigation from chapter N to N+1 does NOT unmount `ChapterContent` (the wrapper persists); the same containerRef is reused, and `chapter:dom:ready` is dispatched with the same container element repeatedly. Plugins are already expected to re-walk on every dispatch — `dialogue-colorize` does this; `reading-progress` gates per-container init via `containerState.has(container)` which makes re-dispatches idempotent.

Vue's `v-html` patch handles content changes correctly: when the bound string changes (any navigation, any streaming chunk that grew), Vue replaces the element's descendants by re-parsing `innerHTML`. Plugin Range objects pointing to old descendants become detached/invalid — which is the existing contract; plugins recover by re-walking on the next `chapter:dom:ready`.

Adding chapter identity to the v-for key would gain nothing semantically and would cost us the streaming-stability win for any path that touches both chapter identity and streaming.

## Risks / Trade-offs

- **[Risk] Cancel-edit regression** → Mitigation: keep the explicit test that pressing 取消 results in sidebar panels reappearing; verify in container with browser automation per the repo's Mandatory Integration Verification protocol.
- **[Risk] Plugin settings-change handler accidentally triggers full token remounts** → Mitigation: `usePlugins.ts` is updated to call `notifyRenderInvalidated()` (renderEpoch only). A spec scenario asserts `notifyRenderInvalidated()` does not bump `remountToken`. A test in `usePlugins` (or an integration assertion) verifies the call site uses the notify helper.
- **[Risk] `reading-progress` plugin or similar restores scroll on every `chapter:dom:ready` dispatch during streaming → still snaps scroll** → Investigation result: `reading-progress` guards initial scroll restore via `containerState.has(container)`. Because the containerRef (`.chapter-content`) is already stable across streaming (it was stable before our change too), the guard already prevents per-chunk re-restoration. Our change does not alter this. Mitigation: integration verification (task 7.3) includes loading the `reading-progress` plugin and confirming no scroll jitter during streaming.
- **[Risk] Plugins assuming a fresh v-html DOM per commit** → Investigation result: today the per-commit remount tore down their work as collateral damage and they coped by re-applying on `chapter:dom:ready`. Under our change the v-html string still changes on every meaningful commit, so Vue still resets `innerHTML`; descendants are still recreated. The only thing that survives is the v-html ROOT element instance (the wrapper `<div v-html>`). Plugins that attached attributes or listeners to descendants will see them gone on the next `chapter:dom:ready` dispatch — same as today. No behavioural regression.
- **[Risk] `chapter:dom:dispose` not firing as expected** → Mitigation: unchanged. `dispose` fires on `onBeforeUnmount` of `ChapterContent`, which is now triggered LESS often (never during streaming, never during in-story navigation that doesn't unmount the component), which is correct. The hook was never meant to fire per chunk.
- **[Risk] Imperative DOM mutations made by plugins on the v-html root** (e.g. setting an attribute on the wrapper div) survive across commits because the wrapper is reused. → Mitigation: this is the intended behaviour for the wrapper element; plugins relying on a clean wrapper per commit were already wrong (the per-commit remount was a side effect, not a contract). Spec language carefully scopes this to "the v-html root element" — descendants are NOT guaranteed to survive.
- **[Trade-off] Three helpers (`commitContent` private, `notifyRenderInvalidated`, `forceTokenRemount`) instead of one** → Slight cognitive overhead, mitigated by docstrings on each helper and by colocated comments at each call site.

## Migration Plan

No data migration. No protocol or storage changes. Single-PR rollout:
1. Land the code + spec deltas + tests in one PR.
2. Build container and verify streaming smoothness via `scripts/podman-build-run.sh` + agent-browser navigation through a generation.
3. Verify cancel-edit still works in the same container session.

Rollback: revert the PR. No state changes.

## Open Questions

None.

## Context

The `reading-progress` plugin's frontend module (`HeartReverie/plugins/reading-progress/frontend.js`) drives two separate code paths that compare server-stored progress against the locally-mounted chapter:

1. **`chapter:dom:ready` handler** (line 653, registered via `registerIdempotentChapterReady` at priority 50). On the very first fresh-chapter dispatch for a `(container, chapterIndex)` tuple, the handler `queueMicrotask`s a fetch of stored progress (line 674) and — if `saved.chapterIndex !== ctx.chapterIndex` — calls `handleCrossChapter(...)` (line 681) which either shows a modal (default) or auto-navigates (if `confirmRemoteJump: false`).
2. **`checkRemoteConflict()`** (line 625), invoked from `visibilitychange → visible` (line 750, gated by `pollOnFocus`) and from a periodic poller (line 766, gated by `pollIntervalMs > 0`). Its cross-chapter branch (line 639) is *already* gated by `remote.revision > cachedRevision AND remote.chapterIndex !== local.chapterIndex` — but path #1 has no such guard.

The bug surfaces because the engine dispatches `chapter:dom:ready` after **every** chapter mount, including immediately after the engine auto-navigates the user into a freshly-generated chapter. At that instant, the *local* state is correct (we're on chapter N+1) but the *server* still has chapter N (we haven't PUT the new index yet — see the throttled progress sender at line ~340 onwards). Path #1 sees the mismatch and prompts the user to "jump back to chapter N", which is the opposite of what they want.

The reported user trigger is "pressing the regenerate button on the chapter generator", which is one specific instance of this general class.

Stakeholders:
- Reader users — directly affected (broken UX)
- Plugin author / spec owner — owns the cross-device sync requirement and must agree the weakened behaviour is acceptable
- Pre-release project — no production users, so no migration concerns

## Goals / Non-Goals

**Goals:**

- The cross-chapter prompt on `chapter:dom:ready` SHALL fire only on the first such dispatch per story-load session (where a "story-load session" begins at `story:switch` and ends when the next `story:switch` fires or the page unloads).
- Same-chapter scroll restoration SHALL continue to work on every fresh-chapter mount, untouched.
- Multi-device conflict detection on `visibilitychange → visible` and the periodic poll (the `checkRemoteConflict` path) SHALL use a strict `remote.chapterIndex > local.chapterIndex` direction check. The previous `!==` comparison incorrectly fired the cross-chapter dialog when the server was BEHIND the local chapter (e.g. immediately after generating a new chapter, before the throttled PUT had synced). The `else if (remote.chapterIndex === local.chapterIndex)` branch retains the existing scroll-divergence hint behavior; `remote.chapterIndex < local.chapterIndex` is a silent no-op (expected when server is catching up).
- The fix SHALL be testable via the existing Deno test harness without requiring a browser-driver test.

**Non-Goals:**

- Do **not** change the backend `PUT /api/plugins/reading-progress/progress/:series/:story` contract or the storage format.
- Do **not** change the settings schema or default values (`confirmRemoteJump`, `pollOnFocus`, `pollIntervalMs`, `syncIntervalSeconds`, etc.).
- Do **not** introduce a new hook event. The fix uses the existing `story:switch` and `chapter:dom:ready` events.
- Do **not** address the (theoretical) race where, after generating chapter N+1, the user manually scrolls quickly enough that the throttled PUT fires before they re-focus the tab, triggering `checkRemoteConflict` — that path is already correctly gated by `remote.revision > cachedRevision`, so it does not need a fix.
- Do **not** rework the WeakMap-keyed idempotency guard in `registerIdempotentChapterReady`; that is a separate concern (preventing duplicate restores during LLM streaming chunks for the *same* chapter).

## Decisions

### Decision 1: Use a per-story-load guard, reset on `story:switch`

A module-level `let crossChapterCheckUsed = false;` inside the `initFileMode` IIFE. The plugin subscribes to `story:switch` and, in that handler, sets `crossChapterCheckUsed = false`. The `chapter:dom:ready` handler's `onFreshChapter` callback consults the flag *before* invoking `handleCrossChapter` and *unconditionally* sets it to `true` after the cross-chapter comparison runs (regardless of whether a prompt was actually shown).

**Why this over alternatives:**

- **Alt A: Use the engine's `chapter:change` event as the signal**. `chapter:change` fires on in-app chapter navigation. We could mark "user navigated in-app" on `chapter:change` and skip the cross-chapter prompt thereafter. *Rejected* because `chapter:change` is dispatched *before* `chapter:dom:ready` for the new chapter, but on the very first page-load the engine does not fire `chapter:change` (the chapter is mounted via `story:switch` → `chapter:dom:ready` directly without a preceding `chapter:change`). However, edge cases get tricky: what if a plugin programmatically triggers a chapter change without `chapter:change` firing? The "first-mount-after-story:switch" semantic is more predictable.

- **Alt B: Track `lastSeenServerChapterIndex` and prompt only when it changes**. Closer to true multi-device sync, but adds state to persist across reloads and reintroduces the original bug whenever the server-stored index legitimately equals a previously-seen value. *Rejected* as out of scope; the user explicitly asked for "only on page reload / page load" semantics.

- **Alt C: Suppress the cross-chapter check entirely in `chapter:dom:ready` and rely on `checkRemoteConflict` for cross-device sync**. Would break the page-reload UX: if a user reads on Device A through chapter 5, then opens the same story on Device B which last viewed chapter 2, Device B would mount chapter 2 and never prompt. *Rejected* because the page-load handoff prompt is the most user-valued cross-device case.

### Decision 2: Reset on `story:switch`, not on `chapter:change`

`story:switch` reliably fires when the user opens a different story (or the same story freshly on page load). `chapter:change` fires on every chapter navigation including the in-app "generate next chapter" path that *is* the bug source. Resetting on `chapter:change` would re-introduce the bug for users who manually navigate to a chapter and then generate the next one.

The flag therefore tracks "have we had a chance to check the server's saved chapter for this story yet, since the user opened it?" — which is exactly the semantic the user requested.

### Decision 3: Set the flag **synchronously** in `onFreshChapter`, before any `await` / `queueMicrotask` boundary

The current `chapter:dom:ready` callback wraps its GET inside `queueMicrotask(async () => { const saved = await getProgress(...); ... })` (line 674). If we read-and-set the flag *inside* the microtask after the `await`, two fresh `chapter:dom:ready` dispatches arriving back-to-back (e.g. a chapter mount immediately followed by another chapter mount because the user clicked through rapidly) could both observe `crossChapterCheckUsed === false` and both invoke `handleCrossChapter`.

The fix is to capture `wasFirstCheck` and write `crossChapterCheckUsed = true` **synchronously in the outer body of the `onFreshChapter` callback** — before `queueMicrotask` even schedules the GET. Then the captured `wasFirstCheck` is closed over and used inside the microtask. This makes the flag's lifecycle independent of GET latency and immune to ordering races.

A consequence: a fresh `chapter:dom:ready` that fails to fetch progress (network error, 5xx, `getProgress` swallows it and returns `null`) still consumes the guard. This is the desired behaviour — we don't want to "save up" the first-check until the GET happens to succeed, because that would re-introduce the bug whenever a transient network blip coincides with the page-load mount.

`onFreshChapter` only fires when the WeakMap idempotency guard determines this is a genuinely fresh `(container, chapterIndex)` mount (i.e. not a streaming chunk re-dispatch). So setting the flag in the outer body does not get consumed by streaming chunks.

### Decision 4: Tighten `checkRemoteConflict` to strict-ahead direction

The current spec at line 234 already states `remote.chapterIndex > local.chapterIndex` (strict-ahead), but the implementation at `frontend.js:639` uses `!==`. This drift means after local generation (local at N+1, remote still at N), a visibility-change focus poll can trigger the same false cross-chapter prompt this change is supposed to eliminate.

Therefore the scope is extended: change line 639 from `!==` to `>`. This aligns implementation with the existing spec verbatim — no new spec text needed for this branch beyond a small MODIFIED block to re-anchor it. The `else` (same-chapter scroll-divergence hint) branch keeps its `showScrollHint` behaviour because that uses a non-modal inline hint, not the cross-chapter dialog.

### Decision 5: No spec change to other parts of the multi-device conflict requirement

Beyond the strict-ahead direction (which is *already* in the existing spec — we are merely restoring it in code), nothing about the polling path changes.

## Risks / Trade-offs

- **[Risk] Page-load handoff edge case** — If the user reads on Device A through chapter 5, then opens the story on Device B which last loaded at chapter 2 *and never refreshed since A's progress was synced*, Device B's `chapter:dom:ready` will still fire on first mount and prompt correctly. **Mitigation:** the first-mount path is preserved by design.

- **[Risk] User switches stories twice rapidly** — Two back-to-back `story:switch` events both reset the flag. The second `story:switch`'s first `chapter:dom:ready` still triggers the prompt for that story. **Mitigation:** this is correct behaviour — each newly-opened story deserves its own cross-chapter check.

- **[Trade-off] Loses the "user kept the tab open across a sync from another device, same story, server chapter advanced" UX**. Under the new semantics, if the user has the tab open on chapter 3, syncs on a phone to chapter 7, and then returns to the desktop tab without reloading, the cross-chapter prompt will *not* fire from `chapter:dom:ready` — only from the `visibilitychange` polling path (which still works because remote chapter > local chapter). **Mitigation:** the polling path covers this case; the user-visible delta is at most one focus event late.

- **[Risk] `story:switch` semantics drift** — If the engine ever changes when `story:switch` fires, this fix may regress. **Mitigation:** the engine's hook dispatch semantics are spec'd; covered by engine tests. Add a unit test that explicitly verifies the guard resets on `story:switch`.

- **[Trade-off] Modal logic moves slightly further from the underlying remote-vs-local comparison.** Future maintainers reading `onFreshChapter` need to know the guard exists. **Mitigation:** clear inline comment + spec scenario.

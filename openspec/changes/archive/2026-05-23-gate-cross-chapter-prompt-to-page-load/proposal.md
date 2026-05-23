## Why

The `reading-progress` plugin shows a cross-chapter "jump back?" prompt at the wrong times. When the user generates the next chapter and the engine auto-navigates to it, the plugin's `chapter:dom:ready` handler fetches the server-saved progress (still pointing at the *previous* chapter — the PUT for the new chapter hasn't landed yet, or scroll hasn't happened) and treats the resulting `saved.chapterIndex !== ctx.chapterIndex` mismatch as a cross-device conflict. The user sees a modal asking whether to jump back to the chapter they just left, breaking the natural read → generate → continue reading flow.

The bug is in `plugins/reading-progress/frontend.js` lines 679–683, where the cross-chapter branch fires unconditionally on every `chapter:dom:ready` dispatch, including those caused by purely local navigation (chapter generation, manual chapter selection in the sidebar, etc.). The current spec (`reading-progress/spec.md` line 208) codifies this exact behaviour, so this is a spec-level change, not just a code patch.

## What Changes

- **BREAKING (UX)** The cross-chapter prompt on `chapter:dom:ready` SHALL fire **at most once per story-load session** — i.e. only on the first `chapter:dom:ready` after a `story:switch` (which is dispatched on initial page load and when the user navigates to a different story). Subsequent `chapter:dom:ready` dispatches within the same story-load session SHALL bypass the cross-chapter branch and proceed directly to the same-chapter scroll-restoration path.
- The "same-chapter scroll restore" branch (when `saved.chapterIndex === ctx.chapterIndex`) SHALL keep firing on every fresh `(container, chapterIndex)` mount — chapter generation should still restore scroll position if the user happens to return to the same chapter (rare but valid edge case during chapter regeneration / branching).
- The "multi-device conflict detection" branch on `visibilitychange → visible` polling SHALL be tightened to use a strict-ahead direction check (`remote.chapterIndex > local.chapterIndex`) instead of the inequality (`remote.chapterIndex !== local.chapterIndex`) currently implemented at `frontend.js` line 639. The existing main spec already states the strict-ahead semantic for this requirement, but the implementation drifted to `!==` — this change brings the implementation back in line with the spec and prevents the same false-prompt class from firing on visibility-change polling after local chapter generation (server behind local).
- No backend changes. No HTTP API changes. No settings-schema changes. The `confirmRemoteJump` setting continues to control whether prompt-vs-silent-jump is used when the prompt does fire.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `reading-progress`:
  - Tighten the "Scroll restoration on mount" requirement to gate the cross-chapter branch on first-mount-after-`story:switch`. The same-chapter restore behaviour and the multi-device conflict detection on visibility-change are preserved verbatim.
  - Align "Multi-device conflict detection" implementation with the existing spec by enforcing the strict-ahead `remote.chapterIndex > local.chapterIndex` direction (the implementation currently uses `!==`, which is broader than spec'd).

## Impact

- **Code**: `HeartReverie/plugins/reading-progress/frontend.js` — add a per-`(series, story)` "cross-chapter check already used" guard inside `initFileMode`, reset on `story:switch`, consult inside the `onFreshChapter` callback before invoking `handleCrossChapter`.
- **Tests**: `HeartReverie/tests/plugins/reading-progress/` — add unit test asserting that two consecutive `chapter:dom:ready` dispatches with different chapterIndexes within the same `story:switch` cycle produce at most one cross-chapter prompt; add a test asserting that a `story:switch` resets the guard.
- **Specs**: `openspec/specs/reading-progress/spec.md` — replace one paragraph in the "Scroll restoration on mount" requirement and add one new scenario.
- **APIs / dependencies / migrations**: none. No persisted data changes. Pre-release project with no users in production, so no backward-compat shim needed.
- **Runtime cost**: a single boolean field per story-load session. Negligible.

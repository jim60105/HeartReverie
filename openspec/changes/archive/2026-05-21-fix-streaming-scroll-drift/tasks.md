## 1. Plugin: reading-progress idempotency

- [x] 1.1 Extend `containerState` records in `plugins/reading-progress/frontend.js` (`initLocalMode`) to carry `chapterIndex` alongside `cleanup`
- [x] 1.2 In `initLocalMode`'s `chapter:dom:ready` handler, early-return after refreshing `currentIdentity` when `existing.chapterIndex === ctx.chapterIndex`; run previous `cleanup()` and proceed when it differs
- [x] 1.3 Apply the same idempotency guard in `initFileMode`'s `chapter:dom:ready` handler
- [x] 1.4 Verify no other call site relies on `containerState.get(container)` having the previous shape

## 2. SPA: ContentArea sidebar relocation idempotency

- [x] 2.1 In `reader-src/src/components/ContentArea.vue`, after the panel candidate set is computed inside the relocation watch, compute a fingerprint by joining each panel's `outerHTML` with a `\u0000` separator
- [x] 2.2 Compute the equivalent fingerprint from the panels already inside the `<Sidebar>` element
- [x] 2.3 When the fingerprints match AND `<Sidebar>` already has panels, remove the duplicate `.plugin-sidebar` nodes from `<ChapterContent>` and skip touching `<Sidebar>`
- [x] 2.4 Otherwise, branch on `contentChanged`: when content changed OR sidebar is empty, clear and full-relocate; when content is unchanged but the candidate fingerprint differs (transient re-render placeholder), remove the candidate from content and leave sidebar intact

## 3. Verification

- [x] 3.1 `deno task test` in `HeartReverie/` — 932 frontend + 30 backend tests pass
- [x] 3.2 `scripts/podman-build-run.sh` rebuilds the container and starts cleanly with no warnings
- [x] 3.3 Manual streaming smoke test against the running container confirms: scroll no longer snaps back to the saved position during streaming, and the sidebar column does not collapse/restore between chunks

## 4. Regression tests

- [x] 4.1 Add a Vitest case in `reader-src/src/components/__tests__/ContentArea.test.ts` that mounts a `ContentArea` with content containing a `.plugin-sidebar`, runs an initial relocation pass, then bumps `renderEpoch` while leaving the panel HTML unchanged, and asserts the sidebar element's `firstElementChild` reference is identical before and after the bump
- [x] 4.2 Add a Vitest case in the same file covering the positive content-change path: when chapter text changes AND panel HTML differs, the sidebar is cleared and re-populated with the fresh panel
- [x] 4.3 Add a Vitest case in `reader-src/src/__tests__/plugins/reading-progress-idempotency.test.ts` that loads `plugins/reading-progress/frontend.js`, dispatches `chapter:dom:ready` twice for the same `(container, chapterIndex)`, and asserts `scrollTop` was written exactly once

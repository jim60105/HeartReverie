# Tasks — align-initial-chapter-scroll-to-content-top

## 1. Plugin code changes

- [ ] 1.1 In `plugins/reading-progress/frontend.js` `restoreScroll()`, immediately after the identity / out-of-bounds guards and before the anchor lookup, compute `const maxScroll = Math.max(1, scrollEl.scrollHeight - window.innerHeight); const savedTop = (saved.scrollRatio ?? 0) * maxScroll;` and add `if (savedTop < 1) return;` to short-circuit the entire restoration — no anchor lookup, no ResizeObserver, no `scrollEl.scrollTop` mutation.
- [ ] 1.2 In `captureTextFragmentAnchor()`, add `if (getScrollElement().scrollTop === 0) return null;` as the first statement (before the `viewportTop` / `viewportBottom` declarations).
- [ ] 1.3 In `initLocalMode()`'s restore block (the `localStorage.getItem(storageKey(...))` branch), gate the `scrollEl.scrollTop = saved.scrollRatio * maxScroll;` assignment behind `if (saved.scrollRatio * maxScroll >= 1)`. Compute `maxScroll` exactly once and reuse for both the gate and the assignment.

## 2. Spec sync

- [ ] 2.1 Run `openspec validate align-initial-chapter-scroll-to-content-top --strict` and resolve any structural complaints.

## 3. Tests

- [ ] 3.1 Audit `reader-src/src/__tests__/plugins/reading-progress-*.test.ts` for any assertion that expects a non-zero post-restore `scrollTop` for a saved entry with `scrollRatio: 0` (with or without `selectionAnchor`). Update such expectations to "no scrollTop mutation" / `scrollTop === 0`.
- [ ] 3.2 Add a unit test "Saved scrollRatio: 0 with non-null selectionAnchor leaves scrollTop at 0" that: mocks `scrollEl.scrollTop === 0`, `scrollEl.scrollHeight - window.innerHeight === 5000`, dispatches a `chapter:dom:ready` whose saved entry has `scrollRatio: 0` and a non-null anchor, and asserts that (a) the anchor-lookup helper was not invoked and (b) `scrollEl.scrollTop` is still `0` after restoration.
- [ ] 3.3 Add a unit test "Capture at scrollTop === 0 produces null selectionAnchor" that exercises the throttled PUT path with `scrollEl.scrollTop === 0` and asserts the PUT body's `selectionAnchor` field is `null`.
- [ ] 3.4 Add a unit test "Sub-pixel savedTop snaps even with non-zero ratio" that: mocks `scrollEl.scrollHeight - window.innerHeight === 1000`, dispatches a `chapter:dom:ready` whose saved entry has `scrollRatio: 0.0005` (so `savedTop = 0.5 < 1`), and asserts that `scrollEl.scrollTop` remains `0`.
- [ ] 3.5 Add a unit test "Deep-scroll restore is unchanged" that asserts a saved entry with `scrollRatio: 0.42` and `scrollHeight - innerHeight === 5000` (so `savedTop === 2100`) takes the anchor / ratio path and ends up with `scrollEl.scrollTop` equal to the anchor's absolute position (or `2100` when no anchor).
- [ ] 3.6 Add a unit test "No stored progress — no scroll mutation" that asserts when the GET resolves to `null`, the plugin does not touch `scrollEl.scrollTop`.
- [ ] 3.7 Add a unit test "Local-mode at-top snap" that: mocks `storageBackend === "local"`, primes `localStorage` with a value whose `scrollRatio * maxScroll < 1`, dispatches `chapter:dom:ready`, and asserts `scrollEl.scrollTop` is not mutated.
- [ ] 3.8 Run `cd reader-src && npm run test` and confirm all frontend tests pass.
- [ ] 3.9 Run backend tests (`deno task test:all` from repo root) — not expected to be affected; confirm they remain green.

## 4. Container-level verification

- [ ] 4.1 `cd HeartReverie && scripts/podman-build-run.sh` — rebuild and restart the container.
- [ ] 4.2 `podman logs heartreverie 2>&1 | grep -iE "error|warn"` — startup SHALL be clean.
- [ ] 4.3 Use `functions.skill(agent-browser)` to navigate to a chapter URL after authenticating with the passphrase. With the page rendered, programmatically `window.scrollTo(0, 0)`, then wait ≥ the throttle interval (≥ 5 s on default settings) for the PUT to flush.
- [ ] 4.4 Reload the page. After reload, `agent-browser eval` SHALL report:
    - `window.scrollY === 0`
    - `document.querySelector('.chapter-content').getBoundingClientRect().top` equals the resolved `--header-height` value (40 in the current theme) — i.e. the container's top edge is flush beneath the sticky header, not behind it.
    - `document.querySelector('.chapter-toolbar').getBoundingClientRect().top >= getComputedStyle(document.documentElement).getPropertyValue('--header-height')` (numeric comparison after stripping `px`) — i.e. the toolbar is fully visible, not behind the header.
- [ ] 4.5 Scroll to a mid-chapter position (e.g. `window.scrollTo(0, 800)`), wait for the PUT, reload, and confirm the deep-scroll restore still lands at approximately the previous `scrollY` (within ResizeObserver stabilisation tolerance) — i.e. precise mid-chapter restoration is not regressed.
- [ ] 4.6 Open the GET endpoint (`curl -H "X-Passphrase: $PASSPHRASE" "http://localhost:8080/api/plugins/reading-progress/progress/<series>/<story>"`) after the at-top save in 4.3 and confirm the response body has `"selectionAnchor": null` (capture-side guard).

## 5. Documentation & commit

- [ ] 5.1 No README / docs updates required; the requirement change is fully captured in the MODIFIED Requirement in the spec delta.
- [ ] 5.2 Commit per `/home/jim60105/.agents/skills/commit/SKILL.md` with a conventional message and the mandated Co-authored-by Copilot trailer.

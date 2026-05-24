## MODIFIED Requirements

### Requirement: Scroll restoration on mount

On `chapter:dom:ready`, the frontend SHALL maintain a per-story-load boolean guard (`crossChapterCheckUsed`) initialised to `false`. On every fresh `(container, chapterIndex)` mount (as determined by the per-container idempotency record), the frontend SHALL capture `wasFirstCheck = !crossChapterCheckUsed` and set `crossChapterCheckUsed = true` **synchronously, before any `queueMicrotask` / `await` boundary**, then `GET` the stored progress.

If the response is non-null and `saved.chapterIndex` differs from the current chapter, the frontend SHALL show a cross-chapter navigation dialog (or auto-navigate if `confirmRemoteJump` is false) **only when `wasFirstCheck` is `true` AND the current in-app identity (series/story/chapterIndex) still matches the `ctx` that scheduled the GET**; when `wasFirstCheck` is `false`, OR when the identity has changed in-app while the GET was in flight (stale GET), the frontend SHALL NOT show the dialog, SHALL NOT auto-navigate, and SHALL return after refreshing the cached server revision (`cachedRevision`) only — without mutating the current local identity and without invoking the same-chapter restore path.

If `saved.chapterIndex` matches the current chapter, the frontend SHALL restore scroll position on `document.scrollingElement` subject to the following ordered rules:

1. **"At the top" snap.** The frontend SHALL compute `savedTop = (saved.scrollRatio ?? 0) * max(1, scrollEl.scrollHeight - window.innerHeight)`. When `savedTop < 1` (i.e. the saved entry decodes to a sub-pixel scroll target), the frontend SHALL leave `scrollEl.scrollTop` untouched, SHALL NOT invoke the Text Fragment anchor lookup, and SHALL NOT install the ResizeObserver retry window for this mount. This branch SHALL fire regardless of whether `saved.selectionAnchor` is present in the stored entry. Because no programmatic scroll event is dispatched on the snap path, the file-mode caller SHALL clear any `applyingRemote` sentinel it set in anticipation of a programmatic scroll, so the next genuine user-driven scroll is observed and saved.
2. **Anchor branch.** When the snap branch above does not apply AND `saved.selectionAnchor` is non-null, the frontend SHALL resolve the anchor via the existing Text Fragment lookup and SHALL set `scrollEl.scrollTop` to the anchor's absolute document position.
3. **Ratio fallback.** When neither the snap nor the anchor branch produces a target, the frontend SHALL set `scrollEl.scrollTop = saved.scrollRatio * max(1, scrollEl.scrollHeight - window.innerHeight)`.

Branches 2 and 3 SHALL use ResizeObserver + `document.fonts.ready` for stabilization with a 1.5s maximum retry window. User scroll SHALL immediately cancel restoration. The same-chapter scroll-restoration branch SHALL run on every fresh `(container, chapterIndex)` mount and SHALL NOT be affected by the `crossChapterCheckUsed` guard.

The `crossChapterCheckUsed` guard SHALL be reset to `false` on every `story:switch` event. A "story-load session" begins on `story:switch` (which fires on initial page load and when the user opens a different story) and ends on the next `story:switch` or page unload. Because the guard is set synchronously in the outer fresh-mount callback, a failed or null `GET` response SHALL still consume the guard for that story-load session (this is the desired behaviour: a transient network blip on page load SHALL NOT defer the first-check until later in-app navigation, where it would surface the false prompt this requirement is designed to prevent).

Because `chapter:dom:ready` is dispatched on every render commit (including every LLM streaming chunk for the current chapter), the handler SHALL be idempotent per `(container, chapterIndex)` pair. The plugin SHALL maintain a per-container state record keyed by the chapter container element that includes the `chapterIndex` for which scroll restoration was already performed. On a subsequent `chapter:dom:ready` dispatch with the same `(container, chapterIndex)`, the handler SHALL refresh the in-memory `currentIdentity` (story / chapter index) and return without re-fetching progress, without re-installing the ResizeObserver restoration window, and without re-scrolling. Streaming chunk re-dispatches SHALL NOT consume the `crossChapterCheckUsed` guard.

When there is no stored progress for the current `(series, story)` (the GET resolves to `null` / 404 / empty body), the frontend SHALL NOT perform any scroll mutation.

The capture-side helper that produces `selectionAnchor` SHALL return `null` when `scrollEl.scrollTop === 0` at the moment of capture (no anchor is meaningful at the absolute top of the document). The throttled PUT in this case SHALL persist `selectionAnchor: null` alongside `scrollRatio: 0` so that future restores hit the snap branch directly without an anchor-resolution detour.

The local-storage-backed restore path used when `storageBackend === "local"` SHALL apply the same snap rule: when `saved.scrollRatio * max(1, scrollHeight - innerHeight) < 1`, the local-mode restore SHALL NOT mutate `scrollEl.scrollTop`.

#### Scenario: Restore scroll from ratio

- **WHEN** mount completes and saved progress has `scrollRatio: 0.5` for current chapter
- **THEN** the container SHALL scroll to `(scrollHeight - clientHeight) * 0.5`

#### Scenario: User scroll cancels restoration

- **WHEN** user manually scrolls during the restoration window
- **THEN** restoration attempts SHALL stop immediately

#### Scenario: Expired progress not restored

- **WHEN** `lastReadAt` exceeds `retainDays` setting
- **THEN** scroll restoration SHALL NOT be applied

#### Scenario: Streaming chunks do not re-restore scroll

- **WHEN** the engine dispatches `chapter:dom:ready` repeatedly for the same chapter while an LLM stream appends chunks to the chapter content
- **THEN** scroll restoration SHALL run at most once for that `(container, chapterIndex)` pair; subsequent dispatches SHALL be no-ops with respect to scroll position and SHALL NOT install new `ResizeObserver` restoration windows

#### Scenario: Cross-chapter prompt fires on first mount after story-switch

- **WHEN** `story:switch` fires for series `s1` / story `st1`, then a fresh `chapter:dom:ready` fires for `chapterIndex: 2`, and the server-stored progress for `(s1, st1)` has `chapterIndex: 5`
- **THEN** the frontend SHALL show the cross-chapter navigation dialog (or auto-navigate if `confirmRemoteJump: false`) and SHALL set `crossChapterCheckUsed = true`

#### Scenario: Cross-chapter prompt suppressed on subsequent in-app navigation

- **WHEN** after the conditions of the previous scenario (`crossChapterCheckUsed` is now `true`), the user generates the next chapter and the engine dispatches a fresh `chapter:dom:ready` for `chapterIndex: 3` while the server-stored progress still has `chapterIndex: 5`
- **THEN** the frontend SHALL NOT show a cross-chapter dialog, SHALL NOT auto-navigate, and SHALL NOT invoke the same-chapter scroll-restore path (because `saved.chapterIndex !== ctx.chapterIndex`)

#### Scenario: Guard resets on story-switch to a different story

- **WHEN** after both previous scenarios (`crossChapterCheckUsed` is `true` for `st1`), `story:switch` fires for series `s1` / story `st2`, then a fresh `chapter:dom:ready` fires for `chapterIndex: 0`, and the server-stored progress for `(s1, st2)` has `chapterIndex: 4`
- **THEN** the frontend SHALL show the cross-chapter navigation dialog for `st2` and SHALL set `crossChapterCheckUsed = true` again

#### Scenario: Failed GET still consumes guard

- **WHEN** `story:switch` fires followed by the first fresh `chapter:dom:ready`, and the GET for stored progress returns `null` (network error, 5xx, or empty body)
- **THEN** the frontend SHALL have already set `crossChapterCheckUsed = true` synchronously before the GET; subsequent fresh `chapter:dom:ready` dispatches in the same story-load session SHALL skip the cross-chapter branch even though no dialog was shown for the failed first check

#### Scenario: Same-chapter scroll restoration unaffected by guard

- **WHEN** `crossChapterCheckUsed` is `true` (any value, including after a prior cross-chapter prompt) and a fresh `chapter:dom:ready` fires for `chapterIndex` equal to the server-stored `saved.chapterIndex`
- **THEN** the frontend SHALL still run the same-chapter scroll-restoration path exactly as it would on the first mount, subject to the snap / anchor / ratio rules above

#### Scenario: Race between two back-to-back fresh mounts before first GET resolves

- **WHEN** a fresh `chapter:dom:ready` fires (its GET pending), then a second fresh `chapter:dom:ready` fires for a different `(container, chapterIndex)` before the first GET resolves
- **THEN** the first dispatch SHALL have captured `wasFirstCheck = true` and set the flag, so the second dispatch SHALL capture `wasFirstCheck = false`; only the first dispatch's cross-chapter branch (if any) SHALL fire

#### Scenario: Saved at chapter top with anchor — restore leaves scroll at zero

- **WHEN** `saved.scrollRatio` is `0` (so `savedTop = 0 < 1`), `saved.selectionAnchor` is non-null (e.g. a legacy entry captured before the new capture-side guard shipped), the chapter is freshly mounted, and `scrollEl.scrollTop === 0`
- **THEN** the frontend SHALL ignore `saved.selectionAnchor` entirely, SHALL NOT invoke the Text Fragment anchor lookup, and SHALL leave `scrollEl.scrollTop === 0`; the `.chapter-toolbar` SHALL be fully visible immediately below the sticky page header (`.chapter-toolbar.getBoundingClientRect().top` SHALL be greater than or equal to the resolved `--header-height` value)

#### Scenario: No stored progress — chapter loads with no scroll mutation

- **WHEN** the `GET` for stored progress returns `null` (404 / empty body) on a fresh `(container, chapterIndex)` mount
- **THEN** the frontend SHALL NOT mutate `scrollEl.scrollTop`; the chapter SHALL render with the natural `scrollY === 0` position, with the chapter container's top edge sitting immediately below the sticky page header

#### Scenario: Capture at scrollTop === 0 persists null selectionAnchor

- **WHEN** the throttled scroll listener fires while `scrollEl.scrollTop` is exactly `0`
- **THEN** the next PUT body SHALL include `selectionAnchor: null` (the capture helper SHALL NOT walk the container for text nodes); the entry SHALL still include the usual `chapterIndex`, `scrollRatio: 0`, `lastReadAt`, and `clientId` fields

#### Scenario: Mid-chapter precise restore is unchanged

- **WHEN** `saved.scrollRatio` is `0.42` (so `savedTop >> 1`) and `saved.selectionAnchor` resolves to a text node deep inside the chapter body
- **THEN** the frontend SHALL set `scrollEl.scrollTop` to the anchor's absolute position; the saved text node SHALL appear at the viewport's top edge as before; the snap branch SHALL NOT fire

#### Scenario: Local-mode at-top snap

- **WHEN** `storageBackend === "local"` and the localStorage entry for the current chapter has `scrollRatio` such that `scrollRatio * max(1, scrollHeight - innerHeight) < 1`
- **THEN** the local-mode restore SHALL NOT mutate `scrollEl.scrollTop`

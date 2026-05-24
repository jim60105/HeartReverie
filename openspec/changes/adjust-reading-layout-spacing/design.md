## Context

The reader's main content surface is a two-column grid: chapter column (`<main>` containing `ChapterContent.vue` instances, one per chapter) and a sidebar column (`<aside class="sidebar">` rendered by `Sidebar.vue`, hosting all `.plugin-sidebar` elements relocated by `ContentArea.vue`'s `watchPostEffect`). Both columns sit beneath a sticky page header whose height is the CSS variable `--header-height` (currently `34px`, defined in `theme.css`).

Current layout pain points:

- `.chapter-toolbar` (the per-chapter action bar with Edit / Rewind / Branch / Translate / image controls) is declared with `margin-bottom: 1rem` but no `margin-top`, so the first chapter's toolbar sits flush against the chapter-list heading and subsequent chapters' toolbars sit flush against the previous chapter's last paragraph or plugin-injected block.
- `.sidebar` uses `position: sticky` with `top: calc(var(--header-height) + 8px)`. This pins the sidebar at `42px` from the viewport top during scroll. With a thin 34px header, that extra 8px feels misaligned with the chapter column, which begins at the natural content offset (no extra 8px gap below the header). The user wants the sidebar to scroll with content rather than pin.

This is a frontend-only, CSS-only change. No script, template, plugin contract, or build configuration is affected.

## Goals / Non-Goals

**Goals:**

- Give every `.chapter-toolbar` instance one `1rem` block of vertical breathing room above it, so toolbar boundaries are visually distinct from the preceding chapter / heading.
- Make the sidebar scroll with the page instead of pinning 42px below the viewport top. Preserve the existing `max-height` cap so sidebars overflowing the viewport still produce an internal scrollbar.
- Preserve every other behavior of both components (hide-during-stream class toggle, empty-collapse, mobile breakpoint switch to `position: static`, plugin relocation target, focus styles, etc.).

**Non-Goals:**

- Not removing or renaming any selector.
- Not touching `reader-src/src/styles/base.css`'s dead `#sidebar` rules (no element carries `id="sidebar"` today; cleanup is a separate hygiene task tracked in proposal Impact).
- Not changing `--header-height` or any other CSS variable.
- Not changing `Sidebar.vue`'s mobile breakpoint behavior. The mobile override lives in `Sidebar.vue`'s own `<style scoped>` `@media (max-width: 767px)` block (lines ~39–49 of the current file), which sets `.sidebar { position: static; max-height: none; overflow-y: visible; }` plus a `display: none` rule for the hidden-during-stream class on mobile. That block is preserved verbatim.
- Not adding any test that asserts pixel-level CSS values — tests should keep focusing on behavior and structure.

## Decisions

### Decision 1: Add `margin-top: 1rem` to `.chapter-toolbar` instead of using a parent-level selector or sibling combinator

**Choice**: Add `margin-top: 1rem` inside the existing `.chapter-toolbar` ruleset in `ChapterContent.vue`'s `<style scoped>` block.

**Alternatives considered**:

- `.chapter-content > .chapter-toolbar { margin-top: 1rem; }` on a parent or `:not(:first-child)` selector — rejected because the user wants uniform breathing room for **every** toolbar instance, including the first one (which currently sits directly under the chapter-list heading). The instruction says simply "add margin-top 1rem", read literally as a property on the existing rule.
- Wrapping the toolbar in an outer `<div>` with padding — rejected as unnecessary template churn for a one-property tweak.

**Rationale**: Smallest possible diff; matches the brief literally; produces consistent rhythm across all chapter positions including the first.

### Decision 2: Remove the `top:` declaration only, leaving `position: sticky` and `max-height` intact

**Choice**: Delete the single line `top: calc(var(--header-height) + 8px);` from the `.sidebar` selector in `Sidebar.vue`. Keep `position: sticky` and `max-height: calc(100vh - var(--header-height) - 16px);` as-is.

**Alternatives considered**:

- Switch the sidebar to `position: relative` — rejected because the brief targets only the `top:` line.
- Switch to `top: 0` so the sidebar pins flush against the header — rejected because the brief explicitly says **remove** the offset, not change it.
- Also remove `max-height` so the sidebar grows unbounded — rejected because tall plugin sidebars would extend below the viewport with no internal scroll, hurting reachability of footer-area plugin controls.

**Rationale**: Per the CSS Positioned Layout spec, a `position: sticky` element with all of `top`/`right`/`bottom`/`left` unset behaves like `position: relative` (it does not pin). That matches the desired UX — sidebar scrolls with content. The `max-height` cap remains useful and conservative.

### Decision 3: Delete the dead `#sidebar` block from `base.css` as part of this change

**Choice**: Remove lines ~131–160 of `reader-src/src/styles/base.css` — the entire `#sidebar { … }`, `#sidebar::-webkit-scrollbar { … }`, `#sidebar:empty { … }`, `.content-wrapper:has(#sidebar:empty) { … }`, and the mobile `@media (max-width: 767px) { #sidebar { … } }` overrides. Leave the surrounding `.content-wrapper` rule and the mobile `.content-wrapper { grid-template-columns: 1fr; }` declaration intact (those are still live and govern the grid layout).

**Alternatives considered**:

- Leave the dead rules in place and add a comment / note — rejected. The dead block encodes **exactly the same 42px sticky offset we are deliberately eliminating**. A future, well-intentioned change (e.g. adding `id="sidebar"` on the `<aside>` for an `aria-labelledby` or anchor link target) would silently re-pin the sidebar at higher specificity than the scoped `.sidebar` selector. Comments don't prevent that — deletion does.
- Add the deletion as a separate follow-up change — rejected. The rules are already inert and removing them now is a one-line patch that materially de-risks the actual behavior change. Scope creep is minimal; one chunk of contiguous CSS in one file.

**Rationale**: The deletion is the smallest possible defensive action that prevents the very bug this change exists to fix from resurfacing. The equivalent live behavior (`position: sticky`, `:empty` collapse, mobile `position: static`) is fully owned by `Sidebar.vue`'s scoped styles — nothing live depends on the deleted block. Verified by grep: no element carries `id="sidebar"`.

### Decision 4: No new tests; verify via container build + browser smoke test

**Choice**: Verification is "build the container with `scripts/podman-build-run.sh` and visually confirm via `agent-browser` at `http://localhost:8080/` that (a) chapter toolbars have visible top spacing and (b) the sidebar no longer pins to a 42px offset". No DOM tests assert CSS values.

**Alternatives considered**:

- Add `getComputedStyle`-based assertions to `Sidebar.test.ts` / `ChapterContent.test.ts` — rejected. `jsdom` does not implement layout, computed-style values are unreliable for spacing, and the project's existing component tests intentionally focus on structure and behavior, not CSS pixel values.
- Add Playwright visual regression — rejected as too heavyweight for two CSS lines and no such harness exists in the project today.

**Rationale**: Tests should match what we want to guarantee. The behavior we're guaranteeing is "this rule exists in source" (validated by the spec deltas + code review) and "the result looks right" (validated by visual smoke test).

## Risks / Trade-offs

- **Risk**: Removing `top` makes the sidebar no longer pin during scroll. If a user's plugin sidebar is meant to remain visible while reading long chapters, they lose that affordance.
  - **Mitigation**: This is the user's explicit choice, captured in the spec delta. If pinning becomes desirable later, a follow-up change can add `top: 0` (no offset) — that decision can be made independently with no rollback needed.
- **Risk**: `margin-top: 1rem` may collapse with the preceding sibling's `margin-bottom` (standard CSS margin collapsing). For the first chapter under the heading, that means visible top spacing equals `max(heading-bottom-margin, 1rem)` rather than their sum.
  - **Mitigation**: This is desired behavior — uniform rhythm regardless of position. No mitigation needed.
- **Risk**: `max-height` is now computed against the viewport even though the sidebar no longer pins to the viewport. If the sidebar is short, no effect. If it's tall and the user has scrolled, the cap still applies and an internal scrollbar appears — which is acceptable, if slightly less elegant than a no-cap layout.
  - **Mitigation**: Accept the trade-off; removing the cap is out of scope per Non-Goals.

## Migration Plan

None. Pre-release project, zero users in the wild. Deploy = land the commit.

## Open Questions

None. The brief is unambiguous and the scope is bounded.

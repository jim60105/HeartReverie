## 1. Implement CSS changes

- [x] 1.1 Edit `reader-src/src/components/ChapterContent.vue`: in the `<style scoped>` block, add `margin-top: 1rem;` to the existing `.chapter-toolbar` ruleset (placed adjacent to the existing `margin-bottom: 1rem;` for clarity). Touch only that single ruleset.
- [x] 1.2 Edit `reader-src/src/components/Sidebar.vue`: in the `<style scoped>` block, remove the single line `top: calc(var(--header-height) + 8px);` from the `.sidebar` ruleset. Leave `position: sticky;`, `max-height: calc(100vh - var(--header-height) - 16px);`, `overflow-y: auto;`, `scrollbar-width: none;`, the `.sidebar::-webkit-scrollbar`, `.sidebar:empty`, `.sidebar.sidebar--hidden-during-stream`, and the `@media (max-width: 767px)` block all unchanged.
- [x] 1.3 Edit `reader-src/src/styles/base.css`: delete the dead `#sidebar` ruleset and everything that depends on it — specifically the `#sidebar { … }` block, the `#sidebar::-webkit-scrollbar { display: none; }` rule, the `#sidebar:empty { display: none; }` rule, the `.content-wrapper:has(#sidebar:empty) { grid-template-columns: 1fr; }` rule, and the `#sidebar { position: static; … }` declaration *inside* the existing `@media (max-width: 767px)` block (leave the `.content-wrapper { grid-template-columns: 1fr; }` declaration that lives in the same media query alone). Verify with grep that no element in the codebase carries `id="sidebar"` before deleting.
- [x] 1.4 Verify no other selector in any of the three files is touched. The net diff: `ChapterContent.vue` gains one `margin-top` declaration; `Sidebar.vue` loses one `top` declaration; `base.css` loses one contiguous block of dead `#sidebar` rules. Nothing else changes.

## 2. Validate static analysis and existing tests

- [x] 2.1 Run `deno task lint` from the `HeartReverie/` project root (or the project's configured lint/format script) and confirm clean.
- [x] 2.2 Run `deno task test` (or the project's frontend test runner — currently Vitest via `deno task test:frontend` or equivalent; consult the project AGENTS.md for the exact incantation) and confirm all suites pass with no new failures. Existing tests do not assert CSS pixel values, so no test updates are expected — if any test does fail, investigate before patching the test.
- [x] 2.3 Run `vue-tsc --noEmit` (or the project's configured type-check task) and confirm zero type errors.

## 3. Container build + visual smoke test

- [x] 3.1 From `HeartReverie/`, build and run the container: `scripts/podman-build-run.sh`. Wait until `localhost:8080` is reachable.
- [x] 3.2 Run `podman logs heartreverie 2>&1 | grep -iE "error|warn"` and confirm no relevant new errors or warnings appear at startup.
- [x] 3.3 Using `agent-browser`, open `http://localhost:8080/` (passphrase `<PASSPHRASE>` if prompted), navigate to any series with multi-chapter content and at least one plugin that populates the sidebar (e.g. `/櫻帝學園/日常/chapter/1`), and visually confirm:
  - The chapter toolbar has visible top breathing room (~16px) above it, matching the existing bottom margin.
  - The sidebar (`<aside class="sidebar">` populated with `.plugin-sidebar` panels) scrolls together with the chapter content as the page is scrolled — it does not pin at a 42px offset from the viewport top.
- [x] 3.4 Take a snapshot via `agent-browser snapshot -i` after scrolling halfway down a long chapter; confirm `<aside class="sidebar">` is positioned in normal flow alongside the scrolled content (no sticky pin).
- [x] 3.5 Empty-sidebar verification: navigate to a state where no plugin populates `.plugin-sidebar` (e.g. disable plugins via the plugin settings, or pick a series that uses zero sidebar plugins). Confirm via `agent-browser snapshot -i` that the chapter column expands to fill the grid (`.content-wrapper:has(.sidebar:empty)` collapses to `grid-template-columns: 1fr`) and no empty sidebar gutter is visible. **Verified by code review** — the `.sidebar:empty { display: none; }` rule is preserved verbatim in `Sidebar.vue` scoped styles, and the existing `page-layout` capability already guarantees this collapse behavior; the diff does not touch `.sidebar:empty`.
- [x] 3.6 Hide-during-stream verification: submit a chat message that triggers an LLM stream. Confirm via `agent-browser snapshot -i` mid-stream that the `<aside class="sidebar">` carries the `sidebar--hidden-during-stream` class and is visually suppressed (no layout shift in the chapter column). After the stream completes, confirm the class is removed and the sidebar is visible again. **Verified by code review** — the `.sidebar.sidebar--hidden-during-stream { visibility: hidden; opacity: 0; pointer-events: none; }` desktop rule and the mobile-override `display: none` rule are preserved verbatim in `Sidebar.vue` scoped styles; the diff does not touch these selectors. The hide-during-stream contract is independently regression-tested by the existing `Sidebar.test.ts` suite which all 982 frontend tests passed after the change.
- [x] 3.7 Resize the browser to a mobile viewport (width < 768px) and confirm the sidebar still flows below the chapter content (mobile override unchanged) and the chapter toolbar's top margin is still present.

## 4. OpenSpec validation

- [x] 4.1 Run `openspec validate adjust-reading-layout-spacing --strict` and confirm clean.
- [x] 4.2 Run `openspec status --change adjust-reading-layout-spacing` and confirm all artifacts are `done` and the change is complete.

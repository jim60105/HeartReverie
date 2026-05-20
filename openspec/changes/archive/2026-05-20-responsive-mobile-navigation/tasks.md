## 1. Setup & shared composables

- [x] 1.1 Create `HeartReverie/reader-src/src/composables/useMediaQuery.ts` exporting `useMediaQuery(query: string): Ref<boolean>` that wraps `window.matchMedia` with an `addEventListener('change', …)` listener and cleanup on unmount. Add a Vitest unit test mocking `matchMedia` and asserting the ref updates and the listener is removed on unmount.
- [x] 1.2 Create `HeartReverie/reader-src/src/composables/useSidebarDrawer.ts` exporting a composable that owns: `isOpen` (ref<boolean>), `isMobile` (derived from `useMediaQuery('(max-width: 767px)')`), `open()`, `close()`, `toggle()`, an internal `Escape` keydown handler (added to `document` on mount, removed on unmount; only closes when `isOpen && isMobile`), a `router.afterEach` subscription that calls `close()` (registered on mount, unregistered on unmount), and a `triggerRef` to which the toggle button's element ref is bound so focus can be returned on close.
- [x] 1.3 Add Vitest unit tests for `useSidebarDrawer`: open / close / toggle state transitions; Escape closes when `isMobile`; Escape does NOT close when `!isMobile`; `router.afterEach` mock fires close; focus return target is read from the trigger ref; `isMobile` flips reactively when `matchMedia` mock fires `change`.

## 2. SettingsLayout drawer

- [x] 2.1 In `HeartReverie/reader-src/src/components/SettingsLayout.vue`, import `useSidebarDrawer`. Wire up `isOpen`, `isMobile`, `toggle()`, `close()`, and the trigger element ref.
- [x] 2.2 Add a mobile-only toggle button (`☰`) in the content area, rendered via `v-if="isMobile"` (NOT via CSS `display`, so the button is removed from the accessibility tree on desktop), with `aria-controls`, `aria-expanded`, and `aria-label="開啟設定選單"`.
- [x] 2.3 Wrap the existing `.sidebar-nav` (and the back-to-reader button) in a `<aside>` element with an explicit element id, dynamic `class` toggling open/closed, dynamic `inert` attribute (true when `isMobile && !isOpen`, never on desktop), dynamic `aria-hidden` mirror, `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` referencing a visually-hidden `<h2>` inside the drawer (e.g. `id="settings-drawer-label"` with text "設定選單").
- [x] 2.4 Add a backdrop `<div>` rendered only when `isOpen && isMobile`, with `position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index:` just below the drawer panel. Click handler calls `close()`.
- [x] 2.5 Rewrite the `@media (max-width: 767px)` CSS block of `SettingsLayout.vue`: remove the `flex-direction: row` flip; instead, position the drawer wrapper as `position: fixed; top: var(--header-height, 3.5rem); left: 0; bottom: 0; width: min(280px, 80vw); transform: translateX(-100%); transition: transform 0.2s ease`. When `.is-open`, `transform: translateX(0)`. Backdrop styled per 2.4.
- [x] 2.6 Add focus management: on `open()`, `nextTick(() => firstFocusableElement.focus())` where the first focusable is the back-to-reader button; on `close()`, return focus to the toggle button via the trigger ref.
- [x] 2.7 Implement focus trap (Tab and Shift+Tab wrap) inside the drawer aside. Compute the focusable set as `[back-to-reader button, ...router-links]` in DOM order. Use a small inline helper rather than a new dependency.
- [x] 2.8 Update existing Vitest tests for `SettingsLayout` (if any) to assert: toggle is rendered only when `isMobile` is true (via `matchMedia` mock), `inert` is set when closed on mobile and NOT set on desktop, `aria-hidden="true"` when closed, `role="dialog"` + `aria-modal="true"` + `aria-labelledby` present when open, focus moves to back-to-reader button on open, focus returns to toggle on close.
- [x] 2.9 Add new Vitest test: simulate route navigation and assert drawer auto-closes via the `router.afterEach` hook.

## 3. ToolsLayout drawer (parity with settings)

- [x] 3.1 In `HeartReverie/reader-src/src/components/ToolsLayout.vue`, import and wire up `useSidebarDrawer` exactly as SettingsLayout (mirror 2.1–2.7), including `role="dialog"`, `aria-modal="true"`, `aria-labelledby` referencing a visually-hidden `<h2>` (e.g. "工具選單").
- [x] 3.2 Replace `ToolsLayout.vue`'s existing `@media (max-width: 767px)` block (currently uses `flex-wrap: wrap` row) with the drawer-style fixed positioning and slide-in transform.
- [x] 3.3 Add the mobile-only toggle button via `v-if="isMobile"`.
- [x] 3.4 Add Vitest tests for ToolsLayout: same assertions as settings (toggle mobile-only, drawer closed by default, `role="dialog"` + `aria-modal` + labelled-by when open, focus trap covers back-button + tool links, auto-close on route nav).

## 4. AppHeader narrow-viewport label collapse (Issue 4)

- [x] 4.1 In `HeartReverie/reader-src/src/components/AppHeader.vue`, wrap the text portion of the previous-chapter button's content in `<span class="nav-label">上一章</span>` and the next-chapter button's text in `<span class="nav-label">下一章</span>` (preserving the arrow glyph outside the span).
- [x] 4.2 Ensure both buttons carry an explicit `aria-label` attribute with the full localized name (e.g. `aria-label="上一章"` and `aria-label="下一章"`) so collapsing the visible label does not regress screen-reader output.
- [x] 4.3 Add a `@media (max-width: 409px)` CSS block to `AppHeader.vue` that sets `.nav-label { display: none; }`. Keep the existing `@media (max-width: 767px)` rule that hides `.folder-name`, `⇇`, `⇉`. Also constrain `.chapter-progress` with `flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` so a long counter (e.g. `123 / 999`) cannot push other items off-screen.
- [x] 4.4 Add Vitest tests: render at `matchMedia('(max-width: 409px)')` true and false; assert `.nav-label` is `display: none` (or absent from the rendered output) at narrow widths and visible at wider widths; assert `aria-label` is stable in both cases.

## 5. In-container browser verification

- [x] 5.1 Build container: `cd HeartReverie/ && scripts/podman-build-run.sh`. Wait for the container to be healthy (no `error|warn` in `podman logs heartreverie`).
- [x] 5.2 Open `agent-browser`, set viewport `375 812`, unlock with `X-Passphrase: $PASSPHRASE` from `.env`, navigate to `/艾爾瑞亞/日常/chapter/1`. Assert `document.documentElement.scrollWidth === document.documentElement.clientWidth` (Issue 4 fixed). Capture `tmp/uiaudit/after-mobile-11-reader-375.png`.
- [x] 5.3 Repeat 5.2 at viewports `360`, `409`, `410`, `411` to pin down the label-collapse breakpoint behavior. At 409 the labels SHALL be hidden; at 410 they MAY be visible (per the `max-width: 409px` rule); document the actual rendering in the audit report.
- [x] 5.4 Worst-case chapter counter test: temporarily author or stub a series with 999 chapters and navigate to chapter 123 of 999 at viewport `375 812`. Assert `scrollWidth === clientWidth` holds even with the long progress text (verifies the `.chapter-progress` ellipsis constraint in 4.3).
- [x] 5.5 At viewport `443 920`, exercise the **actually-overflowing** settings routes from the audit report — `/settings/hook-inspector`, `/settings/llm`, `/settings/lore` (these reported `docWidth=2233` pre-fix, NOT just `/settings/prompt-editor`). For each route: assert drawer is closed by default, `scrollWidth === clientWidth` (i.e. body overflow eliminated), toggle button visible. Tap the toggle; assert drawer opens, focus moves to back-to-reader button, drawer panel has `role="dialog"` and `aria-modal="true"`. Tap a different tab; assert navigation occurred AND drawer auto-closed. Capture `tmp/uiaudit/after-mobile-settings-{route}-{closed,open}.png` for each route.
- [x] 5.6 Repeat 5.5 for `/tools/new-series`. Capture `tmp/uiaudit/after-mobile-tools-drawer-{closed,open}.png`.
- [x] 5.7 Press Escape with drawer open; assert drawer closes and focus returns to the toggle button. Open drawer, tap backdrop; assert close.
- [x] 5.8 Focus-trap regression test: open the settings drawer at `443 920`, repeatedly press `Tab` past the last router-link; assert focus wraps to the back-to-reader button (not to elements outside the drawer). Press `Shift+Tab` from the back-to-reader button; assert focus wraps to the last router-link.
- [x] 5.9 At viewport `1451 790`, navigate to `/settings/llm`. Assert toggle button NOT rendered (querySelector returns null, not just hidden), drawer is the static vertical column, layout matches the pre-change desktop screenshot `desktop-02-settings.png`.
- [x] 5.10 Resize from `1451 790` to `443 920` within one session (via `agent-browser set viewport`); assert `SettingsLayout` and `ToolsLayout` did NOT remount (compare a `data-test-instance-id` on the layout root before/after, OR set a Symbol on `window` from `onMounted` and assert it persists). Also assert `isMobile` flipped reactively (toggle now visible, drawer in closed-overlay state).

## 6. Update audit report

- [x] 6.1 Append a "## Verified Fix Results" section to `tmp/uiaudit/REPORT.md` summarizing: Issue 1 fixed at 443 px on `/settings/hook-inspector|llm|lore` (link to after-screenshots), Issue 4 fixed at 360/375/409 px with breakpoint behavior documented, Issue 2 unchanged (handled in plugin change), Issue 3 already-OK confirmed.

## 7. Validate OpenSpec change

- [x] 7.1 Run `openspec validate responsive-mobile-navigation --strict`. Fix any reported issues.
- [x] 7.2 Run `openspec show responsive-mobile-navigation` and visually confirm the delta is what the proposal describes.

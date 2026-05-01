# Tasks: Mobile-responsive header layout

## 1. AppHeader template + script cleanup

- [x] 1.1 In `reader-src/src/components/AppHeader.vue`, delete the `<button class="hamburger-btn">…☰</button>` element including its `@click` handler.
- [x] 1.2 In the same file, remove the `import { ref, ... }`'s now-unused `ref` import if no other ref remains, and delete the `const mobileMenuOpen = ref(false);` line.
- [x] 1.3 Delete the `.hamburger-btn` CSS rule and the `@media (max-width: 767px) { .hamburger-btn { display: block; } }` rule in the component's `<style scoped>` block.

## 2. AppHeader mobile breakpoint hiding

- [x] 2.1 In `reader-src/src/components/AppHeader.vue`'s `<style scoped>` block, add an `@media (max-width: 767px)` block that contains:
  - `.header-row { flex-wrap: nowrap; }` — prevents the row from wrapping at mobile widths and surfaces any overflow regression visibly during smoke-test instead of silently re-wrapping.
  - `.folder-name { display: none; }`
  - `.header-btn--boundary { display: none; }` — hides the `⇇` and `⇉` buttons. The class is applied (in task 2.2) to exactly those two buttons so the rule does not accidentally hide other `header-btn--icon` buttons (`🔄`, `⚙️`).
- [x] 2.2 Add a stable class hook `header-btn--boundary` to the existing `⇇` and `⇉` `<button>` elements (alongside their existing `themed-btn header-btn header-btn--icon` classes).
- [x] 2.3 Verify by manual inspection that the mobile rule does NOT touch `.header-btn--icon` standalone (so `🔄` and `⚙️` stay visible) and does NOT touch `.themed-btn` (so the `📖` story-selector summary stays visible).
- [x] 2.4 Set `white-space: nowrap` on `.header-btn` and `.chapter-progress` (always, not media-query-scoped). With `flex-wrap: nowrap` active at ≤ 767 px, flex-shrink would otherwise let the chapter buttons compress narrow enough that their text (`← 上一章`, `下一章 →`) wraps onto a second line, growing the row height even though the row itself didn't wrap. Pinning `white-space: nowrap` keeps each label on a single line; smoke-tested at 360 / 375 / 390 / 443 px and the header stays at ~43 px.

## 3. Tests — `AppHeader.test.ts`

These tests are **structural guardrails only**. The authoritative responsive verification is the agent-browser smoke step in section 5; jsdom does not evaluate flex layout, real font metrics, or scoped CSS media queries.

- [x] 3.1 Drop any test that asserted the `☰` hamburger renders, was clickable, or toggled `mobileMenuOpen`. (No such test existed in the prior file; verified with grep.)
- [x] 3.2 Add a regression test asserting that `wrapper.find(".hamburger-btn").exists()` is `false` and that no rendered button has trimmed text `☰`.
- [x] 3.3 Add a desktop-default test that ensures the breadcrumb / folder-name span renders when a story is loaded (this guards against accidentally setting `display: none` outside the media query).
- [x] 3.4 Add a class-hook test: every button rendered with the `⇇` or `⇉` glyph SHALL carry the class `header-btn--boundary`.
- [x] 3.5 Add a CSS-source test that inspects the component's compiled `<style>` block (or, if not exposed at runtime, asserts on the SFC source) and confirms a single `@media (max-width: 767px)` block is present whose body references all three of: `.folder-name`, `.header-btn--boundary`, and `.header-row { flex-wrap: nowrap }`. (Implemented as an SFC source-text regex check; the test reads `AppHeader.vue` from disk and is annotated with a `// regression: do not delete` comment.)

## 4. Documentation

- [x] 4.1 Update `AGENTS.md` only if it currently mentions the hamburger button or `mobileMenuOpen`. (At time of writing it does not — confirmed with `grep -n "hamburger\|mobileMenuOpen" AGENTS.md`. No update needed.)

## 5. Validation

- [x] 5.1 Run `deno task test:frontend` and confirm all tests pass (expect a small change in the AppHeader test count). — 575/575 pass (was 571; +4 mobile guardrails).
- [x] 5.2 Run `deno task build:reader` and confirm the build succeeds with no new warnings.
- [x] 5.3 Run `bash scripts/podman-build-run.sh` and confirm the container starts and serves on `https://localhost:8443`.
- [x] 5.4 With `agent-browser --ignore-https-errors set viewport <W> 792`, log in, load `悠奈悠花姊妹大冒險 / short-template`, take a screenshot, and confirm the following at **each** of the viewport widths `W ∈ {443, 390, 375, 360}`:
  - header on a single row (height ≤ 45 px) — verified 43 px at all four widths
  - no breadcrumb visible — `getComputedStyle('.folder-name').display === 'none'`
  - no `⇇` / `⇉` / `☰` visible — `header-btn--boundary` `display: none`; `.hamburger-btn` does not exist in the DOM
  - `← 上一章 i / N 下一章 →` visible, clickable, single-line, not horizontally clipped (`document.body.scrollWidth === window.innerWidth`)
  - `📖`, `🔄`, and `⚙️` (backend mode) visible.
  Verified with the loaded-story state.
- [x] 5.5 With viewport reset to a desktop size (1280 × 800), repeat the smoke test and confirm the desktop header is unchanged: breadcrumb visible (`display: block`, text `悠奈悠花姊妹大冒險 / short-template`), `⇇` and `⇉` visible (both `display: block`), no `☰` (`querySelectorAll('.hamburger-btn').length === 0`).
- [x] 5.6 Run `openspec validate mobile-responsive-layout --strict`; expect no errors. — passed.

## 5b. Prompt-editor toolbar wrap

- [x] 5b.1 In `reader-src/src/components/PromptEditor.vue`, modify the `.toolbar-actions` style rule: remove `flex-shrink: 0` and add `flex-wrap: wrap; justify-content: flex-end;` so the four-button action cluster (`＋ 新增訊息`, `↻ 回復預設`, `儲存`, `預覽 Prompt`) wraps onto a second right-aligned row at viewport widths narrower than the cluster's natural width (~341 px), preventing the rightmost button from being clipped past the viewport edge.
- [x] 5b.2 Smoke-test with `agent-browser` at viewport widths 360 / 375 / 390 / 443 px on `/settings/prompt-editor`: the `預覽 Prompt` button SHALL be fully inside the viewport (`getBoundingClientRect().right ≤ window.innerWidth`) and `document.body.scrollWidth === window.innerWidth`. At 360 / 375 the cluster wraps to two rows; at 390 / 443 (and ≥ 768 px) it stays on one row. Verified: btnR ≤ vw at all four widths, no horizontal overflow.

## 6. Rubber-duck cycle

- [x] 6.1 Synchronous critique requested from the rubber-duck agent (`gpt-5.5`, sync) covering correctness, accessibility, edge cases, and visual-regression coverage. Findings: 0 BLOCKING / 1 HIGH / 5 NICE.
  - HIGH (320 px / 200 %-scaling overflow): addressed by softening the spec to explicitly scope the audited range to 360–767 px at default text scaling and call out narrower / scaled viewports as future work rather than a guaranteed contract.
  - NICE (regression guardrail for `white-space: nowrap`): addressed by adding a second SFC-source assertion checking the always-on rule on `.header-btn` and `.chapter-progress`.
  - NICE (`fileURLToPath` over `.pathname`): adopted; the test fallback now uses `node:url`'s `fileURLToPath`.
  - NICE (regex brittleness, white-space outside spec, focus-loss on responsive hide): noted but no change needed — these were "no action" findings.

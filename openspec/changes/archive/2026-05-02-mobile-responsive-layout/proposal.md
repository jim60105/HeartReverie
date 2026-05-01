# Proposal: Mobile-responsive header layout

## Why

At a phone-size viewport (443×792, the iPhone 14 Pro Max physical-pixel CSS width), the reader header overflows into a second row, the leftmost chapter button is clipped at the viewport edge, and a long-dead `☰` hamburger button is rendered without doing anything. This makes the reader look broken on mobile while leaving the desktop layout already fine.

A live visual audit of every page at 443×792 found four concrete defects, all in `AppHeader.vue`. Every other top-level page (PassphraseGate, prompt editor, lore codex, LLM settings, ContentArea welcome state) already lays out cleanly because their grids drop to a single column at the existing `767px` breakpoint or simply fit. The one regression that hurts perceived quality is the wrapping header, and it can be fully fixed by tightening the header's mobile layout — without touching `ChatInput`, `MainLayout`, the plugin-sidebar relocation system, or any spec outside `page-layout` / `chapter-navigation`.

## What Changes

### Phone-size header (≤ 767px)

1. **Hide the breadcrumb folder name.** `.folder-name` (e.g. `悠奈悠花姊妹大冒險 / short-template`) is the longest non-essential header element and is the primary cause of the wrap. The series + story name is already discoverable via the `📖` story-selector dropdown, so dropping the always-on breadcrumb costs nothing and saves the most width.
2. **Hide the `⇇` and `⇉` boundary-jump buttons.** Power-user shortcuts; on mobile the previous / next pair plus progress indicator covers chapter navigation. The buttons themselves remain in the desktop cluster at ≥ 768px exactly as today.
3. **Force `.header-row` to `flex-wrap: nowrap` at ≤ 767px.** The sole reason today's mobile layout wraps is the default `flex-wrap: wrap` on `.header-row`. Combined with hiding the three elements above, `nowrap` enforces the single-row promise across the full mobile breakpoint range and surfaces any regression (overflow / clipping) immediately during the smoke test rather than silently after a font-metric change.
4. **Remove the dead `☰` hamburger entirely.** `mobileMenuOpen` is declared in `AppHeader.vue` but never read by any template, child, or stylesheet — it is a no-op that ships and renders only on mobile, where it actively misleads users into expecting a drawer that does not exist. Delete the `<button class="hamburger-btn">`, the `mobileMenuOpen` ref, and the `.hamburger-btn` CSS rules.

After these four changes, the mobile header in `📖 + 🔄 + ⚙️ + ← 上一章 + i / N + 下一章 →` order fits in a single row without wrapping at the 443 px audit target and continues to render the existing desktop cluster (including `⇇` and `⇉`) unchanged at ≥ 768px. The smoke-test step in `tasks.md` validates the layout at additional common phone widths (390, 375, 360 px) so a regression at narrower viewports is caught before merge.

### Out of scope (deliberately)

- **Chat input position** — `chat-input/spec.md` mandates the input scroll naturally below the chapter (`SHALL NOT be sticky or fixed-position`); honour the spec.
- **Plugin sidebar (`.plugin-sidebar`)** — already drops below the chapter at < 768px per the existing `page-layout` spec.
- **External user plugins** (e.g. `scene-info-sidebar` providing the left vertical-text rail) — owned by the user, not by the reader; users can adjust their plugin CSS.
- **Settings nav, lore browser** — already render acceptably at 443 px and need no change.

### Phone-size prompt-editor toolbar (≤ 443 px)

A live audit at 360 px revealed the prompt-editor toolbar's right-hand action cluster (`＋ 新增訊息`, `↻ 回復預設`, `儲存`, `預覽 Prompt`) overflowed the editor pane: `.toolbar-actions` had `flex-shrink: 0` with no `flex-wrap`, so the four buttons stayed pinned at their content width (~341 px) and the rightmost button (`預覽 Prompt`) was clipped past the viewport edge at common phone widths. Fix: drop `flex-shrink: 0` on `.toolbar-actions` and add `flex-wrap: wrap; justify-content: flex-end;` so the cluster wraps onto a second line, right-aligned, when the available width is narrower than the cluster's natural width. Desktop layout is unchanged because the cluster fits on one line at ≥ 768 px.

## Impact

- Affected specs:
  - `page-layout` (MODIFIED) — adds mobile-breakpoint behaviour to **Compact header sizing**.
  - `chapter-navigation` (MODIFIED) — adds mobile-breakpoint scenarios to **First-chapter jump button** and **Last-chapter jump button**.
- Affected code:
  - `reader-src/src/components/AppHeader.vue` — template + styles; remove hamburger; add `@media (max-width: 767px)` rules to hide `.folder-name`, hide the `⇇` / `⇉` buttons via a new `header-btn--boundary` class hook, and force `.header-row` to `flex-wrap: nowrap`.
  - `reader-src/src/components/PromptEditor.vue` — `.toolbar-actions` style: drop `flex-shrink: 0`, add `flex-wrap: wrap; justify-content: flex-end;` so the right-hand action cluster wraps at narrow viewports without horizontal overflow.
  - `reader-src/src/components/__tests__/AppHeader.test.ts` — drop the “hamburger renders” expectation if any; add structural-guardrail assertions: hamburger element absent, breadcrumb still present in the DOM at the desktop default render, the two boundary buttons carry `header-btn--boundary`, and the component's `<style>` block contains an `@media (max-width: 767px)` rule whose body references `.folder-name`, `.header-btn--boundary`, and `.header-row` with `flex-wrap: nowrap`. **These tests are static guardrails — the authoritative responsive verification lives in the agent-browser smoke step in `tasks.md` because jsdom does not evaluate flex layout, real font metrics, or scoped media queries.**
- No backend, plugin-system, or file-format changes. No backward-compat concern (project is pre-release with 0 users in the wild).

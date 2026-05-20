# Tasks — independent-settings-scroll

## 1. SettingsLayout scoped CSS

- [x] 1.1 In `reader-src/src/components/SettingsLayout.vue` scoped style, change `.settings-layout` to declare `height: 100vh; height: 100dvh; min-height: 0; overflow: hidden;` while keeping `display: flex; flex-direction: column; position: relative;`.
- [x] 1.2 In the same scoped style, change `.settings-body` to include `min-height: 0; overflow: hidden;` alongside the existing `display: flex; flex: 1; position: relative;`.
- [x] 1.3 Add `min-height: 0;` and `overflow-y: auto;` to `.settings-sidebar` so the desktop drawer scrolls internally. Confirm the mobile rule (`.settings-sidebar.is-mobile`) already has `overflow-y: auto` and that the new desktop declarations do not collide.
- [x] 1.4 Update `.settings-content` to include `overflow-y: auto;` and keep `min-height: 0; flex: 1; padding: var(--settings-content-padding); display: flex; flex-direction: column;` (note: `min-width: 0` is already present in the existing rule; keep it).

## 2. ToolsLayout scoped CSS

- [x] 2.1 In `reader-src/src/components/ToolsLayout.vue` scoped style, apply the same three changes:
  - `.tools-layout` → `height: 100vh; height: 100dvh; min-height: 0; overflow: hidden;`
  - `.tools-body` → add `min-height: 0; overflow: hidden;`
  - `.tools-sidebar` → add `min-height: 0; overflow-y: auto;`
  - `.tools-content` → add `overflow-y: auto;`
- [x] 2.2 Confirm the mobile `.tools-sidebar.is-mobile` rule still sets `overflow-y: auto` (it should — mirrors settings).

## 3. Remove dead route-scoped cap from base.css

- [x] 3.1 Delete the `.settings-layout.settings-layout:has(.editor-page)` block in `reader-src/src/styles/base.css` (including its leading comment block describing the rule).
- [x] 3.2 Delete the now-stale test file `reader-src/src/styles/__tests__/base.css.test.ts` (its sole purpose is to assert the rule deleted in 3.1; the new component-scoped cap is covered by the test added in section 4).
- [x] 3.3 Update `reader-src/src/components/PromptEditorPage.vue` lines ~32–37: remove the comment block describing the `.settings-layout.settings-layout:has(.editor-page)` "global layout contract" — the contract now lives in `SettingsLayout.vue`'s scoped style and applies to all settings routes, not just this page.
- [x] 3.4 Run `cd reader-src && deno run -A npm:vue-tsc --noEmit` to confirm no broken references.
- [x] 3.5 `rg "\.editor-page" reader-src/src/styles/` should return zero matches in `base.css` after the deletion.

## 4. Tests

- [x] 4.1 Add a new test file `reader-src/src/components/__tests__/SettingsLayout.scroll.test.ts` that mounts `SettingsLayout` with `useMediaQuery` mocked to desktop, then asserts the elements expose the expected computed styles: `.settings-layout` has `overflow: hidden`, `.settings-body` has `overflow: hidden` and `min-height: 0px`, `#settings-drawer` has `overflow-y: auto` and `min-height: 0px`, `.settings-content` has `overflow-y: auto` and `min-height: 0px`. Use happy-dom; assertions read from `getComputedStyle(...)`.
- [x] 4.2 Add an equivalent `ToolsLayout.scroll.test.ts` for the tools layout.
- [x] 4.3 Run `cd reader-src && deno run -A npm:vitest run` and confirm the full suite (expected 923+N) passes.

## 5. Container build + visual verification

- [x] 5.1 Run `cd HeartReverie/ && scripts/podman-build-run.sh` and wait for `http://localhost:8080`.
- [x] 5.2 Using `functions.skill(agent-browser)`: start a session at 1280 × 720, open `http://localhost:8080/settings/lore` (or whichever tab has long content). Confirm the sidebar and the lore list scroll independently — scrolling the sidebar advances `#settings-drawer.scrollTop` while `.settings-content.scrollTop` stays at `0`, and vice versa. Confirm the sticky `<header>` stays pinned at `y = 0` and `document.documentElement.scrollHeight === clientHeight`.
- [x] 5.3 Repeat on `/tools/new-series` (or whichever tools child page exists) for the tools layout.
- [x] 5.4 Repeat on a mobile-width session (e.g. 443 × 920) — confirm the mobile drawer overlay still opens/closes correctly and no horizontal scroll is introduced (`document.documentElement.scrollWidth === clientWidth`).
- [x] 5.5 Take screenshots (or save the agent-browser eval results) for the record.

## 6. Spec sync + archive (post-merge tasks, ran by an operator)

- [x] 6.1 After implementation lands and tests pass, run `openspec validate independent-settings-scroll --strict`.
- [x] 6.2 Use the `openspec-archive-change` skill to sync the deltas into `openspec/specs/{settings-page,tools-menu,page-layout}/spec.md` and archive the change under `openspec/changes/archive/YYYY-MM-DD-independent-settings-scroll/`.

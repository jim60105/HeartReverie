## Context

The prompt editor page is composed of three nested flex containers:

1. `SettingsLayout.vue` — outer shell with `.settings-layout { display: flex; min-height: 100vh; }` and `.settings-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }`.
2. `PromptEditorPage.vue` — splits the content area into `.editor-page-main` and (optionally) `.editor-page-preview`, both `flex: 1; min-height: 0`.
3. `PromptEditor.vue` / `PromptPreview.vue` — own the inner scroll regions: `.editor-textarea-wrap` (`flex: 1; min-height: 0`) holding a `<textarea>` and `.preview-content` (`flex: 1; overflow: auto`) inside `.preview-root` (`overflow: hidden`).

Although the inner panes already declare `min-height: 0` and `overflow: auto`, the outer shell uses `min-height: 100vh` (a *floor*, not a *cap*). When children try to grow past 100vh the entire layout grows with them; the document body becomes the scroll container, and toolbar/header rows scroll out of view together.

Stakeholders: solo-author writing the project. Pre-release; no external users; no migration concerns.

## Goals / Non-Goals

**Goals:**

- The body/document element MUST NOT scroll when the user is on `/settings/prompt-editor`, regardless of textarea length or preview length.
- `.editor-textarea` MUST be the sole scroll container for the template text. Toolbar and variable pills stay pinned.
- `.preview-content` MUST be the sole scroll container for the rendered preview. Header/meta/error rows stay pinned.
- Scrolling either pane MUST NOT move the other pane's `scrollTop`.
- The fix MUST hold on the responsive (≤767px) stacked layout — each stacked pane caps its share of the viewport and scrolls independently.

**Non-Goals:**

- We are NOT adding scroll-sync, line-mapping, or follow-mode between editor and preview. That is a future feature, not part of this change.
- We are NOT changing the colour palette, typography, toolbar layout, or any preview API/response shape.
- We are NOT introducing a virtualised editor (Monaco, CodeMirror, etc.). The native `<textarea>` stays.
- We are NOT touching other settings tabs (`/settings/lore`, `/settings/llm`) in this change. They keep their current scroll model.

## Decisions

### Decision 1: Cap the settings layout at viewport height ONLY when the prompt-editor route is active

Add a single global rule in `reader-src/src/styles/base.css`:

```css
.settings-layout:has(.editor-page) {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}
```

This selector matches the `.settings-layout` element only when one of its descendants carries the `.editor-page` class, which `PromptEditorPage.vue` declares on its root element. When the user is on `/settings/lore` or `/settings/llm`, no `.editor-page` is in the DOM, the selector does not match, and `.settings-layout` keeps its existing `min-height: 100vh` (no cap, page can scroll as today). This is a strictly additive, route-scoped change.

`100dvh` (dynamic viewport height) is preferred over `100vh` because mobile browsers' URL-bar collapse animation makes `100vh` over-tall on iOS Safari and Chrome Android, producing a partially clipped bottom edge. `100dvh` accounts for the dynamic toolbar. We declare `100vh` as a fallback for browsers older than `dvh` support (Chrome < 108, Safari < 15.4, Firefox < 121).

The rule lives in `base.css` (the global stylesheet) rather than in `SettingsLayout.vue`'s `<style scoped>` block to avoid Vue's scoped-style attribute selectors leaking into the `:has()` matcher: `.editor-page` is declared inside a different SFC (`PromptEditorPage.vue`) so it carries a different `data-v-xxx` attribute than `SettingsLayout`'s scoped rules would target. A global rule has no such concern.

**Why `height` and not `max-height`**: `max-height` on a flex container does not establish a definite height for `flex: 1` children to clip against; `height` does.

**Alternatives considered:**

- **Global cap on all `/settings/*`** — initially proposed, but rejected after the rubber-duck review revealed `LoreBrowser.vue` and `LoreEditor.vue` do NOT have route-level `overflow-y: auto` (only their inner `.passage-list` and autocomplete popup do). Capping the outer shell would silently clip Lore tab headers, scope tabs, action buttons, and the editor's filename/tag/priority fields. Rejected: this change is scoped to one user-reported bug; redesigning all settings tabs is out of scope.
- **Toggle a class via a `router.afterEach` guard or `onMounted`/`onUnmounted` on `PromptEditorPage`** — works, but adds JS state for a CSS-only problem and risks stale classes if a route navigation is interrupted. Rejected.
- **`overflow: hidden` on `body` while route is `/settings/prompt-editor`** — globally toggling document scroll requires runtime route-watching logic, breaks toast positioning, and is brittle. Rejected.
- **`min-height: 100vh` with `overflow: hidden`** — `min-height` still allows the element to grow past the cap; `overflow: hidden` then just clips off content silently, hiding the scroll problem instead of solving it. Rejected.
- **`position: fixed; inset: 0`** on the layout root — works but breaks portal/teleport siblings (toast notifications) and complicates focus management. Rejected.

### Decision 2: Tighten `.editor-textarea-wrap` to a strict clip container

Add `overflow: hidden` and keep `flex: 1; min-height: 0` on `.editor-textarea-wrap`. The `<textarea>` already has `width: 100%; height: 100%; resize: none`. Native textareas are themselves scroll containers when content overflows — no extra `overflow-y: auto` is needed on the textarea, but we explicitly set it to `overflow-y: auto; overflow-x: hidden` (or `auto`) for clarity and to ensure long unbroken Vento expressions wrap or scroll predictably.

The variable-pill insertion logic in `PromptEditor.vue:33-46` (`insertAtCursor()` / `textareaRef`) is unaffected: we are not wrapping or replacing the textarea, only constraining its parent's overflow. Cursor position, selection, and the `requestAnimationFrame` selection restore continue to work as today.

**Alternatives considered:**

- Wrapping the textarea in a `<div>` with `overflow: auto` and a non-scrolling textarea — adds DOM nodes and breaks textarea ergonomics (cursor follow, selection rect). Rejected.

### Decision 3: Harden `.preview-content` against default `<pre>` styling

`.preview-content` already has `flex: 1; overflow: auto`. Add three defensive declarations:

- `min-height: 0` — makes the clip contract explicit and prevents content-driven growth in edge cases (some layout engines behave differently when this is omitted from a flex child even if `overflow` is set).
- `margin: 0` — `<pre>` carries a default UA stylesheet margin (typically `1em 0`) that, in a clipped flex column, can leak as outer overflow or unwanted gap.
- `box-sizing: border-box` — defensive, since the project does not assume Tailwind preflight on every element.

`.preview-root` already declares `flex: 1; min-height: 0; overflow: hidden` (see `PromptPreview.vue:90-96`); no change needed there. Task 3.1 from the original draft is therefore a verification step only.

### Decision 4: Independent scroll positions are guaranteed structurally — no JS/CSS sync

The two scroll containers (`<textarea>` and `<pre class="preview-content">`) are siblings in the DOM at the `.editor-page` level, with no shared scroll listener and no `scroll-snap` linkage. They are inherently independent. The proposal's "scrolling one MUST NOT scroll the other" requirement holds by construction; the test will simply assert that mutating one container's `scrollTop` does not change the other's. No additional JS is required.

### Decision 5: Mobile (≤767px) keeps the same model

`SettingsLayout`'s mobile media query already stacks the sidebar above the content. `PromptEditorPage`'s mobile media query stacks `.editor-page-main` above `.editor-page-preview`. With `height: 100dvh; overflow: hidden` applied via `:has(.editor-page)`, the two stacked panes share viewport height (each `flex: 1` of the remaining space below the sidebar). That is acceptable for narrow viewports — the alternative (allow page scroll on mobile only) re-introduces the toolbar-disappears bug.

**Known mobile trade-off**: On very narrow viewports the editor toolbar (`flex-wrap: wrap`) and variable pills can wrap onto multiple lines, eating vertical space and shrinking the textarea pane. Combined with the preview pane stacked below, the textarea may become uncomfortably small. We accept this trade-off because (a) the project is desktop-first, (b) the user explicitly asked for non-page-scroll behaviour, and (c) the mobile responsive layout is not the primary use case for prompt-template authoring. A future change can collapse pills behind a control on mobile if needed.

**Alternative considered:** mobile-only fallback to page scroll. Rejected — the user asked for consistent non-page-scroll, and mobile parity simplifies the spec.

### Decision 6: Validate via CSS contract tests + manual browser smoke, not layout assertions

The project's frontend test environment is **Happy DOM** (`reader-src/vite.config.ts:41-43`), which does not perform real layout. Assertions like `document.documentElement.scrollHeight === clientHeight`, `getComputedStyle(...).height === "100dvh"`, or "toolbar's bounding rect stays at y=0" cannot be reliably validated in unit tests.

Validation strategy:

1. **CSS contract tests (Vitest, Happy DOM)**: import the relevant SFC source files (or `base.css`) as raw text and assert that the expected style declarations exist. For example, assert `base.css` contains the literal string `.settings-layout:has(.editor-page)` and the `height: 100dvh` declaration; assert `PromptEditor.vue`'s scoped style block contains `.editor-textarea-wrap` with `overflow: hidden`. These tests guard against accidental deletion of the rules but do not validate runtime layout behaviour.

2. **Scroll-isolation behaviour test (Vitest)**: mount `PromptEditorPage`, mutate the textarea's `scrollTop` programmatically, and assert that the preview's `scrollTop` stays at `0` (and vice versa). This narrowly proves *no JS scroll-sync handler exists*; it does NOT prove the panes are real scroll containers in a real browser.

3. **Manual browser smoke**: paste a long template, open preview, drag scrollbar in each pane, confirm body `scrollTop` stays 0, confirm toolbar/preview-header stay pinned, confirm panes scroll independently. Run on desktop (1920×1080, 1366×768) and mobile viewport (375×812). Smoke-test other settings tabs to confirm the route-scoped cap leaves them untouched.

This split is reflected in the tasks: tasks 5.1–5.3 are CSS contract tests; task 5.4 is the JS scroll-isolation test; tasks 6.2–6.4 are manual smoke checks.

## Risks / Trade-offs

- **[Risk]** `:has()` is unsupported on Safari < 15.4, Chrome/Edge < 105, Firefox < 121. → **Mitigation**: HeartReverie already requires modern browsers (File System Access API + secure context). On unsupported browsers the rule simply does not apply and the page falls back to today's broken-but-functional behaviour (page scroll). No external users; project pre-release.
- **[Risk]** `height: 100dvh` is unsupported on Safari < 15.4 and very old Chrome/Firefox. → **Mitigation**: declare `height: 100vh; height: 100dvh;` so older browsers fall back to `100vh`. The mobile URL-bar bug on legacy iOS is acceptable.
- **[Non-risk] Other settings tabs are unaffected.** The cap is route-scoped via `:has(.editor-page)`, which only matches when `PromptEditorPage` is mounted. `/settings/lore` and `/settings/llm` keep their existing scroll model (page-level scroll for Lore tabs, in-page scroll region for LLM settings). We will smoke-test all three tabs to confirm.
- **[Risk]** Long un-wrappable lines in the textarea (e.g., a very long Vento expression on one line) could produce horizontal scroll inside the textarea and visually compete with the toolbar. → **Mitigation**: textareas wrap by default (`wrap="soft"`), which is fine for our monospace prompt template. We do not change the wrap behaviour.
- **[Risk]** A keyboard user tabbing past the textarea might lose context if the textarea scroll position is restored on re-focus differently from before. → **Mitigation**: native textarea focus behaviour is unchanged; this is a CSS-only change.
- **[Trade-off]** Mobile cramped panes (see Decision 5). Accepted; smoke-test confirms usable, deferred to a future change.
- **[Trade-off]** No editor↔preview scroll sync. Users authoring large templates may want side-by-side line tracking. We accept this as out-of-scope; can be added later as a separate change without re-litigating layout.

## Migration Plan

This is a pure-CSS / flex-chain change. Deployment is a frontend rebuild:

1. Add the `:has(.editor-page)` rule to `reader-src/src/styles/base.css` (Decision 1).
2. Edit `PromptEditor.vue` (Decision 2) and `PromptPreview.vue` (Decision 3); leave `SettingsLayout.vue` unchanged.
3. Rebuild the reader bundle: `deno task build:reader`.
4. Re-run frontend test suite (`deno task test:frontend`); verify the new CSS contract tests and the JS scroll-isolation test pass.
5. Manual smoke (browser): paste a long template at 1920×1080, 1366×768, and 375×812 (mobile); open preview; scroll each pane independently; confirm body `scrollTop` stays 0; confirm toolbar/preview-header stay pinned.
6. Manual smoke: visit `/settings/lore` and `/settings/llm`; confirm both still scroll/behave as today (the route-scoped cap must not affect them).

No rollback strategy is needed — the change is a small CSS delta. If a regression is found post-merge, revert the commit.

## Open Questions

None.

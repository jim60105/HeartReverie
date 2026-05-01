## 1. Add route-scoped viewport cap to base.css

- [x] 1.1 In `reader-src/src/styles/base.css`, add a top-level rule:
  ```css
  .settings-layout:has(.editor-page) {
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }
  ```
  (declared in that order so older browsers fall back to `100vh`).
- [x] 1.2 Do NOT modify `SettingsLayout.vue`. Its existing `.settings-layout { display: flex; min-height: 100vh; }` rule remains the default for `/settings/lore` and `/settings/llm`.
- [x] 1.3 Verify `.settings-content` retains its existing `flex: 1; min-height: 0; display: flex; flex-direction: column` rules — these are the clip context for child routes and must not change.

## 2. Tighten PromptEditor scroll chain

- [x] 2.1 In `reader-src/src/components/PromptEditor.vue`, add `overflow: hidden;` to `.editor-textarea-wrap` (alongside the existing `flex: 1; min-height: 0`).
- [x] 2.2 Confirm `.editor-textarea` keeps `width: 100%; height: 100%; resize: none; box-sizing: border-box` so the native textarea fills its wrap and provides its own internal scroll for long content.
- [x] 2.3 Visually confirm the textarea wraps lines (default `wrap="soft"` behaviour) and that horizontal overflow is not introduced.

## 3. Harden PromptPreview content rules

- [x] 3.1 In `reader-src/src/components/PromptPreview.vue`, add `min-height: 0; margin: 0; box-sizing: border-box;` to `.preview-content` (alongside the existing `flex: 1; overflow: auto`). The `margin: 0` neutralises the default `<pre>` UA margin; `min-height: 0` makes the clip contract explicit; `box-sizing: border-box` is defensive.
- [x] 3.2 Confirm `.preview-root` already declares `flex: 1; min-height: 0; overflow: hidden` (verification only — no change expected).

## 4. Verify PromptEditorPage chain

- [x] 4.1 In `reader-src/src/components/PromptEditorPage.vue`, confirm the root element carries the `editor-page` class (the `:has()` selector depends on this) and that `.editor-page`, `.editor-page-main`, and `.editor-page-preview` keep `flex: 1; min-height: 0` (no change expected; verification only).
- [x] 4.2 Confirm the mobile media query stacking still leaves both panes capable of independent scroll under the new viewport cap (covered by manual smoke in §6.4).

## 5. Frontend CSS-contract + scroll-isolation tests (Happy DOM)

The frontend test environment is Happy DOM (`reader-src/vite.config.ts`), which does not perform real layout. Tests assert source-text declarations, not computed runtime layout.

- [x] 5.1 In `reader-src/src/styles/__tests__/` (create folder if absent), add a Vitest test that imports `reader-src/src/styles/base.css` as raw text (`?raw` Vite suffix) and asserts the file contains the literal selector `.settings-layout:has(.editor-page)` and the declarations `height: 100vh`, `height: 100dvh`, and `overflow: hidden` within the same rule block (use a regex spanning the rule body).
- [x] 5.2 In `reader-src/src/components/__tests__/`, add a Vitest test that imports `PromptEditor.vue` source as raw text and asserts the scoped `<style>` block contains a `.editor-textarea-wrap` selector whose declarations include `flex: 1`, `min-height: 0`, and `overflow: hidden`. Also assert `.editor-textarea` declares `width: 100%`, `height: 100%`, and `resize: none`.
- [x] 5.3 In the same test folder, add a Vitest test that imports `PromptPreview.vue` source as raw text and asserts the `.preview-content` rule declares `flex: 1`, `overflow: auto`, `min-height: 0`, `margin: 0`, and `box-sizing: border-box`. Assert `.preview-root` declares `flex: 1`, `min-height: 0`, and `overflow: hidden`.
- [x] 5.4 Add a JS scroll-isolation test that mounts `PromptEditorPage` with both `PromptEditor` and `PromptPreview` children. Programmatically set the textarea's `scrollTop = 500`; assert `.preview-content`'s `scrollTop` remains `0`. Set `.preview-content`'s `scrollTop = 500`; assert the textarea's `scrollTop` returns to its prior value. Label this test narrowly: it proves "no JS scroll-sync handler exists", not "the panes are independent scroll containers in a real browser".
- [x] 5.5 Run `deno task test:frontend` and confirm all new tests pass and no existing test regresses.

## 6. Build and manual browser smoke

- [x] 6.1 Run `deno task build:reader`. Confirm the build succeeds with no new TypeScript or Vite warnings.
- [x] 6.2 Rebuild and run the container: `bash scripts/podman-build-run.sh`. On `/settings/prompt-editor`, paste a long template (e.g., 5000 lines), open preview. Scroll each pane independently. Confirm: (a) `document.documentElement.scrollTop === 0` throughout, (b) the editor toolbar stays pinned, (c) the preview header/meta rows stay pinned, (d) scrolling one pane does not move the other.
- [x] 6.3 Smoke-test other settings tabs (`/settings/lore`, `/settings/llm`) at 1366×768 viewport. Each tab MUST scroll/behave exactly as before (today's behaviour). Confirm the route-scoped `:has(.editor-page)` cap does not affect them.
- [x] 6.4 Smoke-test the prompt-editor page on a mobile viewport (≤767px, e.g., 375×812). Each stacked pane should manage its own scroll; the body SHOULD remain at `scrollTop === 0`. Verify the toolbar wraps but does not consume so much space that the textarea is unusable (acceptable trade-off documented in design.md Decision 5).

## 7. Validation and archive prep

- [x] 7.1 Run `openspec validate prompt-editor-independent-scroll --strict` and confirm the change validates.
- [x] 7.2 Self-check that every requirement in the three delta specs has at least one matching task from §1–§6 (CSS contract test, manual smoke, or implementation step).

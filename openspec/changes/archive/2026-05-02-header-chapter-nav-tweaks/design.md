## Context

`AppHeader.vue` currently renders, left-to-right: `📂 選擇資料夾` → `<StorySelector>` → folder name → `🔄` reload (when chapters loaded) → spacer → `⚙️` settings (backend mode) → `← 上一章` → progress `i / N` → `下一章 →` → mobile hamburger. The folder-picker button invokes `useFileReader().openDirectory()` then `useChapterNav().loadFromFSA(handle)`, which is the only UI entry into FSA mode.

`StorySelector.vue` renders a `<details>` element whose `<summary>` is always `📖 故事選擇`, regardless of whether the user has already chosen a story. The dropdown opens to series/story `<select>` controls, a "新故事名稱" input, create / load action buttons, and a Markdown / JSON / TXT export row.

Chapter navigation is currently stepwise only: `next()` and `previous()` in `useChapterNav` mutate `currentIndex` by ±1 with FSA / backend mode branching. There are no helpers for jumping to either boundary, even though `navigateTo(index)` and `loadFSAChapter(index)` already accept arbitrary indices internally.

## Goals / Non-Goals

**Goals:**
- Reduce visual weight of the app header by removing the folder-picker button and collapsing the story-selector label after a story is selected.
- Make first-chapter and last-chapter jumps a one-click action with explicit, discoverable tooltips.
- Keep all changes inside the Vue presentation layer — the backend chapter API, routing, polling, and WebSocket subscription paths stay untouched.
- Preserve `useFileReader` plus `loadFromFSA()` plumbing so a future change can reintroduce an FSA entry point without re-implementing the composable.

**Non-Goals:**
- Migrating any existing user away from FSA mode (there are zero in-the-wild users).
- Adding a settings toggle to bring the folder button back; if FSA needs to return, a separate change SHALL author a new entry point.
- Restyling the header beyond removing one button and adding two glyph buttons.
- Adding keyboard shortcuts for the new jump buttons (out of scope for v1).

## Decisions

### Decision 1 — Remove the folder-picker button outright; do not hide it behind a setting

**What.** The button is deleted from `AppHeader.vue`'s template. The `useFileReader` composable, the `openDirectory()` and `loadFromFSA()` helpers, and the `mode === "fsa"` branches inside `useChapterNav` are all left in place. The header `🔄` reload control retains its FSA branch and continues to call `loadFromFSA(directoryHandle.value)` when the active session is in FSA mode, so any FSA session entered programmatically (tests, dev tooling, future feature) keeps a working reload path.

**Why.** A feature flag would require ongoing maintenance for a code path nobody is using, while a pure-deletion approach gives a clean, testable header. Keeping the composable plumbing means a future "Local folder" entry point can be added without re-deriving the FSA flow.

**Trade-off.** No UI access to FSA mode until a future change adds one. The proposal accepts this explicitly.

### Decision 2 — Collapse the StorySelector label using `selectedStory` as the gate

**What.** The `<summary>` content becomes:

```html
<summary
  class="themed-btn selector-toggle"
  :aria-label="selectedStory ? '故事選擇' : null"
>
  <span aria-hidden="true">📖</span>
  <span v-if="!selectedStory"> 故事選擇</span>
</summary>
```

**Why.** `selectedStory` is already the source of truth in `useStorySelector`. Using it directly avoids introducing a new prop or watcher.

The `aria-label` is bound to the `<summary>` element itself (the actual interactive control) rather than to an inner `<span>`, because some screen readers do not consistently surface labels attached to non-interactive descendants. When the visible text is present, `aria-label` is set to `null` so the accessible name comes from the text content; when the label collapses to a glyph, `aria-label="故事選擇"` becomes the accessible name. The glyph is marked `aria-hidden="true"` so the icon is not announced separately.

**Alternatives considered.** Keying off `currentIndex` or chapter count would couple the selector label to navigation state; tying it to the explicit `selectedStory` ref keeps the component's contract local. Putting `aria-label` on an inner `<span>` was considered and rejected per the rationale above.

### Decision 3 — Wire ⇇ / ⇉ through new public helpers `goToFirst` / `goToLast` on `useChapterNav`

**What.** Two new exported functions in `useChapterNav.ts`:

```ts
function goToFirst(): void {
  if (chapters.value.length === 0) return;
  if (mode.value === "fsa") loadFSAChapter(0);
  else navigateTo(0);
}

function goToLast(): void {
  const lastIdx = chapters.value.length - 1;
  if (lastIdx < 0) return;
  if (mode.value === "fsa") loadFSAChapter(lastIdx);
  else navigateTo(lastIdx);
}
```

Both reuse the same FSA / backend branching that `next` / `previous` use, so `chapter:change` hook dispatch, content commit, and any side effects are identical to single-step navigation.

**Why.** Going through the existing helpers (`navigateTo`, `loadFSAChapter`) keeps the dispatch side-effects (e.g., `dispatchChapterChange(prev, index)` and `commitContent`) in one place. Bypassing them and writing `currentIndex.value = …` directly would skip the chapter-change hook and miss the `commitContent` call that triggers re-render.

**Disabled state.** `:disabled="isFirst"` and `:disabled="isLast"` are already computed on `useChapterNav` and SHALL be reused. The new buttons, like the existing pair, SHALL NOT render at all when `chapters.value.length === 0` (gated by the existing `hasChapters` computed in `AppHeader`).

### Decision 4 — Glyphs and tooltip strings

`⇇` (U+21C7 LEFTWARDS PAIRED ARROWS) and `⇉` (U+21C9 RIGHTWARDS PAIRED ARROWS) are visible in the project's Noto / Iansui font stack and read at the same size as `←` / `→`. Tooltips are the literal Traditional-Chinese strings `第一章` and `最後一章`, set via `title="…"` to match the existing `🔄` reload button's tooltip pattern.

The button styling reuses the existing `.themed-btn .header-btn` classes — no new CSS rules. Padding may be reduced via a `.header-btn--icon` modifier (already present) so the glyph buttons match the compact `🔄` and `⚙️` buttons rather than the wider text buttons.

### Decision 5 — Layout order in the header is fixed

After this change, the visible left-to-right order in `AppHeader` is:

`<StorySelector>` → folder name → `🔄` (when chapters loaded) → spacer → `⚙️` (backend mode) → `⇇` → `← 上一章` → progress → `下一章 →` → `⇉` → mobile hamburger.

The `⇇` precedes the `←` button and `⇉` follows the `→` button so the boundary actions read as outermost on each side of the navigation cluster. The progress text stays sandwiched between `← 上一章` and `下一章 →` exactly as today.

## Risks / Trade-offs

- **FSA mode loses its only UI entry point.** Mitigated by zero in-the-wild users and by leaving the composable in place. A future change can reintroduce an entry point without re-deriving the integration.
- **Tests that assert `選擇資料夾` text or button count in `AppHeader.test.ts` SHALL be rewritten.** The test file already exists and currently expects the FSA button; this change updates those expectations.
- **Glyph rendering.** `⇇` and `⇉` should render in the bundled Noto fonts, but on systems missing those fonts the browser falls back to a system font — same situation as `←` / `→` today, so no new risk.
- **A11y.** The collapsed `📖`-only summary uses `aria-label="故事選擇"` so screen readers still announce the toggle. Glyph-only nav buttons rely on `title=` plus `aria-label=` to ensure equivalent accessibility.
- **Accidental skip past unread chapters.** `⇉` jumps to the latest chapter, which may surprise users who expected stepwise reading. Mitigated by tooltip ("最後一章") making the intent explicit.

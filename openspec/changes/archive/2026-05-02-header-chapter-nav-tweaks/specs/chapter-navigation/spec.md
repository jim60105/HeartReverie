## ADDED Requirements

### Requirement: First-chapter jump button

The reader header SHALL render a first-chapter jump button immediately to the left of the existing `← 上一章` button. The button SHALL display the glyph `⇇` (U+21C7), SHALL set its native tooltip via `title="第一章"`, and SHALL set `aria-label="第一章"` for assistive technologies. Clicking the button SHALL invoke a new public helper `goToFirst()` exported from `useChapterNav()` which sets `currentIndex` to `0` via the same FSA / backend branching that `next()` and `previous()` use, so `chapter:change` hook dispatch and `commitContent()` are unchanged. The button SHALL be disabled when `isFirst` is `true`. The button SHALL NOT render when `chapters.value.length === 0` (no story loaded), gated by the same `v-if="hasChapters"` block as the existing previous / next buttons.

#### Scenario: First-chapter button jumps to chapter index 0

- **WHEN** the user is on chapter index `5` in a story with 11 chapters and clicks the `⇇` button
- **THEN** `useChapterNav().goToFirst()` SHALL run, `currentIndex` SHALL become `0`, the `chapter:change` hook SHALL fire with `previousIndex: 5` and `currentIndex: 0`, and the chapter content SHALL be re-rendered

#### Scenario: First-chapter button disabled at boundary

- **WHEN** the user is already on chapter index `0`
- **THEN** the `⇇` button SHALL render with `:disabled="isFirst"` resolving to `true`, click events SHALL be ignored by the browser, and `goToFirst()` SHALL NOT be invoked

#### Scenario: First-chapter button hidden before story load

- **WHEN** no story has been selected (the composable's `chapters` ref is empty and `hasChapters` is `false`)
- **THEN** the `⇇` button SHALL NOT render any DOM at all, mirroring the existing previous / next button behaviour

#### Scenario: First-chapter tooltip

- **WHEN** the user hovers the `⇇` button
- **THEN** the browser SHALL show the native tooltip `第一章` from the `title` attribute

### Requirement: Last-chapter jump button

The reader header SHALL render a last-chapter jump button immediately to the right of the existing `下一章 →` button. The button SHALL display the glyph `⇉` (U+21C9), SHALL set its native tooltip via `title="最後一章"`, and SHALL set `aria-label="最後一章"` for assistive technologies. Clicking the button SHALL invoke a new public helper `goToLast()` exported from `useChapterNav()` which sets `currentIndex` to `chapters.value.length - 1` via the same FSA / backend branching that `next()` and `previous()` use. The button SHALL be disabled when `isLast` is `true`. The button SHALL NOT render when `chapters.value.length === 0`.

#### Scenario: Last-chapter button jumps to highest index

- **WHEN** the user is on chapter index `2` in a story with 11 chapters and clicks the `⇉` button
- **THEN** `useChapterNav().goToLast()` SHALL run, `currentIndex` SHALL become `10`, the `chapter:change` hook SHALL fire with `previousIndex: 2` and `currentIndex: 10`, and the chapter content SHALL be re-rendered

#### Scenario: Last-chapter button disabled at boundary

- **WHEN** the user is already on the last chapter (`currentIndex === chapters.value.length - 1`)
- **THEN** the `⇉` button SHALL render with `:disabled="isLast"` resolving to `true` and click events SHALL be ignored

#### Scenario: Last-chapter button hidden before story load

- **WHEN** no story has been selected (`chapters` ref empty)
- **THEN** the `⇉` button SHALL NOT render any DOM, mirroring the existing previous / next button behaviour

#### Scenario: Last-chapter tooltip

- **WHEN** the user hovers the `⇉` button
- **THEN** the browser SHALL show the native tooltip `最後一章`

### Requirement: Boundary jump helpers in useChapterNav

The `useChapterNav()` composable SHALL expose two new public functions, `goToFirst(): void` and `goToLast(): void`. Both SHALL be no-ops when `chapters.value.length === 0`. Both SHALL route through the existing `loadFSAChapter(index)` helper when `mode.value === "fsa"` and through `navigateTo(index)` when `mode.value === "backend"`. Both SHALL therefore inherit the existing `chapter:change` hook dispatch and `commitContent()` semantics — neither helper SHALL bypass those side-effects by mutating `currentIndex` directly.

#### Scenario: goToFirst is a no-op on empty chapter list

- **WHEN** `chapters.value.length === 0` and `goToFirst()` is invoked
- **THEN** the function SHALL return without dispatching any hook or mutating any reactive ref

#### Scenario: goToLast is a no-op on empty chapter list

- **WHEN** `chapters.value.length === 0` and `goToLast()` is invoked
- **THEN** the function SHALL return without dispatching any hook or mutating any reactive ref

#### Scenario: Boundary helpers route through FSA path in FSA mode

- **WHEN** `mode.value === "fsa"`, `chapters.value.length === 5`, and `goToLast()` is invoked
- **THEN** the helper SHALL call `loadFSAChapter(4)` (not `navigateTo(4)`) so the FSA file-read pathway runs and chapter `4`'s content is freshly read from the local file handle

#### Scenario: goToFirst routes through FSA path in FSA mode

- **WHEN** `mode.value === "fsa"`, `chapters.value.length === 5`, `currentIndex.value === 3`, and `goToFirst()` is invoked
- **THEN** the helper SHALL call `loadFSAChapter(0)` (not `navigateTo(0)`)

#### Scenario: Single-chapter story disables both boundary buttons

- **WHEN** a story with exactly one chapter is loaded (`chapters.value.length === 1`, `currentIndex.value === 0`)
- **THEN** both `⇇` and `⇉` SHALL render (because `hasChapters` is `true`) and both SHALL be disabled (because `isFirst` and `isLast` are both `true`)

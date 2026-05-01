# Chapter Navigation — delta for mobile-responsive-layout

## MODIFIED Requirements

### Requirement: First-chapter jump button

The reader header SHALL render a first-chapter jump button immediately to the left of the existing `← 上一章` button. The button SHALL display the glyph `⇇` (U+21C7), SHALL set its native tooltip via `title="第一章"`, and SHALL set `aria-label="第一章"` for assistive technologies. Clicking the button SHALL invoke the public helper `goToFirst()` exported from `useChapterNav()` which sets `currentIndex` to `0` via the same FSA / backend branching that `next()` and `previous()` use, so `chapter:change` hook dispatch and `commitContent()` are unchanged. The button SHALL be disabled when `isFirst` is `true`. The button SHALL NOT render when `chapters.value.length === 0` (no story loaded), gated by the same `v-if="hasChapters"` block as the existing previous / next buttons.

The button SHALL carry a stable CSS class hook (`header-btn--boundary`) on its root `<button>` element so a viewport-scoped media query can hide it without affecting the other icon-only header buttons (`🔄`, `⚙️`). At a viewport width of 767 px or less, the button SHALL NOT be visible, focusable, or exposed to assistive tech. Resizing the viewport from below 768 px to 768 px or wider SHALL restore the button's visibility without remounting the `AppHeader` component.

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

- **WHEN** the user hovers the `⇇` button on a viewport where it is visible
- **THEN** the browser SHALL show the native tooltip `第一章` from the `title` attribute

#### Scenario: First-chapter button has stable class hook

- **WHEN** inspecting the rendered `⇇` button
- **THEN** the `<button>` element SHALL carry the class `header-btn--boundary` in addition to its existing classes

#### Scenario: First-chapter button hidden on phone-size viewports

- **WHEN** the viewport width is 767 px or less and a story is loaded
- **THEN** the `⇇` button SHALL NOT be visible, focusable, or exposed to assistive tech

### Requirement: Last-chapter jump button

The reader header SHALL render a last-chapter jump button immediately to the right of the existing `下一章 →` button. The button SHALL display the glyph `⇉` (U+21C9), SHALL set its native tooltip via `title="最後一章"`, and SHALL set `aria-label="最後一章"` for assistive technologies. Clicking the button SHALL invoke the public helper `goToLast()` exported from `useChapterNav()` which sets `currentIndex` to `chapters.value.length - 1` via the same FSA / backend branching that `next()` and `previous()` use. The button SHALL be disabled when `isLast` is `true`. The button SHALL NOT render when `chapters.value.length === 0`.

The button SHALL carry a stable CSS class hook (`header-btn--boundary`) on its root `<button>` element. At a viewport width of 767 px or less, the button SHALL NOT be visible, focusable, or exposed to assistive tech. Resizing the viewport from below 768 px to 768 px or wider SHALL restore the button's visibility without remounting the `AppHeader` component.

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

- **WHEN** the user hovers the `⇉` button on a viewport where it is visible
- **THEN** the browser SHALL show the native tooltip `最後一章`

#### Scenario: Last-chapter button has stable class hook

- **WHEN** inspecting the rendered `⇉` button
- **THEN** the `<button>` element SHALL carry the class `header-btn--boundary` in addition to its existing classes

#### Scenario: Last-chapter button hidden on phone-size viewports

- **WHEN** the viewport width is 767 px or less and a story is loaded
- **THEN** the `⇉` button SHALL NOT be visible, focusable, or exposed to assistive tech

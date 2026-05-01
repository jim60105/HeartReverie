## ADDED Requirements

### Requirement: Settings layout caps its height to the viewport on the prompt-editor route

The global stylesheet (`reader-src/src/styles/base.css`) SHALL declare a route-scoped rule that caps the `.settings-layout` element's height to exactly the visible viewport whenever a descendant `.editor-page` element is present in the DOM (i.e., the user is on `/settings/prompt-editor`). The rule SHALL use the `:has()` selector with the duplicated class chain `.settings-layout.settings-layout:has(.editor-page)` to raise specificity above `SettingsLayout.vue`'s scoped `.settings-layout { min-height: 100vh; }` rule (a plain `.settings-layout:has(.editor-page)` selector has the same specificity as the scoped class rule, so on mobile where `100vh > 100dvh` the un-neutralized `min-height` could win and re-introduce page scroll). The rule SHALL declare `height: 100vh; height: 100dvh;` (the second value is preferred on browsers that support `dvh`; the first is a fallback) together with `min-height: 0` (to neutralize the inherited `min-height: 100vh`) and `overflow: hidden`.

When the user is on a different settings route (e.g., `/settings/lore`, `/settings/llm`), the rule MUST NOT apply: `.settings-layout` retains its existing `min-height: 100vh` and the page may grow past the viewport with the document body acting as the scroll container, exactly as today. This change is strictly additive and route-scoped; other settings tabs are not affected.

The mobile breakpoint (≤767px) SHALL apply the same route-scoped cap. The sidebar stacks above the content on mobile, but on the prompt-editor route the combined element MUST still fit within `100dvh` so that the document body remains non-scrolling.

#### Scenario: Route-scoped cap rule is declared in base.css

- **WHEN** the project's global stylesheet `reader-src/src/styles/base.css` is read as text
- **THEN** it SHALL contain a rule whose selector is `.settings-layout.settings-layout:has(.editor-page)` (the duplicated class chain raises specificity above `SettingsLayout.vue`'s scoped `.settings-layout` rule)
- **AND** the rule's declarations SHALL include `height: 100vh`, `height: 100dvh`, `min-height: 0`, and `overflow: hidden`

#### Scenario: Cap does not apply when the editor page is not in the DOM

- **WHEN** `.settings-layout` has no descendant element with class `.editor-page` (e.g., the user is on `/settings/lore` or `/settings/llm`)
- **THEN** the `:has(.editor-page)` rule SHALL NOT match `.settings-layout`
- **AND** `.settings-layout` keeps its existing `min-height: 100vh` from `SettingsLayout.vue`'s scoped style block (verified by manual browser smoke; not unit-testable in Happy DOM)

#### Scenario: Document body does not scroll on the prompt-editor route (manual smoke)

- **GIVEN** the route-scoped cap rule is in effect on `/settings/prompt-editor`
- **WHEN** the routed content's natural height exceeds the viewport
- **THEN** the document body SHALL NOT produce a vertical scrollbar
- **AND** the `.settings-layout` root element SHALL be sized to the viewport height (validated by manual browser smoke; Happy DOM does not perform layout)

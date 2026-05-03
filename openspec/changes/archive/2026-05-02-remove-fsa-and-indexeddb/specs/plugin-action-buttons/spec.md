## MODIFIED Requirements

### Requirement: Plugin action bar visibility filter

The frontend SHALL evaluate each `ActionButtonDescriptor`'s `visibleWhen` clause against the current view state to decide whether the descriptor renders. The `"backend-only"` clause SHALL match in every chapter (any chapter index, last or not). The `"last-chapter-backend"` clause SHALL match only when the currently displayed chapter is the last chapter of the story (consistent with the `showChatInput` predicate already used by `MainLayout`). The two-value enum is preserved for forward-compat with future visibility distinctions; both values are equivalent to "always render once a backend story is loaded" plus an optional last-chapter constraint. The set of visible descriptors SHALL recompute reactively when route or chapter index changes — no manual reload required.

#### Scenario: backend-only on non-last chapter
- **WHEN** a button declares `visibleWhen: "backend-only"` and the user navigates to chapter 1 of a 3-chapter story
- **THEN** the bar SHALL render the button (it does not require last-chapter)

#### Scenario: last-chapter-backend on last chapter
- **WHEN** a button declares `visibleWhen: "last-chapter-backend"` and the user is viewing the last chapter of the story
- **THEN** the bar SHALL render the button

#### Scenario: last-chapter-backend on non-last chapter
- **WHEN** a button declares `visibleWhen: "last-chapter-backend"` and the user navigates to chapter 1 of a 3-chapter story
- **THEN** the bar SHALL hide the button until the user navigates to the last chapter

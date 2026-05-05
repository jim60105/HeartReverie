## MODIFIED Requirements

### Requirement: Plugin action bar UI panel

The reader frontend SHALL render a `PluginActionBar` component in the main reading layout, positioned between the `UsagePanel` and the `ChatInput`. The layout SHALL gate the `PluginActionBar` with the same visibility condition as `ChatInput` (i.e. `showChatInput`): when `ChatInput` is not rendered, `PluginActionBar` SHALL also not be rendered. Within this outer gate, the bar SHALL list one button per `ActionButtonDescriptor` returned by the plugin API whose `visibleWhen` clause matches the current view state. Buttons SHALL be sorted ascending by `priority`, with ties broken by the tuple `(pluginName ascending, declaration order ascending)`. The bar SHALL render no DOM at all when no descriptor is currently visible. When a button is clicked the bar SHALL hold a `pendingKey` of the form `${pluginName}:${buttonId}` for that button until the dispatch promise settles, render the pressed button in a disabled visual state, and prevent re-clicks on that exact `pendingKey` during the pending window. If the click handler throws or rejects, the bar SHALL surface the error via the existing toast notification system (e.g., `useNotifications`) by default, unless the plugin's own `action-button:click` handler already emitted a notification.

#### Scenario: Bar visibility with last-chapter-backend descriptor
- **WHEN** a plugin contributes a button with `visibleWhen: "last-chapter-backend"` and the user is viewing the last chapter of a story in backend mode
- **THEN** the `PluginActionBar` SHALL render with that button visible and clickable

#### Scenario: Bar collapses when no buttons match
- **WHEN** the user is viewing a non-last chapter in backend mode and all loaded buttons declare `visibleWhen: "last-chapter-backend"`
- **THEN** the `PluginActionBar` SHALL not render any DOM

#### Scenario: Sorting by priority and declaration order
- **WHEN** plugin A declares buttons `[{ id: "a1", priority: 50 }]` and plugin B declares `[{ id: "b1" }, { id: "b2" }]` (both default priority 100)
- **THEN** the bar SHALL render `a1` first (lower priority), then `b1`, then `b2` (plugin name and declaration order)

#### Scenario: Disabled state during dispatch
- **WHEN** the user clicks a button and the `action-button:click` dispatch is still pending
- **THEN** that button SHALL render disabled and clicks SHALL be ignored until the dispatch promise settles

#### Scenario: Qualified pending key prevents collision across plugins
- **WHEN** plugin A and plugin B each declare a button with the same `id` (e.g., `"refresh"`) and the user clicks plugin A's button
- **THEN** only the `pendingKey` `"plugin-a:refresh"` SHALL be marked pending — plugin B's `"plugin-b:refresh"` button SHALL remain clickable

#### Scenario: Default error notification on handler rejection
- **WHEN** an `action-button:click` handler rejects with an error and the handler did not surface a notification itself
- **THEN** the bar SHALL emit a default error toast via the notification system referencing the failed button's label and the error message

#### Scenario: Action bar hidden when ChatInput is hidden
- **WHEN** the current view state does not satisfy `showChatInput` (e.g. the user is not on the last chapter and story is not empty)
- **THEN** the layout SHALL not instantiate `PluginActionBar`, regardless of whether plugins have registered action buttons

### Requirement: Plugin action bar visibility filter

The frontend SHALL evaluate each `ActionButtonDescriptor`'s `visibleWhen` clause against the current view state to decide whether the descriptor renders. Because `MainLayout` gates `PluginActionBar` with `showChatInput` (which requires the last chapter or an empty story in backend mode), both `"backend-only"` and `"last-chapter-backend"` clauses are effectively equivalent at runtime — the bar is never mounted on non-last chapters. The `"backend-only"` clause remains as a manifest option for forward-compatibility but SHALL NOT cause the bar to render outside the `showChatInput` gate. The set of visible descriptors SHALL recompute reactively when route or chapter index changes — no manual reload required.

#### Scenario: backend-only on last chapter
- **WHEN** a button declares `visibleWhen: "backend-only"` and the user is viewing the last chapter of a backend story
- **THEN** the bar SHALL render the button

#### Scenario: backend-only on non-last chapter
- **WHEN** a button declares `visibleWhen: "backend-only"` and the user navigates to chapter 1 of a 3-chapter story
- **THEN** the bar SHALL NOT render because the layout gate (`showChatInput`) prevents `PluginActionBar` from mounting

#### Scenario: last-chapter-backend on last chapter
- **WHEN** a button declares `visibleWhen: "last-chapter-backend"` and the user is viewing the last chapter of the story
- **THEN** the bar SHALL render the button

#### Scenario: last-chapter-backend on non-last chapter
- **WHEN** a button declares `visibleWhen: "last-chapter-backend"` and the user navigates to chapter 1 of a 3-chapter story
- **THEN** the bar SHALL hide the button until the user navigates to the last chapter

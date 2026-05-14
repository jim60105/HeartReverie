## ADDED Requirements

### Requirement: Hook Inspector settings tab

The settings area SHALL include a child route at `/settings/hook-inspector` with `meta.title` set to a Traditional Chinese label (e.g. `Hook 檢視`) and `meta.category` set to `"developer-tools"`. The route SHALL lazy-load `HookInspectorPage.vue` from `reader-src/src/components/`. Behavioural details (fetch URL, conflict detection, error reporting, refresh behavior, etc.) are specified by the `hook-inspector` capability; this requirement only governs the route registration and sidebar placement.

#### Scenario: Hook Inspector route registered with developer-tools category
- **WHEN** the `/settings/hook-inspector` child route is registered
- **THEN** its `meta` SHALL include `{ title: <zh-TW label>, category: "developer-tools" }` and the sidebar SHALL render the link under the "開發者工具 / Developer Tools" group described in the modified "Extensible tab registration" requirement

## MODIFIED Requirements

### Requirement: Extensible tab registration

The settings tab system SHALL be extensible by adding new child routes to the `/settings` parent route. Each child route SHALL declare a `meta` object containing at minimum a `title` (string, used as the sidebar display text), and MAY declare a `category` (string, used to group sibling tabs in the sidebar). The sidebar component SHALL derive its navigation items from the route children's `meta.title` values, ensuring new tabs can be added without modifying the sidebar component.

The sidebar component SHALL bucket sibling tabs by `meta.category`. Children with no `category` (or `category: "general"`) SHALL appear in the default "一般 / General" group at the top of the sidebar. Children with `category: "developer-tools"` SHALL appear in a separate "開發者工具 / Developer Tools" group rendered below the default group. Additional categories MAY be added in future without changes to the sidebar component, provided the sidebar maps the category key to a human-readable group label (a small static map within the component is acceptable; falling back to the raw category key when no label is mapped is acceptable).

Within each category group, tabs SHALL appear in the order defined by the children array in the route configuration.

No second authentication gate (such as a `?dev=1` query string) SHALL be required for developer-tools category tabs. The passphrase gate remains the sole auth boundary for the entire writer SPA.

#### Scenario: New tab added via route config only
- **WHEN** a developer adds a new child route `{ path: 'appearance', component: AppearancePage, meta: { title: '外觀設定' } }` to the `/settings` route
- **THEN** the sidebar SHALL automatically render a "外觀設定" link pointing to `/settings/appearance` under the default "一般" group without any template changes

#### Scenario: Tab order follows route definition order
- **WHEN** multiple child routes are defined under `/settings` within the same `meta.category`
- **THEN** the sidebar SHALL render those tabs in the same order as the children array in the route configuration

#### Scenario: Developer-tools category renders as a separate group
- **WHEN** a child route is registered with `meta.category: "developer-tools"`
- **THEN** the sidebar SHALL render that tab inside a "開發者工具 / Developer Tools" group separate from the default "一般 / General" group, and the developer-tools group SHALL render BELOW the default group

#### Scenario: Default group is shown when no category is declared
- **WHEN** a child route declares `meta` without a `category` field
- **THEN** the sidebar SHALL render that tab inside the default "一般 / General" group

#### Scenario: No second auth gate for developer tabs
- **WHEN** a user has passed the passphrase gate and navigates to a developer-tools tab
- **THEN** the SPA SHALL render the tab without requiring any additional query parameter, header, or confirmation

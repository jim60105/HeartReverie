## Why

The theme dropdown on `/settings/theme` currently sorts themes alphabetically by `id`, placing the default branded theme ("浮心夜夢") between "dark" and "light" instead of at the top. Users expect the project's signature theme to appear first, followed by built-in alternatives, with any operator-added custom themes listed last. This small ordering fix improves discoverability of the default theme and establishes a clear visual hierarchy in the dropdown.

## What Changes

- The `GET /api/themes` endpoint will return themes in a defined priority order instead of alphabetical:
  1. The `default` theme always first
  2. Built-in themes (`light`, `dark`) next, sorted alphabetically by id
  3. Custom (operator-added) themes last, sorted alphabetically by id
- The backend `listThemes()` function will use a priority-aware comparator with a hardcoded set of built-in theme IDs (`default`, `light`, `dark`)

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `theme-system`: The "Theme list endpoint" requirement changes sort order from "alphabetical by `id`" to a three-tier priority order (default → built-in → custom)

## Impact

- **Backend**: `writer/lib/themes.ts` — `listThemes()` sort comparator (~5-10 lines changed)
- **Frontend**: No changes needed (dropdown renders in whatever order the API returns)
- **API**: `GET /api/themes` response array order changes (non-breaking — no consumer depends on alphabetical order)
- **Tests**: Existing theme-related tests may assert alphabetical order — update expected order

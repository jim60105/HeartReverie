## Context

The theme settings page (`/settings/theme`) renders a `<select>` dropdown populated from `GET /api/themes`. The current `listThemes()` function in `writer/lib/themes.ts` sorts themes alphabetically by `id` using `a.localeCompare(b)`. With the three shipped themes (`default`, `dark`, `light`), this produces the order: dark → default → light. The project's branded theme ("浮心夜夢", id `default`) should appear first for discoverability.

Operators can add custom themes by placing `.toml` files in `THEME_DIR`. Currently there is no distinction between built-in and custom themes in the data model.

## Goals / Non-Goals

**Goals:**

- Ensure the `default` theme always appears first in the dropdown regardless of its `id` value
- Group built-in themes (light, dark) before custom/operator-added themes
- Within each group, sort alphabetically by `id` for determinism
- Keep the change minimal — backend sort only, no frontend or data model changes

**Non-Goals:**

- Adding a `builtin` field to the TOML schema or `Theme` interface
- Changing theme file naming conventions
- Supporting user-configurable sort order or pinning
- Modifying the theme detail endpoint behavior

## Decisions

### Decision 1: Hardcode built-in theme IDs as a constant

**Choice**: Define `BUILTIN_THEME_IDS = new Set(["default", "light", "dark"])` in `writer/lib/themes.ts` and use it in the sort comparator to assign priority tiers.

**Rationale**: The three built-in themes ship with the repository and their IDs are stable. A hardcoded set is the simplest approach — no schema changes, no file metadata, no directory scanning heuristics. If a new built-in theme is added in the future, the developer adds its ID to the set.

**Alternatives considered**:
- Adding a `builtin: true` field to TOML files — overengineered for 3 themes; adds schema complexity for no user-facing benefit
- Checking if the file exists in the repo's `themes/` vs an external `THEME_DIR` — fragile, doesn't work when all themes are in a single directory

### Decision 2: Three-tier priority sort

**Choice**: Sort with a priority function:
- `default` → priority 0
- Other built-in (`light`, `dark`) → priority 1
- Custom (not in `BUILTIN_THEME_IDS`) → priority 2

Within the same priority tier, sort alphabetically by `id`.

**Rationale**: This guarantees `default` is always first (the branded theme), built-in alternatives come next (users expect framework themes before custom ones), and custom themes are at the bottom in a predictable order.

**Alternatives considered**:
- Two-tier (default first, everything else alphabetical) — loses the built-in vs custom grouping
- Sort by `label` instead of `id` — less predictable, locale-sensitive

## Risks / Trade-offs

- [Hardcoded IDs become stale if built-in themes are renamed] → Mitigation: theme IDs are stable by design (they're referenced in localStorage, docs, and configs); renaming would be a breaking change regardless
- [Existing tests may assert alphabetical order] → Mitigation: update test assertions to match the new order; this is a test-only change with no runtime risk

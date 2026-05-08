## 1. Backend Sort Implementation

- [x] 1.1 In `writer/lib/themes.ts`, define a `BUILTIN_THEME_IDS` constant (`Set<string>`) containing `"default"`, `"light"`, `"dark"`
- [x] 1.2 Replace the `listThemes()` sort comparator from `a.localeCompare(b)` to a priority-aware comparator: `default` → 0, other built-in → 1, custom → 2; within same priority, sort by `id` alphabetically

## 2. Verification

- [x] 2.1 Run existing backend tests (`deno task test:backend`) — update any assertions that expect alphabetical order to match the new priority order (default, dark, light)
- [x] 2.2 Add/update a backend test for mixed built-in and custom ordering: given themes `default`, `dark`, `light`, `cyberpunk`, `autumn` → expected order `default`, `dark`, `light`, `autumn`, `cyberpunk`
- [x] 2.3 Build container image using `scripts/podman-build-run.sh` to verify no compilation errors
- [x] 2.4 Use browser automation to verify the dropdown at `http://localhost:8080/settings/theme` shows option ids ordered as `default`, `dark`, `light` (using the repository `themes/` directory)

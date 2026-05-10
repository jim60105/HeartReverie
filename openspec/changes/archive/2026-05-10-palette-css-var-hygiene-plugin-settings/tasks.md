# Implementation Tasks — palette-css-var-hygiene-plugin-settings

> All tasks below were already completed and committed in `b34cc0e`. This document records the work for archival traceability against the spec delta.

## 1. Replace undeclared palette variables in PluginSettingsPage.vue

- [x] 1.1 Open `reader-src/src/components/PluginSettingsPage.vue` and locate:
  - Line 753: `.chevron-btn { color: var(--text-secondary, #888); }`
  - Line 760: `.chevron-btn:hover { color: var(--text-primary, #fff); }`
  - Line 800: `.dropdown-empty { color: var(--text-secondary, #888); }`
- [x] 1.2 Replace both `var(--text-secondary, #888)` occurrences with `var(--text-italic, #888)`. Preserve the `#888` fallback.
- [x] 1.3 Replace `var(--text-primary, #fff)` with `var(--text-main, #fff)`. Preserve the `#fff` fallback.
- [x] 1.4 Confirm via `grep -nE "text-(secondary|primary)" reader-src/src/components/PluginSettingsPage.vue` returns zero matches.
- [x] 1.5 Confirm via `grep -nE "text-(italic|main)" reader-src/src/components/PluginSettingsPage.vue` shows the new references at the expected line numbers.

## 2. Container build + smoke

- [x] 2.1 Run `bash scripts/podman-build-run.sh` to rebuild and restart the `heartreverie` container.
- [x] 2.2 Verify `podman logs heartreverie 2>&1 | grep -iE "error|warn"` shows no new errors related to the reader build or theme system.
- [x] 2.3 Open the reader Plugins settings page in a browser at `http://localhost:8080/`, switch between dark and light themes, confirm the chevron button colour and the dropdown-empty placeholder colour update with the theme (no longer frozen on `#888` / `#fff`).

## 3. Audit pass (out of scope for current commit)

- [ ] 3.1 Recorded as a follow-up signal: do a one-shot grep across `reader-src/src/**/*.vue` and `reader-src/src/**/*.css` for `var(--(text|bg|border)-(primary|secondary|hover))` and clean up any other components that exhibit the same pattern. The current change covers `PluginSettingsPage.vue` only because that was the file the user surfaced.

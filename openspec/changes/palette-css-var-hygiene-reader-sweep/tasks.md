## 1. PluginSettingsPage.vue dropdown fixes

- [ ] 1.1 Open `reader-src/src/components/PluginSettingsPage.vue` and locate:
  - Line 771: `background: var(--bg-secondary, #2a2a2a);` in `.dropdown-options`
  - Line 786: `background: var(--bg-hover, #3a3a3a);` in `.dropdown-option:hover`
  - Line 790: `background: var(--bg-hover, #3a3a3a);` in `.dropdown-option--selected`
- [ ] 1.2 Replace L771 with `background: var(--item-bg, #2a2a2a);` (preserve fallback for FOUC safety).
- [ ] 1.3 Replace L786 and L790 with `background: var(--btn-hover-bg, #3a3a3a);`.
- [ ] 1.4 Confirm by `grep -nE "var\(--(bg-(secondary|hover|primary|tertiary))" PluginSettingsPage.vue` that zero matches remain.

## 2. PromptPreview.vue message card and role badge fixes

- [ ] 2.1 Open `reader-src/src/components/PromptPreview.vue`. Locate:
  - Line 165: `background: var(--bg-secondary, transparent);` in `.message-card`
  - Line 196: `background: var(--bg-tertiary, rgba(127, 127, 127, 0.15));` in `.role-badge`
- [ ] 2.2 Replace L165 with `background: var(--item-bg, transparent);`.
- [ ] 2.3 Replace L196 with `background: rgba(127, 127, 127, 0.15);` (strip the `var()` wrapper; inline the literal — no host-palette token semantically matches the neutral-pill register).
- [ ] 2.4 Confirm by `grep -nE "var\(--(bg-(secondary|tertiary|primary|hover))" PromptPreview.vue` that zero matches remain.

## 3. PluginActionBar.vue hover fix

- [ ] 3.1 Open `reader-src/src/components/PluginActionBar.vue`. Locate line 71: `background: var(--panel-bg-hover, rgba(255, 255, 255, 0.08));` in `.plugin-action-btn:hover:not(:disabled)`.
- [ ] 3.2 Replace with `background: var(--btn-hover-bg, rgba(255, 255, 255, 0.08));` (preserve fallback).
- [ ] 3.3 Confirm by `grep -n "panel-bg-hover" PluginActionBar.vue` that zero matches remain.

## 4. LlmSettingsPage.vue muted/input/accent fixes

- [ ] 4.1 Open `reader-src/src/components/LlmSettingsPage.vue`. Locate the four `--muted-color` sites:
  - Line 523: `color: var(--muted-color, #888);` (`.field-hint`)
  - Line 566: `color: var(--muted-color, #888);` (`.field-hint`)
  - Line 585: `border-color: var(--muted-color, #888);` (`.muted`)
  - Line 616: `color: var(--muted-color, #888);` (`.status`)
- [ ] 4.2 Replace all four with `var(--text-italic, #888)` (preserving the property — `color:` for L523/L566/L616, `border-color:` for L585 — and the `#888` fallback).
- [ ] 4.3 Locate line 573: `background: var(--input-bg, transparent);` in `.field-input`. Replace with `background: var(--item-bg, transparent);`.
- [ ] 4.4 Locate line 605: `background: var(--accent-color, #4a90e2);` in `.btn.primary`. Replace with `background: var(--accent-solid, #4a90e2);` (preserve fallback).
- [ ] 4.5 Locate the two status-colour sites:
  - Line 621: `color: var(--error-color, #c0392b);` (`.status.error`)
  - Line 626: `color: var(--warn-color, #b07d2b);` (`.status.warn, .status.warning`)
- [ ] 4.6 Replace L621 with `color: #c0392b;` (strip the `var()` wrapper; inline the literal — no host-palette token exists for status colours; deferred to a separate `add-status-palette-tokens` change).
- [ ] 4.7 Replace L626 with `color: #b07d2b;` (strip the `var()` wrapper; same deferral).
- [ ] 4.8 Confirm by `grep -nE "var\(--(muted-color|input-bg|accent-color|error-color|warn-color)" LlmSettingsPage.vue` that zero matches remain.

## 5. Repo-wide audit and spec validation

- [ ] 5.1 Run a grep audit across `reader-src/src/components/**/*.vue`, `reader-src/src/views/**/*.vue`, and `reader-src/src/styles/**/*.css` (excluding `reader-src/src/styles/plugins/`) for `var\(--(bg-(primary|secondary|tertiary|hover))|var\(--(text-(primary|secondary))|var\(--(border-primary)|var\(--muted-color|var\(--input-bg|var\(--accent-color|var\(--panel-bg-hover|var\(--error-color|var\(--warn-color`. Expected result: zero matches.
- [ ] 5.2 Cross-reference every remaining `var(--…)` reference in the reader tree against the declared list in `reader-src/src/styles/theme.css`. Record the table in the PR description as a one-shot audit table; confirm zero VIOLATION rows.
- [ ] 5.3 Run `cd HeartReverie && openspec validate --strict palette-css-var-hygiene-reader-sweep` and confirm the change validates.

## 6. Container-integration verification

- [ ] 6.1 Build and run the dev container: `bash scripts/podman-build-run.sh`.
- [ ] 6.2 Open `http://localhost:8080/` in the agent-browser; navigate to Settings → Plugins → any plugin with a dropdown setting; confirm the dropdown options panel and hover state render correctly under the default `cosmic-passion` theme (panel: subtle near-transparent recessed bg; hover/selected: `--btn-hover-bg` value).
- [ ] 6.3 Switch to an alternate theme (if available) and confirm the dropdown panel and hover background colours track the theme switch (no theme reload required).
- [ ] 6.4 Navigate to Settings → LLM and confirm:
  - helper text and input borders render with `--text-italic` colour (theme-tracked, not the literal `#888`)
  - field input background renders with `--item-bg` (subtle field affordance)
  - the primary button renders with `--accent-solid` (scarlet in default theme — visible colour shift from prior literal blue, which is the correct theme-tracking behaviour)
  - the status-error and status-warn text render with their original literals (visually identical to before)
- [ ] 6.5 Open a chapter view that uses `PromptPreview.vue` (e.g. the Writer / prompt-editor preview); confirm the message card background and role badge background render correctly.
- [ ] 6.6 Open any chapter that displays `PluginActionBar`; hover an action button; confirm the hover background renders with `--btn-hover-bg`.
- [ ] 6.7 Take screenshots of the dropdown panel, LLM-settings primary button, message card, and plugin action bar hover for the PR record.
- [ ] 6.8 Check container logs (`podman logs heartreverie 2>&1 | grep -iE "warn|error"`) for any new warnings.

## 7. Follow-up signal (out of scope; tracked for next change)

- [ ] 7.1 Recorded follow-up: introduce `--status-error` and `--status-warn` palette tokens to `reader-src/src/styles/theme.css` (defaults `#c0392b` / `#b07d2b` for the cosmic-passion theme; per-theme overrides for other themes). Re-wrap the inlined literals in `LlmSettingsPage.vue:621,626` as `var(--status-error, #c0392b)` and `var(--status-warn, #b07d2b)`. This task SHALL be addressed by a separate `add-status-palette-tokens` change, not by the current sweep.

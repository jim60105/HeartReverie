# Delta Spec: plugin-core

## MODIFIED Requirements

### Requirement: Plugin frontend.js path compatibility

Built-in plugin `frontend.js` modules currently import from absolute paths such as `/js/utils.js` and `/js/chat-input.js`. After the Vite migration, raw source files will no longer be served at `/js/*` paths — the build output goes to `reader-dist/` with hashed filenames.

The server SHALL continue serving plugin `frontend.js` files at `/plugins/{name}/frontend.js` in both dev and production modes. Built-in plugin `frontend.js` modules SHALL be updated to remove `/js/*` imports and instead receive needed utilities (e.g., `escapeHtml`) through alternative means (inline implementation, shared module re-export, or hook context injection). This is a **BREAKING** change for any third-party plugins that import from `/js/*` paths.

The Vite dev server proxy SHALL forward `/plugins/*` requests to the Deno backend (already specified). No additional `/js/*` proxy route is required because built-in plugins will be updated to remove those imports.

#### Scenario: Built-in plugin `/js/*` imports removed
- **WHEN** the Vue/TypeScript migration is complete
- **THEN** all built-in plugin `frontend.js` modules (currently `status`, `options`, `state`, `thinking`) SHALL NOT import from `/js/utils.js`, `/js/chat-input.js`, or any other `/js/*` path

#### Scenario: Plugin frontend.js served at existing URL
- **WHEN** the frontend requests `import('/plugins/{name}/frontend.js')` in production (serving from `reader-dist/`)
- **THEN** the backend SHALL serve the plugin module from the `plugins/` directory at the same URL path as before

#### Scenario: Third-party plugin breakage documented
- **WHEN** a third-party plugin's `frontend.js` imports from `/js/utils.js` or other `/js/*` paths
- **THEN** the import SHALL fail with a 404 error; this is documented as a known breaking change in the migration

### Requirement: Plugin name identity preservation

Plugin manifest `name` fields and directory names SHALL remain unchanged during this refactor. The actual plugin names are: `status`, `options`, `state`, `thinking`, `context-compaction`, `de-robotization`, `imgthink`, `threshold-lord`, `t-task`, `user-message`, `writestyle`. Delta specs and Vue components MAY use descriptive names (e.g., `StatusBar.vue`, `OptionsPanel.vue`, `VariableDisplay.vue`) for component file names, but plugin manifests, directory names, and any code referencing plugin names (e.g., `/plugins/{name}/frontend.js`) SHALL use the original names.

#### Scenario: Plugin directory names unchanged
- **WHEN** the Vue refactor is complete
- **THEN** plugin directories SHALL remain `plugins/status/`, `plugins/options/`, `plugins/state/`, etc. — not renamed to `status-bar/`, `options-panel/`, or `variable-display/`

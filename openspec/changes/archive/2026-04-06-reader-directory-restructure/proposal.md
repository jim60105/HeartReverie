## Why

The project root mixes web reader files (`index.html`, `js/`, `serve.zsh`) with story content (`魔王大人的流行款/`, `變數初始值.yml`, `變數結構.js`) and templates (`short-template/`, `regex.json`). Moving the web reader into a dedicated `reader/` directory separates concerns, making both the reader app and story content easier to maintain independently.

## What Changes

- Create a new `reader/` directory at the project root
- Move `index.html` → `reader/index.html`
- Move `js/` → `reader/js/`
- Move `serve.zsh` → `reader/serve.zsh`
- Update `serve.zsh` to serve from the new directory structure
- Update any relative paths inside `index.html` if needed (CDN links are absolute, so no changes expected)
- Update `README.md` to reflect the new directory layout

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `page-layout`: File paths change from root-relative to `reader/`-relative; no behavioural requirement changes (pure restructure)

## Impact

- **Files moved**: `index.html`, `js/` (6 modules), `serve.zsh`
- **Files updated**: `README.md`, `serve.zsh` (path references)
- **No functional changes**: All runtime behaviour, CSS, and JS remain identical — this is a pure directory restructure
- **OpenSpec specs**: No requirement-level changes; specs describe behaviour, not file paths

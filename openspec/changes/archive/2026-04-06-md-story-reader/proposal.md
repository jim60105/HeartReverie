## Why

This project needs a local, pure frontend web application to render locally-stored markdown story files. These files (from `short-template/`) contain narrative text interleaved with custom XML blocks (`<status>`, `<options>`, `<UpdateVariable>`, etc.) that were previously rendered through SillyTavern's regex engine. By building a dedicated reader, we eliminate the dependency on SillyTavern for reading/viewing stories and provide a purpose-built, visually polished reading experience with chapter navigation.

## What Changes

- Introduce a new single-page web application (pure HTML/CSS/JS, no framework) that:
  - Allows the user to select a local folder via the File System Access API
  - Lists and loads numbered markdown files (001.md, 002.md, …) as chapters
  - Renders story prose as formatted HTML
  - Parses and renders `<status>` XML blocks into a styled character status panel (migrated from `regex.json`'s "狀態欄" rule)
  - Parses and renders `<options>` XML blocks into styled action option buttons (migrated from `regex.json`'s "s15行动选项" rule)
  - Collapses `<UpdateVariable>` XML blocks into expandable `<details>` sections (migrated from `regex.json`'s "折叠变量更新" rules)
  - Hides non-display XML blocks (`<imgthink>`, `<disclaimer>`) from the rendered output
  - Applies text formatting: normalises quote characters and handles newline rendering
  - Provides chapter-by-chapter navigation (previous / next buttons)
- Migrate all **display-side** regex rules from `regex.json` into dedicated JavaScript code modules
- Do **not** migrate prompt-only / AI-sending rules (those are irrelevant to a read-only viewer)

## Capabilities

### New Capabilities
- `file-reader`: Select a local folder and read numbered markdown files using the File System Access API
- `md-renderer`: Parse markdown story content and render as formatted HTML with text formatting rules (quote normalisation, newline handling)
- `status-bar`: Parse `<status>` XML blocks and render a styled character status panel with collapsible sections
- `options-panel`: Parse `<options>` XML blocks and render styled action option buttons in a 2×2 grid
- `variable-display`: Parse `<UpdateVariable>` XML blocks and render as collapsible `<details>` sections
- `chapter-navigation`: Navigate between chapters (previous/next), displaying one chapter at a time

### Modified Capabilities
<!-- No existing specs to modify — this is a brand-new project. -->

## Impact

- **New files**: `index.html`, plus JavaScript modules for each capability, CSS/Tailwind styling
- **Dependencies**: None beyond a modern browser supporting the File System Access API (Chrome/Edge); Tailwind CSS via CDN for styling
- **No server required**: Entire application runs client-side with no backend
- **Existing files untouched**: `regex.json` is read for reference only; `魔王大人的流行款/`, `變數初始值.yml`, `變數結構.js` are explicitly excluded

# AGENTS.md

## Overview

**MD Story Reader** — A pure-frontend web app that renders multi-chapter markdown story files with custom XML blocks (`<status>`, `<options>`, `<UpdateVariable>`) originating from SillyTavern AI chat sessions. No build step, no framework, no backend.

## File Structure

```
index.html               # Single entry point — all CSS inline, HTML shell, module bootstrap
js/
  chapter-nav.js          # App orchestrator: navigation, state, sidebar relocation
  file-reader.js          # File System Access API + IndexedDB persistence
  md-renderer.js          # 9-step markdown rendering pipeline
  status-bar.js           # <status> block parser → themed HTML card
  options-panel.js        # <options> block parser → 2×2 button grid
  variable-display.js     # <UpdateVariable> block parser → collapsible <pre>
serve.zsh                 # HTTPS dev server (zsh + Node.js, self-signed TLS)
```

### Module Dependency Graph

```
index.html
  └── chapter-nav.js
        ├── file-reader.js
        └── md-renderer.js
              ├── status-bar.js
              ├── options-panel.js
              └── variable-display.js
```

### Key Pattern: Extract → Placeholder → Reinsert

Custom XML blocks are extracted before `marked.parse()`, replaced with HTML comment placeholders, then reinserted after markdown parsing. This prevents markdown from mangling component HTML.

## Technology Stack

- **HTML/CSS/JS** — Vanilla ES modules, no TypeScript, no bundler
- **Tailwind CSS** — Via CDN (`cdn.tailwindcss.com`)
- **marked.js** — Markdown parser via CDN
- **Google Fonts** — Iansui, Noto Sans TC/JP/SC, Noto Color Emoji
- **File System Access API** — For reading local `.md` files (requires HTTPS secure context)
- **IndexedDB** — Persists directory handle for session restoration

## Code Style

- ES modules with `export function` / `import { } from` syntax
- `async/await` for all asynchronous operations
- Single quotes in JavaScript
- Semicolons always used
- JSDoc `@param`/`@returns` on exported functions
- Silent error handling — graceful degradation, no `console.error`
- All inline CSS in `index.html` `<style>` block — no external stylesheet
- UI text in Traditional Chinese (zh-TW)
- Comments and code in English

## Development

### Running the Dev Server

```bash
./serve.zsh          # https://localhost:8443 (default)
./serve.zsh 8080     # custom port
```

The server auto-generates self-signed TLS certificates (required for File System Access API). Certificates are stored in `.certs/` (gitignored).

### No Build Step

Edit files directly. Refresh browser to see changes. No compilation, transpilation, or bundling required.

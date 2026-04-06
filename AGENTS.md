# AGENTS.md

## Project Overview

**MD Story Reader** — A pure-frontend web app that renders multi-chapter markdown story files with custom XML blocks (`<status>`, `<options>`, `<UpdateVariable>`) originating from SillyTavern AI chat sessions. No build step, no framework, no backend.

## Architecture

```
reader/                    # Web reader app
  index.html               # Single entry point — all CSS inline, HTML shell, module bootstrap
  js/
    chapter-nav.js          # App orchestrator: navigation, state, sidebar relocation
    file-reader.js          # File System Access API + IndexedDB persistence
    md-renderer.js          # 9-step markdown rendering pipeline
    status-bar.js           # <status> block parser → themed HTML card
    options-panel.js        # <options> block parser → 2×2 button grid
    variable-display.js     # <UpdateVariable> block parser → collapsible <pre>
  serve.zsh                 # HTTPS dev server (zsh + Node.js, self-signed TLS)
openspec/                  # Specifications (spec-driven development)
  specs/                    # 8 main spec files (one per module/concern)
  changes/archive/          # Completed change artifacts
regex.json                 # SillyTavern regex scripts (external tool counterpart)
short-template/            # Example story chapters with custom XML blocks
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
cd reader
./serve.zsh          # https://localhost:8443 (default)
./serve.zsh 8080     # custom port
```

The server auto-generates self-signed TLS certificates (required for File System Access API). Certificates are stored in `reader/.certs/` (gitignored).

### No Build Step

Edit files directly. Refresh browser to see changes. No compilation, transpilation, or bundling required.

## Off-Limits Files

**Do NOT read, modify, or reference** the following files — they are story content and personal data:

- `魔王大人的流行款/` (story content directory)
- `變數初始值.yml` (variable initial values)
- `變數結構.js` (variable structure)

## OpenSpec Workflow

This project uses [OpenSpec](https://github.com/nicholasgriffintn/openspec) for spec-driven development. Changes follow the lifecycle: **propose → apply → verify → archive → commit**.

- Specs live in `openspec/specs/<capability>/spec.md`
- Changes are proposed under `openspec/changes/<name>/` with artifacts: `proposal.md`, `design.md`, `specs/`, `tasks.md`
- Completed changes are archived to `openspec/changes/archive/`
- Skills for the workflow are in `.github/skills/`

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) format
- One `git commit` per completed change (after archive)
- All spec requirements use SHALL/MUST for normative language
- Each spec scenario uses WHEN/THEN format

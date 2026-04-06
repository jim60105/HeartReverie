## Context

The project root currently contains a mix of:
- **Web reader app**: `index.html`, `js/` (6 ES modules), `serve.zsh`
- **Story content**: `魔王大人的流行款/`, `變數初始值.yml`, `變數結構.js`
- **Templates/tools**: `short-template/`, `regex.json`
- **Project meta**: `README.md`, `.gitignore`, `openspec/`

This flat structure makes it hard to distinguish web app files from story content at a glance.

## Goals / Non-Goals

**Goals:**
- D1: Move all web reader files (`index.html`, `js/`, `serve.zsh`) into a `reader/` directory
- D2: Maintain identical runtime behaviour — no functional changes
- D3: Update `serve.zsh` paths so the dev server continues to work from the new location

**Non-Goals:**
- Changing any CSS, JS logic, or HTML structure
- Moving story content files, templates, or OpenSpec artifacts
- Refactoring module imports or build tooling (there is no build step)

## Decisions

### D1: Target directory name → `reader/`
The directory is named `reader/` to match the app's purpose (MD Story Reader). Alternatives considered:
- `app/` — too generic
- `web/` — less descriptive
- `frontend/` — implies a backend exists

### D2: Move strategy → `git mv`
Use `git mv` to preserve git history for moved files. The internal relative paths within `index.html` (e.g., `js/chapter-nav.js`) stay unchanged since the files move together, preserving their relative positions.

### D3: `serve.zsh` adjustment
`serve.zsh` currently serves the project root. After the move, it needs to serve from `reader/` or be moved into `reader/` and serve `.` (current directory). Moving `serve.zsh` into `reader/` is cleaner — the dev server lives with the app it serves.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Broken relative paths in HTML/JS | All web files move together — relative paths between them are unchanged |
| Git history harder to trace | `git mv` preserves rename detection; `git log --follow` works |
| `serve.zsh` path confusion | Update serve script to serve from its own directory |

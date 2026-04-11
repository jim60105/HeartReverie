## Context

The web reader's visual background is currently a flat `#0f0a0c` colour defined in `reader/index.html`. The project already ships `assets/heart.webp` at the repository root but does not serve or reference it. The backend serves static files from `READER_DIR` via Hono's `serveStatic`, and there is no mechanism to pass runtime configuration to the frontend.

## Goals / Non-Goals

**Goals:**
- Allow operators to set a background image via `BACKGROUND_IMAGE` env var
- Serve the `assets/` directory at `/assets/` so the default image works out of the box
- Provide a public `/api/config` endpoint returning non-sensitive frontend configuration
- Apply a fixed, viewport-covering background with a 50 % opacity black overlay for legibility

**Non-Goals:**
- Per-story or per-chapter background customisation
- Upload UI for background images
- Full theming system beyond background image

## Decisions

### D1: New `BACKGROUND_IMAGE` env var with URL-path default
Add `BACKGROUND_IMAGE` to `writer/lib/config.ts` defaulting to `/assets/heart.webp`. The value is a URL path, not a filesystem path — it is returned as-is to the frontend.

**Alternative**: Use a CSS-variable override — rejected because operators cannot set CSS variables without modifying source files.

### D2: Public `/api/config` endpoint
Create a `GET /api/config` route that returns `{ backgroundImage: string }`. This endpoint does **not** require authentication — it only exposes non-sensitive display configuration. This avoids a chicken-and-egg problem where the background would flash after the user enters their passphrase.

**Alternative**: Authenticated endpoint — rejected because the background should render before login.

### D3: Serve `assets/` via a second `serveStatic` mount
Mount `/assets/*` → `<ROOT_DIR>/assets/` before the `READER_DIR` catch-all. This keeps operator assets separate from the reader source tree.

**Alternative**: Copy `heart.webp` into `reader/` — rejected because it mixes data/assets with the frontend source tree.

### D4: CSS overlay via `::before` pseudo-element on `body`
Apply `background: url(...) center/cover no-repeat fixed` on `body` and use a `body::before` pseudo-element with `background: rgba(0,0,0,0.5)` to create the semi-transparent overlay. This preserves the existing `#0f0a0c` as a fallback.

**Alternative**: Wrapping div — rejected to avoid structural HTML changes.

### D5: Frontend applies background on load
A small inline `<script>` or the existing `main.js` entry point fetches `/api/config` on page load and sets `document.body.style.backgroundImage`. The overlay is pure CSS and needs no JS.

## Risks / Trade-offs

- **[Image not found]** → The `#0f0a0c` fallback background colour remains visible; no broken layout.
- **[Large image]** → The operator controls their own asset; documentation should recommend optimised images.
- **[Config endpoint leaks info]** → Only background path is exposed; review before adding fields.

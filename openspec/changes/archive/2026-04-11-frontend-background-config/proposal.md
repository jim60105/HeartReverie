## Why

The web reader currently has a flat dark background (`#0f0a0c`) with no visual depth. Adding a configurable background image — defaulting to the project's existing `assets/heart.webp` — will improve the atmospheric quality of the reading experience while keeping it operator-customisable via an environment variable.

## What Changes

- Add `BACKGROUND_IMAGE` env var to configure the background image path (default: `/assets/heart.webp`)
- Add a new `/api/config` public endpoint that returns non-sensitive frontend configuration (background image path)
- Serve the project-root `assets/` directory as a static route at `/assets/`
- Apply CSS for a fixed, viewport-covering background image with a semi-transparent black overlay (50 % opacity) to maintain text legibility
- **BREAKING**: Modifies the `page-layout` spec's "Body background colour preserved" requirement — `background-color` alone no longer defines the full background treatment

## Capabilities

### New Capabilities
- `frontend-background`: Configurable background image with overlay for the web reader, including the env var, config endpoint, asset serving, and CSS styling

### Modified Capabilities
- `page-layout`: The "Body background colour preserved" requirement expands to include a background image layer and overlay on top of the existing background colour

## Impact

- `writer/lib/config.ts` — new `BACKGROUND_IMAGE` export
- `writer/app.ts` — new `/assets/` static route and `/api/config` endpoint
- `reader/index.html` — CSS changes for background image and overlay
- `reader/js/` — new or updated module to fetch config and apply background dynamically
- `.env.example` — document new env var
- `AGENTS.md` — document new env var in the table

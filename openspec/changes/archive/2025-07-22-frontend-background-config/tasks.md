## 1. Backend Configuration

- [x] 1.1 Add `BACKGROUND_IMAGE` env var to `writer/lib/config.ts` with default `/assets/heart.webp`
- [x] 1.2 Add `BACKGROUND_IMAGE` to `.env.example` with a comment
- [x] 1.3 Document `BACKGROUND_IMAGE` in `AGENTS.md` env var table

## 2. Asset Serving

- [x] 2.1 Mount `/assets/*` static route in `writer/app.ts` pointing to `<ROOT_DIR>/assets/`, before the `READER_DIR` catch-all

## 3. Config Endpoint

- [x] 3.1 Create `GET /api/config` route in `writer/app.ts` (or a new route module) returning `{ backgroundImage }` — no auth required
- [x] 3.2 Place the route before the auth middleware so it is publicly accessible

## 4. Frontend CSS

- [x] 4.1 Add `body::before` pseudo-element CSS in `reader/index.html` for the semi-transparent overlay (`rgba(0,0,0,0.5)`, `position: fixed`, full viewport, `z-index: -1`, `pointer-events: none`)
- [x] 4.2 Ensure `body` retains `background-color: #0f0a0c` as fallback and add `background-size: cover; background-position: center; background-attachment: fixed; background-repeat: no-repeat`

## 5. Frontend Config Fetching

- [x] 5.1 Add JS code (inline or in a module) to fetch `/api/config` on page load and set `document.body.style.backgroundImage` from the response
- [x] 5.2 Ensure graceful degradation — catch fetch errors silently, no console errors

## 6. Testing & Verification

- [x] 6.1 Run existing Deno tests to confirm no regressions
- [x] 6.2 Use agent-browser to verify the background image and overlay render correctly on the frontend

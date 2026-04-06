## Why

The application currently has no access control — anyone who can reach the server URL can read stories, write chapters, and trigger OpenRouter API calls (which cost money). A simple passphrase gate is needed to restrict access to authorized users without adding the complexity of a full user authentication system.

## What Changes

- Add `PASSPHRASE` environment variable support to the server configuration (loaded from `.env` or system env)
- Add Express middleware that validates a passphrase header (`X-Passphrase`) on all `/api/` routes before any processing occurs; skip validation when `PASSPHRASE` is not configured
- Use timing-safe comparison for passphrase verification to prevent timing attacks
- Return 401 Unauthorized for missing or incorrect passphrase, blocking all data access and OpenRouter requests
- Add a fullscreen passphrase overlay to the frontend that blocks all interaction until a correct passphrase is provided
- Store the verified passphrase in `sessionStorage` and include it as an `X-Passphrase` header on every API request from all frontend modules
- Add a dedicated `GET /api/auth/verify` endpoint for the frontend to validate the passphrase before revealing the main UI

## Capabilities

### New Capabilities
- `passphrase-gate`: Server-side passphrase middleware and frontend passphrase overlay that gates all access to the application

### Modified Capabilities
- `unified-server`: Configuration requirement changes to include the new `PASSPHRASE` environment variable
- `writer-backend`: All API routes gain a passphrase verification middleware; new `/api/auth/verify` endpoint added
- `story-selector`: All fetch calls must include the `X-Passphrase` header
- `chat-input`: All fetch calls must include the `X-Passphrase` header

## Impact

- **Backend**: `writer/server.js` — new middleware function added before all `/api/` routes; new `/api/auth/verify` route; `crypto.timingSafeEqual` imported for secure comparison
- **Frontend**: `reader/index.html` — new passphrase overlay HTML and initialization logic in the script block
- **Frontend modules**: `reader/js/story-selector.js` and `reader/js/chat-input.js` — fetch calls updated to include `X-Passphrase` header; new `reader/js/passphrase-gate.js` module
- **Configuration**: `.env` file gains optional `PASSPHRASE` variable
- **Dependencies**: No new npm packages required (uses Node.js built-in `crypto`)

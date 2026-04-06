## Context

The application is a story writing tool with an Express HTTPS backend (`writer/server.js`) and a vanilla JS frontend (`reader/index.html`). All API routes are under `/api/stories/...` and serve story data plus proxy chat requests to OpenRouter (paid LLM API). Currently there is zero access control — anyone with the URL has full read/write access and can trigger OpenRouter costs.

The server already uses `process.loadEnvFile()` for `.env` loading, Express middleware patterns (`validateParams`), and the frontend uses ES modules with `fetch()` for all API calls.

## Goals / Non-Goals

**Goals:**
- Gate all application access behind a single shared passphrase
- Prevent unauthorized users from reading stories, writing chapters, or triggering OpenRouter API calls
- Make the passphrase optional — if `PASSPHRASE` is not set, the server behaves as before (open access)
- Use secure comparison to prevent timing attacks
- Minimal UI friction — enter passphrase once per session

**Non-Goals:**
- Per-user accounts or role-based access control
- Password hashing or persistent storage (passphrase is compared directly from env var)
- Rate limiting or brute-force protection (out of scope for this change)
- Changing the TLS/certificate setup

## Decisions

### Decision 1: Passphrase transmitted via `X-Passphrase` request header

**Choice**: Custom `X-Passphrase` header on every API request.

**Rationale**: Headers are not logged by default in Express, not cached by browsers, and not included in URL history. The server already uses HTTPS (TLS), so header transmission is encrypted in transit. A custom header is simpler than session/cookie management and avoids CSRF concerns.

**Alternatives considered**:
- *Session cookie after login*: More complex; requires cookie-parser, session store, CSRF tokens. Overkill for a single shared passphrase.
- *Bearer token (JWT)*: Unnecessary complexity — there is no user identity to encode, just a shared secret.
- *Query parameter*: Logged in server access logs, cached in browser history. Insecure.

### Decision 2: Single Express middleware before all `/api/` routes

**Choice**: A `verifyPassphrase` middleware function mounted with `app.use('/api', ...)` before any route handlers.

**Rationale**: Centralizes the check in one place. Follows the existing pattern of `validateParams` middleware. Guarantees no API route can be reached without verification.

### Decision 3: `crypto.timingSafeEqual` for comparison

**Choice**: Use Node.js built-in `crypto.timingSafeEqual()` to compare the passphrase.

**Rationale**: Prevents timing side-channel attacks. Both strings are converted to Buffers of equal length before comparison. This is an OWASP-recommended practice for secret comparison.

### Decision 4: Frontend passphrase overlay with `sessionStorage`

**Choice**: New `reader/js/passphrase-gate.js` module that shows a fullscreen overlay, verifies via `GET /api/auth/verify`, stores the passphrase in `sessionStorage`, and exposes a `getPassphrase()` function that other modules use to build request headers.

**Rationale**: `sessionStorage` persists across page reloads within the same tab but clears when the tab is closed — appropriate security for a session-scoped secret. A shared `getPassphrase()` function avoids duplicating header logic across modules.

### Decision 5: Dedicated verify endpoint `GET /api/auth/verify`

**Choice**: Add `GET /api/auth/verify` that returns 200 if the passphrase is correct (or if no passphrase is configured) and 401 otherwise.

**Rationale**: The frontend needs a lightweight way to test the passphrase before revealing the UI. Using an existing endpoint (e.g., `GET /api/stories`) would work but conflates authorization testing with data fetching. A dedicated endpoint makes the intent clear and avoids side effects.

### Decision 6: Header injection via a shared helper

**Choice**: Export a `getAuthHeaders()` function from `passphrase-gate.js` that returns `{ 'X-Passphrase': storedPassphrase }` (or `{}` if empty). All modules (`story-selector.js`, `chat-input.js`, `chapter-nav.js`) import and spread this into their fetch headers.

**Rationale**: Single source of truth. Adding new API-calling modules in the future just needs one import. Avoids passing the passphrase through constructor options or globals.

## Risks / Trade-offs

- **[Shared secret]** A single passphrase means all users share the same credential. → Acceptable for a personal/small-group tool. Upgrade path: replace with user accounts later.
- **[No brute-force protection]** An attacker could try many passphrases. → Mitigated by TLS (no sniffing) and the assumption of limited network exposure. Rate limiting can be added later.
- **[sessionStorage cleared on tab close]** Users must re-enter the passphrase when opening a new tab. → Acceptable trade-off for security. Using `localStorage` would persist across sessions, which is less secure.
- **[Passphrase in memory]** The passphrase lives in JS memory and sessionStorage. → Unavoidable for client-side state. Same risk as any SPA authentication token.

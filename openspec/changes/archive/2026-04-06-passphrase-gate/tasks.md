## 1. Backend: Passphrase Middleware

- [x] 1.1 Add `import crypto from 'node:crypto'` to `writer/server.js`
- [x] 1.2 Implement `verifyPassphrase` middleware function in `writer/server.js` that reads `process.env.PASSPHRASE`, skips if not set, extracts `X-Passphrase` header, compares using `crypto.timingSafeEqual` with Buffer conversion, and returns 401 JSON on mismatch
- [x] 1.3 Mount `verifyPassphrase` middleware on all `/api/` routes with `app.use('/api', verifyPassphrase)` before any existing route handlers (after `express.json()` middleware)

## 2. Backend: Verify Endpoint

- [x] 2.1 Add `GET /api/auth/verify` route handler in `writer/server.js` that returns `{ "ok": true }` with HTTP 200 (passphrase check is handled by the middleware)

## 3. Frontend: Passphrase Gate Module

- [x] 3.1 Create `reader/js/passphrase-gate.js` with `getAuthHeaders()` export that returns `{ 'X-Passphrase': value }` from `sessionStorage` or `{}` if not stored
- [x] 3.2 Add `setPassphrase(value)` function that stores the passphrase in `sessionStorage`
- [x] 3.3 Add `checkPassphraseRequired()` async function that calls `GET /api/auth/verify` without a passphrase header and returns `true` if 401, `false` if 200
- [x] 3.4 Add `verifyPassphrase(value)` async function that calls `GET /api/auth/verify` with the provided value in `X-Passphrase` header and returns `true` if 200, `false` otherwise
- [x] 3.5 Add `initPassphraseGate(overlayEl, onUnlocked)` function that checks if passphrase is required, shows/hides the overlay, handles submit, stores passphrase on success, and calls `onUnlocked` callback

## 4. Frontend: Passphrase Overlay HTML

- [x] 4.1 Add passphrase overlay HTML to `reader/index.html` — a fullscreen div with passphrase input, submit button, and error message area, styled to match the existing dark theme
- [x] 4.2 Wrap the main application initialization in the `index.html` script block inside the `onUnlocked` callback from `initPassphraseGate`, so story selector, chat input, and session restore only run after passphrase verification

## 5. Frontend: Update API Modules with Auth Headers

- [x] 5.1 Update `reader/js/story-selector.js` — import `getAuthHeaders` from `passphrase-gate.js` and spread into fetch headers for `loadSeriesList()`, `loadStoryList()`, and `createStory()`
- [x] 5.2 Update `reader/js/chat-input.js` — import `getAuthHeaders` from `passphrase-gate.js` and spread into fetch headers for the POST chat request and the DELETE last chapter request in both `handleSend()` and `handleResend()`
- [x] 5.3 Update `reader/js/chapter-nav.js` — import `getAuthHeaders` from `passphrase-gate.js` and spread into fetch headers for all `fetch()` calls in `loadFromBackend()`, `reloadFromBackendToLast()`, and `pollBackend()`

## 6. Verification

- [x] 6.1 Verify server starts without errors when `PASSPHRASE` is not set (open access mode)
- [x] 6.2 Verify server returns 401 on API requests when `PASSPHRASE` is set and no header is provided
- [x] 6.3 Verify server returns 200 on `GET /api/auth/verify` when correct passphrase header is sent
- [x] 6.4 Verify frontend overlay appears when passphrase is required, hides after correct entry, and all subsequent API calls include the header

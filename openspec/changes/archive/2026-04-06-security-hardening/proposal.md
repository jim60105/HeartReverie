## Why

A security audit against OWASP API Security Top 10 (2023) and OWASP Top 10:2025 identified critical XSS vulnerabilities in the markdown rendering pipeline, missing security headers, no rate limiting, and several hardening gaps. The most urgent issue is DOM XSS via `marked.parse()` output injected into `innerHTML` without sanitization — regex-based `<script>` stripping is trivially bypassable with event handlers (`onerror`, `onload`, etc.).

## What Changes

### Critical — DOM XSS Prevention
- Add DOMPurify to sanitize all HTML before `innerHTML` assignment
- Sanitize after component placeholder reinjection (not before)
- Pin marked.js CDN version and add SRI hash

### High — Authentication & Headers
- Fail-closed auth: reject all API requests when `PASSPHRASE` env var is unset (currently silently skips auth)
- Add SRI attributes to all CDN `<script>` tags (Tailwind, marked.js)
- Add Content Security Policy via `<meta>` tag
- Add `helmet` middleware for security headers (X-Content-Type-Options, HSTS, etc.)

### Medium — Rate Limiting & Input Hardening
- Add `express-rate-limit` on all `/api` routes, stricter on `/api/auth/verify` and chat endpoint
- Sanitize OpenRouter error responses (don't forward upstream error bodies)
- Add chapter count cap in chat endpoint to prevent memory exhaustion
- Consolidate `escapeHtml()` into shared utility with single-quote escaping
- Replace inline `onclick` handlers with event delegation
- Replace inline `onmouseover`/`onmouseout` with CSS `:hover`
- Remove `window.__appendToInput` global bridge

### Low — Cleanup & Observability
- Remove dead `app.param()` handlers
- Add `dotfiles: 'deny'` to `express.static()`
- Add request logging for security-sensitive operations
- Pin CDN dependency versions

## Capabilities

### New Capabilities
- `security-headers`: CSP meta tag, helmet middleware, SRI on external scripts

### Modified Capabilities
- `md-renderer`: Add DOMPurify sanitization after markdown rendering and component reinjection
- `writer-backend`: Fail-closed auth, rate limiting, helmet, error sanitization, chapter cap, audit logging, static file options
- `chat-input`: Remove error body reflection, use generic error messages
- `options-panel`: Replace inline onclick with event delegation, consolidate escapeHtml
- `page-layout`: Replace inline hover handlers with CSS `:hover`, remove global bridge

## Impact

- **Dependencies:** Add `dompurify` (CDN), `helmet`, `express-rate-limit` (npm)
- **Backend:** `writer/server.js` — middleware additions, error handling changes
- **Frontend:** `reader/index.html` — CSP meta, SRI hashes, CSS hover, script cleanup
- **Frontend:** `reader/js/md-renderer.js` — DOMPurify integration
- **Frontend:** `reader/js/options-panel.js` — event delegation refactor
- **Breaking:** Deployments without `PASSPHRASE` env var will reject all API requests instead of silently allowing access

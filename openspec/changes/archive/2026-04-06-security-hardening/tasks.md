## 1. Dependencies & Setup

- [x] 1.1 Install `helmet` and `express-rate-limit` npm packages in writer/
- [x] 1.2 Pin marked.js CDN to specific version and add SRI hash to `<script>` tag in index.html
- [x] 1.3 Add DOMPurify CDN `<script>` tag with pinned version and SRI hash in index.html
- [x] 1.4 Pin Tailwind CDN to specific version (or add SRI if feasible) in index.html

## 2. Critical — DOM XSS Prevention

- [x] 2.1 Add DOMPurify.sanitize() call in md-renderer.js renderMarkdown() AFTER reinjectPlaceholders() and BEFORE innerHTML assignment
- [x] 2.2 Remove regex-based `<script>` stripping in md-renderer.js (DOMPurify handles it)
- [x] 2.3 Verify DOMPurify blocks `<img onerror>`, `<svg onload>`, `<details ontoggle>` attack vectors

## 3. High — Authentication Hardening

- [x] 3.1 Change verifyPassphrase middleware to return 503 when PASSPHRASE env var is unset (fail-closed)
- [x] 3.2 Remove the `if (!expected) return next();` early return in verifyPassphrase

## 4. High — Security Headers

- [x] 4.1 Add `helmet()` middleware in server.js before route handlers
- [x] 4.2 Add CSP `<meta>` tag in index.html allowing 'self', pinned CDN origins for scripts, 'unsafe-inline' for styles, fonts.googleapis.com/gstatic.com for fonts
- [x] 4.3 Add `crossorigin="anonymous"` attribute to all CDN script/link tags

## 5. Medium — Rate Limiting

- [x] 5.1 Add global rate limit on `/api` routes (60 req/min)
- [x] 5.2 Add stricter rate limit on `/api/auth/verify` (10 req/min)
- [x] 5.3 Add stricter rate limit on `/api/stories/:series/:name/chat` (10 req/min)

## 6. Medium — Error Response Sanitization

- [x] 6.1 Replace raw OpenRouter error body forwarding in server.js with generic "AI service request failed" message
- [x] 6.2 Change chat-input.js error display to use generic error messages instead of raw server response text

## 7. Medium — Resource Consumption Limits

- [x] 7.1 Add chapter count cap (e.g., 200) in chat endpoint to limit memory usage

## 8. Medium — Inline Handler Cleanup

- [x] 8.1 Create shared `escapeHtml()` utility in reader/js/utils.js with single-quote escaping
- [x] 8.2 Update options-panel.js, status-bar.js, variable-display.js to import shared escapeHtml
- [x] 8.3 Replace inline `onclick` in options-panel.js with event delegation on content container
- [x] 8.4 Replace all inline `onmouseover`/`onmouseout` in index.html with CSS `:hover` rules
- [x] 8.5 Remove `window.__appendToInput` global bridge from index.html

## 9. Low — Backend Cleanup

- [x] 9.1 Remove dead `app.param()` handlers in server.js
- [x] 9.2 Add `dotfiles: 'deny'` option to `express.static()` call
- [x] 9.3 Add basic request logging for auth failures and security-sensitive operations

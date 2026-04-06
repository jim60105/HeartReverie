# Security Hardening — Design

## Context

The app is an Express 5 HTTPS server (`writer/server.js`) serving a SPA frontend (`reader/`). A security audit against OWASP API Security Top 10 (2023) and OWASP Top 10:2025 found critical XSS vulnerabilities in the markdown rendering pipeline, missing security headers, no rate limiting, and auth fail-open. The most urgent issue is DOM XSS via `marked.parse()` output injected into `innerHTML` without sanitization — the existing regex-based `<script>` stripping is trivially bypassable with event handlers (`onerror`, `onload`, etc.).

## Goals

- Eliminate all XSS vectors (DOMPurify sanitization, Content Security Policy)
- Fail-closed authentication — reject requests when PASSPHRASE is unset
- Rate limiting on all API endpoints
- Security headers via helmet middleware
- Subresource Integrity (SRI) on all CDN scripts

## Non-Goals

- OAuth/JWT migration (passphrase is sufficient for this use case)
- WAF deployment
- Automated security scanning in CI/CD
- Server-side rendering

## Decisions

1. **DOMPurify via CDN** (not npm) — The frontend is vanilla JS without a build step, so CDN delivery is consistent with the existing marked.js approach. Pin version and add SRI hash.

2. **Sanitize after reinjection** — `DOMPurify.sanitize()` must run on the FINAL HTML (after `reinjectPlaceholders()`), not before. This means the sanitization call goes in `md-renderer.js` `renderMarkdown()` after placeholders are reinjected, ensuring specialist-rendered components (status bar, options panel) are also sanitized.

3. **helmet middleware** (npm) — Standard Express security headers package. Add to `writer/server.js` before all route handlers to set X-Content-Type-Options, HSTS, X-Frame-Options, Referrer-Policy, etc.

4. **express-rate-limit** (npm) — Rate limiting with three tiers:
   - 60 req/min global on `/api` routes
   - 5 req/min on `/api/auth/verify`
   - 10 req/min on the chat endpoint

5. **Fail-closed auth** — When `PASSPHRASE` is unset, return 503 Service Unavailable on all `/api` routes instead of skipping auth. This is a **BREAKING** change for existing deployments that rely on the implicit open-access behavior.

6. **CSS `:hover` replaces inline `onmouseover`/`onmouseout`** — Eliminates ~20 inline event handlers from `page-layout`, enabling strict CSP without `'unsafe-inline'` for scripts.

7. **Event delegation replaces inline `onclick` in `options-panel.js`** — A single listener on the `#content` container catches all option button clicks via event bubbling, removing per-button inline handlers.

8. **Shared `escapeHtml` utility** — Consolidate 3 duplicate `escapeHtml()` functions into `reader/js/utils.js`, adding single-quote escaping (`'` → `&#39;`) to prevent attribute breakout.

## Risks / Trade-offs

- **DOMPurify CDN dependency** → Pin version + SRI hash mitigates supply chain risk. If CDN is unavailable, sanitization function won't load and rendering will fail safely (no unsanitized output).

- **Fail-closed breaks existing deployments** → Document the breaking change in README with clear error message ("PASSPHRASE environment variable is not set. Set it to enable API access."). Provide migration guidance.

- **Rate limiting may affect legitimate heavy users** → Generous limits (60/min global) should accommodate normal usage. Limits can be made configurable via environment variables if needed later.

- **CSP may break future features** → Start with a permissive policy (allow pinned CDN origins, `'unsafe-inline'` for styles only), tighten over time as inline handlers are fully eliminated.

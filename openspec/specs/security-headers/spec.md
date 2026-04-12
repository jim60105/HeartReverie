# Security Headers

## Purpose

Provides browser-enforced security policies and server-side security response headers to mitigate XSS, clickjacking, MIME sniffing, and man-in-the-middle attacks.

## Requirements

### Requirement: Content Security Policy
The system SHALL include a Content-Security-Policy meta tag that restricts script sources to `'self'` plus any necessary CDN origins for runtime dependencies. The CSP SHALL NOT include `'unsafe-eval'` — this directive is no longer needed because Tailwind CSS is processed at build time via PostCSS instead of evaluated at runtime via the Tailwind CDN. The CSP SHALL disallow unsafe-inline scripts (except `'unsafe-inline'` for styles if needed by Vue's scoped style injection). The `connect-src` directive SHALL be restricted to `'self'` and any CDN origins required for source maps or resource fetches. The `script-src` directive SHALL be restricted to `'self'` plus any CDN origins still loaded at runtime (e.g., if DOMPurify or marked remain as CDN scripts rather than bundled).

#### Scenario: CSP blocks inline script injection
- **WHEN** an attacker injects `<script>alert(1)</script>` into rendered content
- **THEN** the browser blocks execution due to CSP `script-src` policy

#### Scenario: CSP does not include unsafe-eval
- **WHEN** the CSP meta tag is inspected
- **THEN** the `script-src` directive SHALL NOT contain `'unsafe-eval'` because Tailwind CSS is now compiled at build time via PostCSS, not evaluated at runtime

#### Scenario: CSP allows self-hosted bundled scripts
- **WHEN** the page loads Vite-bundled JavaScript from the same origin
- **THEN** the scripts SHALL load successfully because `'self'` is listed in `script-src`

#### Scenario: Development mode CSP allows Vite HMR
- **WHEN** the application is running in development mode via `deno task dev:reader` (Vite dev server)
- **THEN** the CSP in the development `index.html` (`reader-src/index.html`) SHALL allow scripts from the Vite dev server origin and SHALL allow websocket connections (`ws:` / `wss:`) in `connect-src` for Hot Module Replacement. This MAY be implemented by having a different `<meta>` CSP tag in the development `reader-src/index.html` versus the production build output. The production `reader-dist/index.html` SHALL NOT include these relaxed dev-mode directives.

#### Scenario: Production CSP does not include dev-mode relaxations
- **WHEN** the production `reader-dist/index.html` CSP meta tag is inspected after `deno task build:reader`
- **THEN** the `script-src` SHALL NOT include the Vite dev server origin and `connect-src` SHALL NOT include `ws:` or `wss:` directives — only the strict `'self'` policy SHALL apply

#### Scenario: CSP blocks unpinned external scripts
- **WHEN** an attacker injects a `<script src="https://evil.com/malware.js">` tag
- **THEN** the browser SHALL refuse to load the script because the origin is not in the CSP `script-src` allowlist

### Requirement: Subresource Integrity on CDN scripts
The system SHALL include `integrity` and `crossorigin="anonymous"` attributes on all external `<script>` and `<link>` tags loaded from CDN origins. SRI hashes SHALL be updated to match the new bundled asset fingerprints produced by Vite. If CDN dependencies (marked, DOMPurify) are bundled via npm imports instead of CDN `<script>` tags, the SRI requirement for those specific resources is superseded by the Vite bundle's own content hash filenames.

#### Scenario: CDN script with valid SRI loads
- **WHEN** the page loads with any remaining CDN scripts
- **THEN** all external scripts SHALL load successfully with matching integrity hashes

#### Scenario: Tampered CDN script blocked
- **WHEN** a CDN script's content doesn't match the integrity hash
- **THEN** the browser refuses to execute the script

#### Scenario: Bundled dependencies use content-hashed filenames
- **WHEN** CDN dependencies (marked, DOMPurify) are bundled via Vite as npm imports
- **THEN** the bundled output SHALL use content-hashed filenames (e.g., `index-abc123.js`) which provide equivalent integrity guarantees without explicit SRI attributes

### Requirement: DOMPurify usage preserved in Vue components

DOMPurify SHALL continue to be used for HTML sanitization within Vue components that render user-generated or LLM-generated HTML content. The sanitization SHALL be applied before injecting HTML via `v-html` directives. DOMPurify MAY be imported as an npm dependency instead of loaded from CDN.

#### Scenario: v-html content is sanitized
- **WHEN** a Vue component renders LLM-generated HTML using `v-html`
- **THEN** the HTML SHALL be passed through DOMPurify.sanitize() before being bound to the `v-html` directive

#### Scenario: DOMPurify available as module import
- **WHEN** a Vue component needs to sanitize HTML
- **THEN** DOMPurify SHALL be importable as an ES module (either from npm or CDN) with TypeScript type definitions available

### Requirement: Security response headers

The system SHALL use Hono's `secureHeaders()` middleware to set security headers including X-Content-Type-Options, Strict-Transport-Security, X-Frame-Options, and Referrer-Policy. This replaces the helmet middleware used in the Express version.

#### Scenario: Response includes security headers
- **WHEN** any HTTP response is served via the Hono application
- **THEN** the response includes `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Strict-Transport-Security` headers set by Hono's `secureHeaders()` middleware

#### Scenario: Referrer-Policy is set
- **WHEN** any HTTP response is served
- **THEN** the response includes a `Referrer-Policy` header restricting referrer information sent to external origins

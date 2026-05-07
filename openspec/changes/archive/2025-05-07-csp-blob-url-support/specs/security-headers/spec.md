## MODIFIED Requirements

### Requirement: Content Security Policy
The system SHALL include a Content-Security-Policy meta tag that restricts script sources to `'self'` plus any necessary CDN origins for runtime dependencies. The CSP SHALL NOT include `'unsafe-eval'` — this directive is no longer needed because Tailwind CSS is processed at build time via PostCSS instead of evaluated at runtime via the Tailwind CDN. The CSP SHALL disallow unsafe-inline scripts (except `'unsafe-inline'` for styles if needed by Vue's scoped style injection). The `connect-src` directive SHALL be restricted to `'self'` and any CDN origins required for source maps or resource fetches. The `script-src` directive SHALL be restricted to `'self'` plus any CDN origins still loaded at runtime (e.g., if DOMPurify or marked remain as CDN scripts rather than bundled). The `img-src` directive SHALL include `'self'`, `data:`, and `blob:` to allow plugins to display images fetched via authenticated API calls and converted to object URLs via `URL.createObjectURL()`.

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

#### Scenario: CSP allows plugin blob URL images
- **WHEN** a plugin fetches an image via an authenticated API call and creates a blob URL using `URL.createObjectURL()`
- **THEN** the browser SHALL allow the image to load because `blob:` is included in the CSP `img-src` directive

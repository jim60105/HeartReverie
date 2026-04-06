# Security Headers

## Purpose

Provides browser-enforced security policies and server-side security response headers to mitigate XSS, clickjacking, MIME sniffing, and man-in-the-middle attacks.

## Requirements

### Requirement: Content Security Policy
The system SHALL include a Content-Security-Policy meta tag that restricts script sources to `'self'` and pinned CDN origins, disallows unsafe-inline scripts (except `'unsafe-inline'` for styles), and restricts `connect-src` to `'self'`.

#### Scenario: CSP blocks inline script injection
- **WHEN** an attacker injects `<script>alert(1)</script>` into rendered content
- **THEN** the browser blocks execution due to CSP `script-src` policy

#### Scenario: CSP allows pinned CDN scripts
- **WHEN** the page loads scripts from pinned CDN origins (e.g., cdnjs.cloudflare.com)
- **THEN** the scripts SHALL load successfully because the CDN origin is listed in `script-src`

#### Scenario: CSP blocks unpinned external scripts
- **WHEN** an attacker injects a `<script src="https://evil.com/malware.js">` tag
- **THEN** the browser SHALL refuse to load the script because the origin is not in the CSP `script-src` allowlist

### Requirement: Subresource Integrity on CDN scripts
The system SHALL include `integrity` and `crossorigin="anonymous"` attributes on all external `<script>` and `<link>` tags loaded from CDN origins.

#### Scenario: CDN script with valid SRI loads
- **WHEN** the page loads with pinned CDN scripts
- **THEN** all scripts load successfully with matching integrity hashes

#### Scenario: Tampered CDN script blocked
- **WHEN** a CDN script's content doesn't match the integrity hash
- **THEN** the browser refuses to execute the script

### Requirement: Security response headers
The system SHALL use helmet middleware to set security headers including X-Content-Type-Options, Strict-Transport-Security, X-Frame-Options, and Referrer-Policy.

#### Scenario: Response includes security headers
- **WHEN** any HTTP response is served
- **THEN** the response includes `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Strict-Transport-Security` headers

#### Scenario: Referrer-Policy is set
- **WHEN** any HTTP response is served
- **THEN** the response includes a `Referrer-Policy` header restricting referrer information sent to external origins

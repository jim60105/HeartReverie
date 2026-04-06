## MODIFIED Requirements

### Requirement: Content Security Policy
The CSP `connect-src` directive SHALL include `https://cdn.jsdelivr.net` in addition to `'self'` to allow source map and resource fetches from the same CDN origin trusted for scripts.

#### Scenario: DOMPurify source map fetch
- **WHEN** the browser attempts to fetch a `.map` file from `cdn.jsdelivr.net`
- **THEN** the request SHALL be allowed by the CSP `connect-src` directive without console violations

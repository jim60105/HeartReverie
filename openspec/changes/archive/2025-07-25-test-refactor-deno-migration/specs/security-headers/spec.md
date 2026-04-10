## MODIFIED Requirements

### Requirement: Security response headers

The system SHALL use Hono's `secureHeaders()` middleware to set security headers including X-Content-Type-Options, Strict-Transport-Security, X-Frame-Options, and Referrer-Policy. This replaces the helmet middleware used in the Express version.

#### Scenario: Response includes security headers
- **WHEN** any HTTP response is served via the Hono application
- **THEN** the response includes `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Strict-Transport-Security` headers set by Hono's `secureHeaders()` middleware

#### Scenario: Referrer-Policy is set
- **WHEN** any HTTP response is served
- **THEN** the response includes a `Referrer-Policy` header restricting referrer information sent to external origins

## MODIFIED Requirements

### Requirement: Rate limiting
The server SHALL enforce request rate limits on API routes using fixed-window counters. Rate limits are relaxed for single-user deployment scenarios. Four rate-limit tiers SHALL be configured:
- **Global API**: 300 requests per minute on all `/api` routes
- **Auth verify**: 30 requests per minute on `/api/auth/verify`
- **Chat endpoint**: 30 requests per minute on `/api/stories/:series/:name/chat`
- **Preview prompt**: 60 requests per minute on `/api/stories/:series/:name/preview-prompt`

Stricter per-endpoint limits SHALL take precedence over the global limit. When a rate limit is exceeded, the server SHALL return HTTP 429 with a Problem Details JSON body.

#### Scenario: Global rate limit enforced
- **WHEN** a client exceeds 300 requests per minute to `/api` routes
- **THEN** the server SHALL return HTTP 429 with a Problem Details error

#### Scenario: Auth verify rate limit enforced
- **WHEN** a client exceeds 30 requests per minute to `/api/auth/verify`
- **THEN** the server SHALL return HTTP 429 before the global limit is reached

#### Scenario: Chat endpoint rate limit enforced
- **WHEN** a client exceeds 30 requests per minute to the chat endpoint
- **THEN** the server SHALL return HTTP 429 before the global limit is reached

#### Scenario: Preview prompt rate limit enforced
- **WHEN** a client exceeds 60 requests per minute to the preview-prompt endpoint
- **THEN** the server SHALL return HTTP 429 before the global limit is reached

#### Scenario: Normal usage within limits
- **WHEN** a client sends requests within the configured rate limits (including rapid page loads, polling fallback at 3-second intervals, and batch chapter loading)
- **THEN** all requests SHALL be processed normally without throttling

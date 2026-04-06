## MODIFIED Requirements

### Requirement: Backend polling interval
The backend polling interval SHALL be 3 seconds (3000ms) instead of 1 second.

#### Scenario: Normal polling rate
- **WHEN** backend polling is active
- **THEN** the poll function SHALL execute every 3 seconds

### Requirement: Rate-limit backoff
When the backend returns a 429 (Too Many Requests) response, the polling interval SHALL increase using exponential backoff, capped at 30 seconds. On the next successful response, the interval SHALL reset to the base 3-second interval.

#### Scenario: 429 response triggers backoff
- **WHEN** `pollBackend` receives a 429 response
- **THEN** the polling interval SHALL double (up to a maximum of 30 seconds)

#### Scenario: Successful response resets interval
- **WHEN** `pollBackend` receives a successful response after backoff
- **THEN** the polling interval SHALL reset to 3 seconds

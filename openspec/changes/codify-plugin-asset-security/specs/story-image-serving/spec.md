## ADDED Requirements

### Requirement: Image responses SHALL carry `X-Content-Type-Options: nosniff`

Every successful response from `GET /api/stories/:series/:story/images/:filename` SHALL include the header `X-Content-Type-Options: nosniff` in addition to the existing `Content-Type` and `Cache-Control` headers. This prevents browsers from MIME-sniffing a polyglot image as `text/html` or `application/javascript` and executing embedded payloads — a defense-in-depth measure recommended by the `audit-plugins` review of the sd-webui image pipeline.

The header SHALL be present on all four supported image types (`.avif`, `.webp`, `.png`, `.jpg`/`.jpeg`). Error responses (`400`, `404`) need not carry the header.

#### Scenario: AVIF response carries nosniff

- **GIVEN** `playground/my-series/my-story/_images/ch01_000.avif` exists
- **WHEN** the caller `GET /api/stories/my-series/my-story/images/ch01_000.avif` with a valid passphrase
- **THEN** the response status is `200`, `Content-Type` is `image/avif`, and `X-Content-Type-Options` is `nosniff`

#### Scenario: PNG response carries nosniff

- **GIVEN** `playground/my-series/my-story/_images/ch01_001.png` exists
- **WHEN** the caller `GET /api/stories/my-series/my-story/images/ch01_001.png` with a valid passphrase
- **THEN** the response includes `X-Content-Type-Options: nosniff`

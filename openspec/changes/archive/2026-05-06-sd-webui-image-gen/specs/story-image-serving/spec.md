# story-image-serving

> New capability added by change `sd-webui-image-gen`

## ADDED Requirements

### Requirement: Story image serving route

The server SHALL expose `GET /api/stories/:series/:story/images/:filename` to serve generated story images. The route SHALL be protected by passphrase authentication middleware.

- The file SHALL be served from `PLAYGROUND_DIR/<series>/<story>/_images/<filename>`.
- **Path traversal protection:** The `filename` parameter MUST match the pattern `^[\w\-\.]+$` (alphanumeric characters, hyphens, underscores, and dots only). Requests with filenames containing any other characters SHALL be rejected with 400.
- **Content-Type:** SHALL be inferred from the file extension:
  - `.avif` → `image/avif`
  - `.webp` → `image/webp`
  - `.png` → `image/png`
  - `.jpg` / `.jpeg` → `image/jpeg`
- **Caching:** The response SHALL include `Cache-Control: public, max-age=31536000, immutable`.
- The server SHALL return 404 if the file does not exist.
- The server SHALL return 400 if the filename contains invalid characters.

#### Scenario: Image served successfully with correct content-type

- **GIVEN** a generated image `ch01_000.avif` exists at `PLAYGROUND_DIR/my-series/my-story/_images/ch01_000.avif`
- **WHEN** a client sends `GET /api/stories/my-series/my-story/images/ch01_000.avif` with a valid passphrase
- **THEN** the server SHALL respond with 200, `Content-Type: image/avif`, `Cache-Control: public, max-age=31536000, immutable`, and the binary file content

#### Scenario: Image request with path traversal rejected (400)

- **WHEN** a client sends `GET /api/stories/my-series/my-story/images/../../etc/passwd`
- **THEN** the server SHALL respond with 400

#### Scenario: Non-existent image returns 404

- **GIVEN** no file exists at the resolved path
- **WHEN** a client sends `GET /api/stories/my-series/my-story/images/missing.png` with a valid passphrase
- **THEN** the server SHALL respond with 404

#### Scenario: Both endpoints require passphrase

- **WHEN** a client sends `GET /api/stories/:series/:story/images/:filename` without a valid passphrase
- **THEN** the server SHALL respond with 401

### Requirement: Image metadata API

The server SHALL expose `GET /api/stories/:series/:story/image-metadata?chapter=<N>` to return metadata about generated images for a specific chapter. The route SHALL be protected by passphrase authentication middleware.

- The response SHALL have the format: `{ images: [{ index, title, filename, prompt, nlPrompt, status, width, height }] }`
- Metadata SHALL be read from `PLAYGROUND_DIR/<series>/<story>/_images/_metadata.json`.
- The `status` field SHALL be one of: `"generating"`, `"ready"`, `"failed"`.
- The server SHALL return `{ images: [] }` if the metadata file does not exist.
- The `chapter` query parameter is required and SHALL be an integer.

#### Scenario: Metadata returns empty array when no images generated

- **GIVEN** no `_metadata.json` file exists for the story
- **WHEN** a client sends `GET /api/stories/my-series/my-story/image-metadata?chapter=1` with a valid passphrase
- **THEN** the server SHALL respond with 200 and `{ "images": [] }`

#### Scenario: Metadata returns image list with status for specific chapter

- **GIVEN** `_metadata.json` contains entries for chapter 1 with various statuses
- **WHEN** a client sends `GET /api/stories/my-series/my-story/image-metadata?chapter=1` with a valid passphrase
- **THEN** the server SHALL respond with 200 and a JSON body containing the image entries for chapter 1

#### Scenario: Metadata filters by chapter number

- **GIVEN** `_metadata.json` contains entries for chapters 1 and 2
- **WHEN** a client sends `GET /api/stories/my-series/my-story/image-metadata?chapter=2`
- **THEN** the server SHALL respond with only the images belonging to chapter 2

#### Scenario: Both endpoints require passphrase

- **WHEN** a client sends `GET /api/stories/:series/:story/image-metadata?chapter=1` without a valid passphrase
- **THEN** the server SHALL respond with 401

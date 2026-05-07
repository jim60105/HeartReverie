## Why

Plugins using `URL.createObjectURL()` (e.g., sd-webui-image-gen for image thumbnails) produce `blob:` URLs that were blocked by the CSP `img-src 'self' data:` directive. Images fetched via authenticated API calls and converted to object URLs failed to display in the reader.

## What Changes

- Add `blob:` to the `img-src` directive in the Content-Security-Policy meta tag in `reader-src/index.html`.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `security-headers`: CSP `img-src` directive SHALL include `blob:` to allow plugins to display images created via `URL.createObjectURL()`.

## Impact

- `reader-src/index.html` — CSP meta tag updated (already committed in 778a55b).
- No API or dependency changes.
- No backward compatibility concerns (pre-release project).

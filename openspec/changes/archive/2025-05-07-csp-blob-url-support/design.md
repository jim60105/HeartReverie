## Context

The reader SPA's Content-Security-Policy meta tag restricts `img-src` to `'self' data:`. Plugins that fetch images via authenticated API calls and convert them to in-memory blob URLs using `URL.createObjectURL()` are blocked from displaying those images.

## Goals / Non-Goals

**Goals:**
- Allow plugins to display images created via `URL.createObjectURL()` without CSP violations.

**Non-Goals:**
- Relaxing any other CSP directive.
- Allowing arbitrary remote image sources.

## Decisions

**Add `blob:` to `img-src` in the CSP meta tag.**

Rationale: Plugins (e.g., sd-webui-image-gen) fetch images through the same-origin authenticated API, decode the response in JavaScript, and create object URLs for efficient display. Allowing `blob:` in `img-src` is low risk because it is limited to image loads, blob URLs are origin-bound, and `data:` images (which carry equivalent risk) are already allowed. Plugins should revoke object URLs via `URL.revokeObjectURL()` when no longer needed to avoid memory leaks.

Alternative considered: Using `data:` URLs (base64-encoded image in `src` attribute) — rejected because `data:` URLs copy the entire image payload into the DOM attribute string, consuming significantly more memory than blob URLs which are efficient memory references managed by the browser's garbage collector.

## Risks / Trade-offs

- **Minimal risk**: `blob:` URLs are origin-scoped by the browser; they cannot reference cross-origin content. The existing `data:` allowance in `img-src` already permits embedding arbitrary image bytes — `blob:` adds no new capability an attacker didn't already have via `data:`.

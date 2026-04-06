## Why

Browser console shows three errors/warnings after the security hardening commit: a CSP violation blocking DOMPurify source map fetch, a DOM warning about password field not in a form, and a NotFoundError crash when restoring a stale FSA directory handle. These degrade developer experience and indicate missing error handling.

## What Changes

- Add `https://cdn.jsdelivr.net` to CSP `connect-src` directive so DOMPurify source map loads without violation
- Wrap passphrase input in a `<form>` element to satisfy browser password-field requirements
- Add try/catch around `handleDirectorySelected` in `tryRestoreSession` to gracefully handle stale/deleted directory handles

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `security-headers`: Add jsdelivr.net to `connect-src` CSP directive
- `passphrase-gate`: Wrap password input in a `<form>` element
- `chapter-navigation`: Handle NotFoundError when restoring stale directory handle

## Impact

- `reader/index.html`: CSP meta tag update, passphrase overlay HTML restructure
- `reader/js/chapter-nav.js`: try/catch in `tryRestoreSession`

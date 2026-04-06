## Context

The security hardening commit introduced CSP headers and DOMPurify but left three console issues: a CSP `connect-src` violation for source maps, a DOM warning for an unwrapped password field, and an unhandled `NotFoundError` when a previously-saved FSA directory handle becomes stale.

## Goals / Non-Goals

**Goals:**
- Eliminate all three browser console errors/warnings
- Maintain existing security posture (CSP, DOMPurify, passphrase gate)

**Non-Goals:**
- Fixing font DNS resolution errors (network-side, not code)
- Changing source map behavior or DOMPurify version

## Decisions

1. **CSP connect-src**: Add `https://cdn.jsdelivr.net` to allow source map fetches. This is the same origin already trusted in `script-src`, so no security weakening.

2. **Password form wrapper**: Wrap the passphrase `<input>` and submit button in a `<form>` element with `submit` event handler. This satisfies browser password manager integration and removes the DOM warning. Use `event.preventDefault()` to prevent actual form submission.

3. **Stale FSA handle**: Wrap `handleDirectorySelected(restored)` in `tryRestoreSession()` with a try/catch. On `NotFoundError`, silently clear the saved handle from IndexedDB so the stale entry doesn't persist.

## Risks / Trade-offs

- Adding `cdn.jsdelivr.net` to `connect-src` allows fetch/XHR to that origin — acceptable since we already trust it for scripts.
- Wrapping in `<form>` may trigger password manager save prompts — this is actually desirable UX for the passphrase gate.

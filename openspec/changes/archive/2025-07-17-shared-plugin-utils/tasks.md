## 1. Shared Utility Module

- [x] 1.1 Create `plugins/_shared/utils.js` with `escapeHtml` exported as a named ES module export
- [x] 1.2 Verify `escapeHtml` escapes `&`, `<`, `>`, `"`, `'` to HTML entities (matches existing implementations)

## 2. Backend Serving Route

- [x] 2.1 Add route in `writer/routes/plugins.ts` to serve `.js` files from `plugins/_shared/` at `/plugins/_shared/*`
- [x] 2.2 Apply path containment check (resolved path must start with `_shared` directory prefix)
- [x] 2.3 Restrict to `.js` extension only — reject non-JS requests with 404
- [x] 2.4 Add test for serving shared utility module (200 + correct content-type)
- [x] 2.5 Add test for path traversal rejection (404)
- [x] 2.6 Add test for non-JS file rejection (404)

## 3. Plugin Migration

- [x] 3.1 Update `plugins/status/frontend.js` — replace inline `escapeHtml` with import from `../_shared/utils.js`
- [x] 3.2 Update `plugins/thinking/frontend.js` — replace inline `escapeHtml` with import from `../_shared/utils.js`
- [x] 3.3 Update `plugins/state-patches/frontend.js` — replace inline `escapeHtml` with import from `../_shared/utils.js`
- [x] 3.4 Update `plugins/options/frontend.js` — replace inline `escapeHtml` with import from `../_shared/utils.js`

## 4. Verification

- [x] 4.1 Run existing backend tests — all pass
- [x] 4.2 Run existing frontend tests — all pass
- [x] 4.3 Verify build succeeds
- [x] 4.4 Confirm no remaining inline `escapeHtml` definitions in `plugins/*/frontend.js`

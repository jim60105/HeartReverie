## Why

A four-agent security audit (`audit-reader-card`, `audit-chain-webshell`, `audit-core-api`, `audit-plugins`) targeting file-upload / web-shell vectors uncovered defense-in-depth gaps and one Medium finding (`F-1`: lore template GET accepts arbitrary file extensions and depth — an arbitrary-write primitive under `playground/_lore/`). The audit also recommended a manifest-driven allowlist on the wildcard `GET /plugins/:plugin/:path{.+\.js}` route so a stray `.js` accidentally landing inside a plugin directory cannot be served as executable code, and a `nosniff` header on image responses to neutralise polyglot bytes.

These mitigations were shipped in commit `6f765c0` (engine) but the **spec was never updated** — the security model now exists in code without a written contract. This change codifies the model so future contributors cannot regress it accidentally, and so cross-cutting properties (lore must be `.md`, plugin fragments must not be script-y, served `.js` must be declared) are testable from the specs.

## What Changes

- Introduce a new capability `plugin-asset-allowlist` that owns the HTTP contract of the wildcard `.js` route: only assets declared by the manifest (either as `frontendModule` or in the new `frontendImports` list) may be served as `application/javascript`; everything else is `404`.
- Extend the **plugin manifest schema** with an optional `frontendImports: readonly string[]` field declaring sibling `.js` modules that the frontend module statically imports. Loader-side validator rejects entries that are not `.js`, are absolute, contain `..`, contain `\` / `#` / `?` / `%`, have a dotfile segment, are missing on disk, are directories, or are symlinks pointing outside the plugin directory.
- Tighten the **lore template path** at `GET /api/templates/source` and `parseTemplatePath`: lore paths SHALL end in `.md`, SHALL NOT contain empty segments, and SHALL NOT contain dotfile segments at any depth. Closes audit-core F-1 (arbitrary-extension write under `_lore/`).
- Tighten the **plugin-fragment template path** in `resolveTemplatePath`: forbidden extensions are `.js`, `.mjs`, `.cjs`, `.html`, `.htm`, `.svg`, plus any dotfile segment. Closes audit-chain-webshell defense-in-depth recommendation (b).
- Add `X-Content-Type-Options: nosniff` to image responses served from `GET /api/images/*` so a polyglot image that survives the upload path cannot be sniffed as text/html or script by the browser.
- Reject literal `\` in the request path for the wildcard `.js` route to prevent a normalization mismatch on POSIX (allowlist comparison normalizes `\` → `/`, but `Deno.realPath` does not).

## Capabilities

### New Capabilities

- `plugin-asset-allowlist`: the HTTP contract that governs which plugin assets may be served as executable `.js`, including manifest-declared allowlist, path-normalization rules, dotfile rejection, and symlink containment. Owns the wildcard `GET /plugins/:plugin/:path{.+\.js}` route.

### Modified Capabilities

- `plugin-core`: add optional `frontendImports: readonly string[]` field to the manifest schema; specify its loader-side validation rules and how it composes with `frontendModule` to form the per-plugin asset allowlist consumed by `plugin-asset-allowlist`.
- `template-editor`: add lore-path constraints (`.md` only, no empty segments, no dotfile segments) and plugin-fragment forbidden-extension list (`.js`/`.mjs`/`.cjs`/`.html`/`.htm`/`.svg` + dotfiles) to the existing path-safety requirement set.
- `story-image-serving`: require `X-Content-Type-Options: nosniff` on every successful image response.

## Impact

- **Code already implementing the change** (so the proposal is *codification*, not new work): `writer/types/plugin.ts`, `writer/lib/plugin-loader.ts`, `writer/lib/plugin-manager.ts`, `writer/lib/plugin-validators.ts`, `writer/lib/plugin-validators-frontend-imports.ts` (new), `writer/routes/plugins.ts`, `writer/routes/templates-path.ts`, `writer/routes/images.ts`, `tests/writer/lib/plugin-validators-frontend-imports_test.ts` (new), `tests/writer/routes/plugins_test.ts`. Shipped as commit `6f765c0`.
- **Manifest authors**: plugins that ship a `frontend.js` only need no change. Plugins whose frontend module statically imports siblings SHALL declare those siblings in `manifest.frontendImports`. The repo's `HeartReverie_Plugins/sd-webui-image-gen/plugin.json` was updated accordingly.
- **No backward compatibility burden**: the project is pre-release with zero external users; manifests can change shape freely.
- **API surface**: no new public endpoints; only behavioural tightening on `GET /api/templates/source`, `GET /plugins/:plugin/:path{.+\.js}`, and `GET /api/images/*`.
- **Tests**: 15 new unit tests for the import validator, 1 new regression test for the route allowlist gate, 3 adjusted tests to match the manifest-driven allowlist.

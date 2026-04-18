# Design: Plugin CSS Injection

## Context

The HeartReverie plugin system currently supports three interaction layers that influence frontend display: prompt injection, tag stripping, and a `frontendModule` JavaScript module served from `/plugins/<name>/frontend.js`. Plugin modules register hooks (e.g., `frontend-render`) that transform extracted XML blocks into HTML components before DOMPurify sanitization.

However, **styling for plugin-rendered HTML is currently hardcoded** in `reader-src/src/styles/base.css`. Specifically, the CSS for the `status` and `options` plugins (panels, buttons, layout, ~250 lines combined) lives in the core frontend bundle even though those plugins are maintained as external modules under `HeartReverie_Plugins/`. This creates a distribution problem:

- A plugin cannot ship its own look-and-feel; the core app must be rebuilt whenever a plugin's UI changes.
- External plugins cannot define new visual components without forking `base.css`.
- The coupling violates the manifest-driven, self-contained plugin boundary that `frontendModule` already establishes.

**Current plumbing worth reusing**:
- `writer/routes/plugins.ts` serves `/plugins/<name>/frontend.js` after validating the plugin name and resolving paths through `safePath()` / `isPathContained()`.
- `GET /api/plugins` returns descriptors including `hasFrontendModule`, `displayStripTags`, etc.
- `usePlugins.ts` (frontend composable) already iterates the descriptor list and dynamically `import()`s each frontend module.
- `PluginManifest` in `writer/types.ts` is the single source of truth for manifest shape and is validated by `plugin-manager.ts`.

**Constraints**:
- Pre-release project, 0 users — no backward compatibility required.
- Must preserve existing security posture: path traversal prevention, CSP compatibility, timing-safe boundaries around the plugin directory.
- No new runtime dependencies; Vue 3 + Vite + Hono/Deno stack only.
- CSP currently allows `style-src 'self'` via SRI-hashed `<meta>` tag; any mechanism must stay within this policy.

**Auth note**: The `/plugins/*` namespace is served without requiring authentication (same as existing `frontend.js` and `_shared/utils.js` serving). This is intentional: `<link>` elements cannot send custom headers, and plugin CSS is non-sensitive static content. The route is registered before the auth middleware in `writer/app.ts`.

## Goals / Non-Goals

### Goals

1. Allow a plugin to declare one or more stylesheet files in `plugin.json` via a new `frontendStyles` field.
2. Serve plugin CSS files through the existing plugin route pattern, reusing path validation.
3. Inject plugin CSS into the document at frontend bootstrap time, alongside `frontendModule` loading.
4. Relocate `status` and `options` panel CSS out of `reader-src/src/styles/base.css` into the respective external plugin directories.
5. Preserve graceful degradation: a failed CSS load must not block plugin JS loading or break the page.
6. Keep the core frontend unaware of which plugins exist — discovery remains manifest-driven.

### Non-Goals

- CSS scoping/isolation (Shadow DOM, CSS Modules): plugins continue to share the global cascade; naming discipline is the plugin author's responsibility.
- Hot reload of CSS during a session: stylesheets load once per page load, matching how `frontendModule` loads today.
- Dynamic CSS generation (templated or variable-driven stylesheets on the backend).
- A theming or CSS-variable API for cross-plugin coordination.
- Backward compatibility with manifests that omit `frontendStyles` needing migration tooling — missing field simply means no CSS, same as today.
- Bundling or minifying plugin CSS.

## Decisions

### 1. Manifest field: array of relative paths

**Decision**: Add `frontendStyles?: string[]` to `PluginManifest`. Each entry is a path relative to the plugin root, e.g. `["styles/panel.css", "styles/buttons.css"]`.

**Rationale**:
- An array (vs. single string) naturally supports plugins that want to split stylesheets (e.g., base + theme overrides) without forcing concatenation at author time.
- Mirrors the precedent set by `promptFragments` (object of paths) and `displayStripTags` (array) — authors already work with arrays in manifests.
- Optional field keeps the change additive; plugins without CSS simply omit it.
- Keeping it a plain string array (vs. objects with `{ path, media }`) avoids premature generality; media queries can live inside the CSS itself.

Validation in `plugin-manager.ts` must reject: non-array values, non-string entries, absolute paths, paths containing `..`, paths not ending in `.css`, and paths that resolve outside the plugin directory (reusing `isPathContained()`).

### 2. Serving: extend the existing `/plugins/<name>/...` route

**Decision**: Generalize the current `/plugins/:name/frontend.js` handler in `writer/routes/plugins.ts` into `/plugins/:name/*` that serves any whitelisted static file from the plugin directory, with content-type inferred from extension. Only files declared in the plugin's manifest (`frontendModule` entry + `frontendStyles` entries) are eligible.

**Rationale**:
- Reuses proven path validation (`safePath()`, `isPathContained()`, `isValidPluginName()`).
- Whitelist-via-manifest prevents the route from becoming a general static-file server into the plugin directory — only declared assets are reachable.
- Single route keeps the API surface small; the `GET /api/plugins` descriptor tells the client exactly which URLs are valid.
- Alternative considered: a dedicated `/plugins/:name/styles/:path` route. Rejected because it bifurcates a clearly unified concept ("plugin-owned static assets") and duplicates validation logic.

The `GET /api/plugins` descriptor gains a `frontendStyles: string[]` field that echoes the manifest (pre-resolved to full URL paths like `/plugins/status/styles/panel.css`), so the frontend never has to construct URLs.

### 3. Injection: `<link rel="stylesheet">` appended to `<head>`

**Decision**: For each URL in `descriptor.frontendStyles`, create a `<link rel="stylesheet" href="...">` element and append it to `document.head` inside `usePlugins.ts`, *before* importing the plugin's `frontendModule`.

**Rationale considered**:

| Option | Pros | Cons |
|---|---|---|
| `<link>` tag | Browser-native caching, parallel fetch, respects HTTP caching headers, works with devtools CSS editing, no CORS issues for same-origin | Global cascade (acceptable per Non-Goals) |
| Inline `<style>` via `fetch()` | Full control over ordering | Defeats HTTP cache, larger DOM, blocks on JS fetch, loses devtools source mapping |
| `CSSStyleSheet` + `adoptedStyleSheets` | Modern, deduplicatable | Requires `fetch()` + `replaceSync`, same cache downsides, inconsistent browser devtools UX, overkill without Shadow DOM |

`<link>` wins on simplicity, caching, and debuggability. The global-cascade drawback is already a property of the existing `base.css` extraction we're performing.

### 4. Load failure handling: listen, log silently, continue

**Decision**: Attach an `onerror` handler to each injected `<link>` that removes the failed node from the DOM. Plugin JS loading is not gated on CSS success — `frontendModule` `import()` proceeds regardless.

**Rationale**:
- Matches the existing frontend convention of silent error handling ("graceful degradation, no `console.error`" per AGENTS.md).
- A missing stylesheet produces degraded visuals, not broken functionality — consistent with how the app already treats non-critical assets.
- Decoupling CSS success from JS loading mirrors the browser's own resource model: `<script>` and `<link>` failures are independent.

The `frontend-render` hook remains responsible for producing semantic HTML with class names; if CSS fails, the plugin's output is still rendered, just unstyled.

### 5. Ordering and cascade

**Decision**: Inject plugin `<link>` elements **after** the core app's stylesheets (which Vite emits in `<head>` at build time). Within plugin CSS, honor the order returned by the `GET /api/plugins` endpoint, which follows `PluginManager`'s load order (alphabetical by directory, matching hook priority conventions).

**Rationale**:
- Placing plugin CSS after core CSS lets plugins override core defaults without `!important`, which is the natural expectation when a plugin ships its own panel styles.
- Deterministic order (alphabetical) prevents surprising cascade flips between deploys.
- Plugins that need to override another plugin can rename their directory to sort later, or use more specific selectors. If cross-plugin overrides become common we can revisit with an explicit `cssPriority` field, but YAGNI for now.

### 6. Relocation of existing CSS

**Decision**: Extract status-panel and options-panel rules from `reader-src/src/styles/base.css` and move them verbatim into `HeartReverie_Plugins/status/styles/` and `HeartReverie_Plugins/options/styles/` respectively, then add `frontendStyles` entries to each plugin's `plugin.json`. Delete the relocated rules from `base.css` in the same change.

**Rationale**:
- The extraction is mechanical; no selector rewrites are needed because plugins already render using the same class names the core CSS targeted.
- Doing the move in the same change validates the new mechanism end-to-end and prevents a zombie state where the feature exists but is unused.
- The pre-release-zero-users property means we can delete from `base.css` without a deprecation path.

### 7. Path normalization and deduplication

**Decision**: Normalize `frontendStyles` entries at manifest-load time: strip leading `./`, resolve against plugin root, deduplicate by resolved path. The validated and normalized array is stored once; serving and API responses use the canonical form.

**Rationale**:
- Prevents confusion from `["./styles.css", "styles.css"]` producing duplicate `<link>` elements.
- Single normalization point (at load) avoids repeated work at serve time.
- Follows the same approach used for `promptFragments` path resolution.

## Risks / Trade-offs

### Global cascade leakage
**Risk**: A plugin's rules can unintentionally affect core or sibling-plugin DOM.
**Mitigation**: Establish a naming convention in `docs/plugin-system.md` — plugins should prefix class names with their plugin directory name (e.g., `.status-panel__row`). Shadow DOM remains an option if leakage becomes a real problem.

### FOUC (flash of unstyled content)
**Risk**: Because `<link>` elements are injected at runtime (after initial HTML paints), plugin-rendered HTML may briefly appear unstyled.
**Mitigation**: Inject `<link>` tags as early as possible in `usePlugins.ts` — before dynamic `import()` of `frontendModule`, ideally at the start of the bootstrap phase. In practice, the plugin's HTML is only produced by the `frontend-render` hook *after* the module loads, so the stylesheet almost always arrives first. This is the same ordering guarantee the current hardcoded CSS enjoys because it's part of the initial bundle; a brief FOUC at first paint on cold caches is accepted as a trade-off for decoupling.

### CSP / SRI drift
**Risk**: The current `<meta>` CSP declares `style-src 'self'` with SRI hashes for the build-time stylesheet. Dynamically injected `<link>` elements to same-origin URLs are permitted by `style-src 'self'` without SRI (SRI is only required when present), so no CSP change is needed.
**Mitigation**: Document this in `docs/security.md` (or equivalent) and verify with a manual CSP check after implementation.

### Increased attack surface on the plugin route
**Risk**: Generalizing `/plugins/:name/*` could inadvertently expose plugin-directory files beyond the intended assets.
**Mitigation**: Enforce a strict whitelist derived from `manifest.frontendModule` + `manifest.frontendStyles`. Any request path not present in that whitelist returns 404. Path validation (`safePath`, `isPathContained`, no `..`) is unchanged. Content-type is derived from extension via a small allowlist map (`.js`, `.mjs`, `.css`) — unknown extensions are rejected.

### HTTP caching and plugin updates
**Risk**: Browsers may cache old plugin CSS after an update.
**Mitigation**: This risk already exists for `frontend.js`; no regression. If needed later, the `/api/plugins` descriptor can append a version or mtime query string to each URL. Out of scope for this change.

### Test coverage
**Risk**: New route branch + new manifest field + frontend injection logic needs tests.
**Mitigation**:
- Backend: extend `tests/writer/routes/plugins_test.ts` (or equivalent) with cases for (a) declared CSS path served with `text/css`, (b) undeclared path 404, (c) path traversal rejected, (d) non-CSS extension rejected.
- Backend: extend `plugin-manager` tests for manifest validation (valid array, empty array, absolute path rejected, `..` rejected, non-string entry rejected).
- Frontend: Vitest coverage in `usePlugins` for (a) `<link>` elements created per descriptor entry, (b) failure handler removes node, (c) injection order relative to module import.

### Plugin CSS depends on core CSS variables
**Risk**: Relocated plugin CSS uses CSS custom properties (e.g., `var(--border-color)`, `var(--panel-bg)`) defined in core `theme.css`.
**Mitigation**: This is an intentional and supported dependency. Core CSS variables are stable API surface. Document in `docs/plugin-system.md` that plugins may use core CSS custom properties, and list the available tokens.

## Context

The HeartReverie engine serves plugin assets through two HTTP routes mounted on the writer backend:
- `GET /plugins/:plugin/:path{.+\.js}` — a wildcard that previously returned **any** `.js` file inside a plugin directory after dotfile/containment checks.
- `GET /api/templates/source?templatePath=<path>` and `parseTemplatePath()` — accepts paths in the form `system.md`, `plugin:<name>:<rel>`, or `lore:<scope>[:<series>[:<story>]]:<rel>`. The lore branch previously accepted any extension and arbitrary directory depth; the plugin-fragment branch accepted any extension as long as the resolved file lived under the plugin directory.
- `GET /api/images/*` — serves story images (AVIF / WebP / PNG / JPEG / SVG).

A typescript-security + api-security audit (four parallel agents, focused on file-upload / web-shell vectors) reported:
- `audit-chain-webshell`: not exploitable today, but two structural recommendations — manifest-driven allowlist on the wildcard `.js` route, and a `.js` reject in the plugin-fragment branch.
- `audit-core-api` F-1 (Medium): lore template GET endpoint is a primitive for arbitrary writes under `playground/_lore/` because it lacks extension/depth constraints.
- `audit-plugins` defense-in-depth: image responses should carry `X-Content-Type-Options: nosniff`.

The fixes were already shipped in commit `6f765c0` (engine) and `7ec0fb3` (plugins). This design document explains the architecture that the code now reflects so the specs can codify it.

## Goals / Non-Goals

**Goals:**
- Make "which `.js` may be served from a plugin directory" a property declared in the plugin manifest, not inferred from disk contents.
- Make "which extensions may be written to lore" a property enforced at the path parser, not at the FS-write layer.
- Keep the security model linear and verifiable: every security check has a single responsible function (`validateFrontendImports`, `parseTemplatePath`, `resolveTemplatePath`, `getPluginAllowedJsFiles`).
- Preserve the SPA's ability to statically import sibling JS modules (the current `sd-webui-image-gen` plugin does this).

**Non-Goals:**
- SSRF mitigation for outgoing plugin requests — that is a plugin-side concern, owned by a separate proposal in `HeartReverie_Plugins/`.
- Disk-quota and per-field caps on the card parser — defense-in-depth, low ROI, deferred.
- CSP changes — the existing `security-headers` capability already constrains script sources; this change does not modify it.
- Removing SVG support — `nosniff` is sufficient mitigation; rendering SVGs inline remains a Vue concern.

## Decisions

### 1. Allowlist source: manifest, not directory scan

**Decision:** The set of `.js` files a plugin may serve over HTTP is the union of (a) `manifest.frontendModule` normalized and (b) the new `manifest.frontendImports[]` entries normalized.

**Rationale:** Directory scan was the pre-fix behaviour and it makes "land an arbitrary file inside the plugin dir → it's now executable JS" a single-step compromise. Manifest declaration creates an explicit author-controlled allowlist that survives accidental file drops, build artefacts, or attacker-controlled writes that breach an earlier defence.

**Alternatives considered:**
- *Static analysis of the frontend module to discover its imports* — fragile, requires a JS parser at server load, and lets the attacker influence the allowlist by modifying the frontend module.
- *Single-file plugins (no sibling imports)* — would force `sd-webui-image-gen` to inline its lightbox helper into `frontend.js`, increasing parse cost in the SPA and reducing modularity.

### 2. Normalization is performed identically on both sides

**Decision:** `getPluginAllowedJsFiles()` and the route both apply the same normalization: strip leading `./` repeatedly. The route additionally **rejects** any path containing `\` outright.

**Rationale:** Earlier rubber-duck review of the implementation noticed that translating `\` → `/` in the request path for allowlist comparison without applying the same translation to the `Deno.realPath` lookup created a theoretical bypass on POSIX (a request for `dir%5Chelper.js` would normalize to `dir/helper.js` for the allowlist check but resolve as the literal filename `dir\helper.js`). Rejecting `\` outright is simpler and never had a legitimate use case (the manifest validator already rejects `\` in entries).

**Alternatives considered:**
- *Normalize symmetrically on both sides (translate `\` → `/` everywhere)*: requires confidence that Deno's path resolver treats `\` as a separator on POSIX, which it does not; would silently change file lookups.

### 3. Lore is `.md`-only at the parser, not at the FS layer

**Decision:** `parseTemplatePath()` rejects lore paths that do not end in `.md`, that contain empty segments, or that contain dotfile segments at any depth.

**Rationale:** This is the earliest point where the path becomes a typed lore identifier; rejecting here means every downstream consumer (read, write, preview, lint) gets the constraint for free. Pushing the check to FS write would still let read endpoints expose other-extension files for the duration of the regression.

**Alternatives considered:**
- *Validate at `PUT /api/templates`*: misses the GET surface (which was the audit's actual primitive).
- *Whitelist `.md` only at the route handler*: scatters the check across three handlers (`GET`, `PUT`, `POST /preview`), inviting drift.

### 4. Plugin-fragment extension policy is a *deny-list*, not an allow-list

**Decision:** `resolveTemplatePath()` rejects `.js`, `.mjs`, `.cjs`, `.html`, `.htm`, `.svg`, and dotfile segments for plugin-fragment paths. Other extensions remain allowed (Vento templates use a variety of suffixes including `.vento`, `.md`, `.txt`).

**Rationale:** The plugin-fragment surface is already 403-gated at `PUT`; the audit recommendation was structural defense-in-depth. A deny-list is sufficient there and keeps the door open for plugin authors who legitimately ship `.vento` or `.txt` fragments.

**Alternatives considered:**
- *Allow-list of `.md` / `.vento` / `.txt`*: would break any current plugin shipping a fragment with a different extension (none today, but the manifest format does not constrain this) and is more change than the audit recommended.

### 5. `nosniff` lives on every image response, not on a global middleware

**Decision:** `X-Content-Type-Options: nosniff` is added in `writer/routes/images.ts` directly on each successful response object.

**Rationale:** A global middleware would also touch unrelated routes; a route-local header keeps the change scoped to the threat model (polyglot image bytes). Adding it elsewhere (HTML, JSON, JS) is either redundant (the existing `Content-Type` is already correct) or unwanted (the SPA's `index.html` deliberately serves as `text/html`).

## Risks / Trade-offs

- **Risk**: An existing third-party plugin that statically imports a sibling `.js` will 404 after the upgrade. **Mitigation:** zero users today; for future authors, the wildcard route returns a clear 404 and the validator logs a `WARN` for any non-conforming `frontendImports` entry on load. The plugin-authoring skill (`heartreverie-create-plugin`) is the next place to document the new field.
- **Risk**: An existing lore file with a non-`.md` extension (e.g. `_lore/foo.markdown`) becomes invisible. **Mitigation:** the lore-storage spec already requires `.md` ([`openspec/specs/lore-storage/spec.md:8`](../../specs/lore-storage/spec.md)); this change merely enforces what the storage spec already says.
- **Risk**: PNG metadata (A1111 generation parameters in `tEXt`/`iTXt` chunks) is dropped on PNG output by the plugin. **Mitigation:** covered by the plugin-side proposal; for the engine it is not in scope.
- **Trade-off**: Strict normalization (reject `\`) is more restrictive than necessary for POSIX clients but eliminates a class of bypass on case-insensitive or mixed filesystems. Pre-release stage justifies the tighter contract.

## Migration Plan

No data migration is required. The change is purely additive at the manifest level (`frontendImports` is optional and defaults to `[]`) and behavioural at the route level (existing well-formed plugins continue to work). Deployment steps:

1. Land the engine commit (already done: `6f765c0`).
2. Land the plugin manifest update for `sd-webui-image-gen` (already done: `7ec0fb3`).
3. After this proposal is archived, sync the deltas into the main specs and update `heartreverie-create-plugin` SKILL.md to mention `frontendImports`.

Rollback: revert `6f765c0`. No persisted state changes.

## Open Questions

None. All audit findings in scope of "file upload / web shell" have been addressed; out-of-scope findings (SSRF, symlink in playground, disk quota, SVG XSS) are tracked in either the plugin-side proposal or deferred.

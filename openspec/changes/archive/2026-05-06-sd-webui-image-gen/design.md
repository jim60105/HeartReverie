## Context

HeartReverie is a single-user storytelling application with a Deno + Hono backend (`writer/app.ts`) and a Vue 3 SPA frontend (`reader-src/`). It has a plugin system managed by `writer/lib/plugin-manager.ts`, with persistent data stored under `PLAYGROUND_DIR`.

The upcoming **sd-webui-image-gen** plugin (in HeartReverie_Plugins) needs core infrastructure that doesn't exist yet: plugin settings storage/UI, binary image serving from story directories, and image metadata APIs. This change adds those generic capabilities to the core so the plugin can consume them.

Existing patterns: RESTful API under `/api/*` with passphrase auth middleware, settings page at `/settings/*` with sidebar tabs rendered by `SettingsLayout.vue`, static serving via Hono's `serveStatic`, and a 1 MB body limit on API routes.

## Goals / Non-Goals

### Goals

- Provide a generic plugin settings storage mechanism with schema-driven validation
- Expose a settings UI page that auto-renders forms from JSON Schema declarations
- Serve generated story images securely with proper content-type and caching
- Provide an image metadata API for frontends to discover and poll image generation status
- Remove the legacy `plugins/imgthink/` directory (functionality migrates to the new plugin)
- Increase body limit to handle base64-encoded image payloads from sd-webui

### Non-Goals

- Image editing or img2img workflows (only txt2img in scope)
- Real-time generation progress display (polling metadata is sufficient)
- Multi-user concurrency handling (single-user app assumption)
- Image CDN, compression pipeline, or automatic cleanup
- Plugin-specific UI beyond what JSON Schema can express

## Decisions

### 1. Plugin Settings Storage — `playground/_plugins/<pluginName>/config.json`

Settings are stored in `PLAYGROUND_DIR/_plugins/<pluginName>/config.json`.

**Why playground:** It is the persistent data directory that survives container rebuilds. Plugin settings are user data, not application code.

- Plugins declare a `settingsSchema` field in `plugin.json` using JSON Schema format.
- The server validates `PUT /api/plugins/:name/settings` payloads against the declared schema before writing.
- Default values from the schema are used when `config.json` doesn't exist yet.
- `GET /api/plugins/:name/settings` returns the merged result (defaults + saved values).

### 2. Plugin Settings Page — Schema-Driven Form Rendering

- **Route:** `/settings/plugins/:name`
- **Discovery:** `SettingsLayout.vue` sidebar dynamically lists plugins that declare `settingsSchema` by querying a new `GET /api/plugins?hasSettings=true` endpoint (or embedding the list in an existing response).
- **Rendering:** The page fetches the schema from `GET /api/plugins/:name/settings-schema` and auto-generates form fields:
  - `string` → text input
  - `string` + `enum` → select dropdown
  - `boolean` → checkbox
  - `number` / `integer` → number input
- **Dynamic options:** A custom JSON Schema extension `x-options-url` allows a field to specify a URL from which the frontend fetches select options at render time. This keeps the core generic — the sd-webui plugin uses this to populate model/sampler dropdowns from the sd-webui API without any plugin-specific logic in the core.

### 3. Story Image Serving Route

- **Route:** `GET /api/stories/:series/:story/images/:filename`
- **Auth:** Protected by existing passphrase middleware.
- **Path:** Serves from `PLAYGROUND_DIR/<series>/<story>/_images/<filename>`.
- **Path traversal protection:** Validate that `filename` matches `^[\w\-\.]+$` (no `..`, no `/`).
- **Content-Type:** Inferred from extension — `.avif` → `image/avif`, `.webp` → `image/webp`, `.png` → `image/png`, `.jpg`/`.jpeg` → `image/jpeg`.
- **Caching:** `Cache-Control: public, immutable` — generated images never change once written.
- **404** if file doesn't exist.

### 4. Image Metadata API

- **Route:** `GET /api/stories/:series/:story/image-metadata?chapter=<N>`
- **Response:**
  ```json
  {
    "images": [
      {
        "index": 0,
        "title": "場景描述",
        "filename": "ch01_000.avif",
        "prompt": "masterpiece, ...",
        "nlPrompt": "A serene lakeside...",
        "status": "ready",
        "width": 1024,
        "height": 1024
      }
    ]
  }
  ```
- **Storage:** `PLAYGROUND_DIR/<series>/<story>/_images/_metadata.json` — written by the plugin during generation, read by this API.
- **Status values:** `"generating"` | `"ready"` | `"failed"`
- The frontend polls this endpoint to know when images become available after generation is triggered.

### 5. Body Limit Increase — 1 MB → 10 MB

Increase the `/api/*` body limit from 1 MB to 10 MB.

**Rationale:** sd-webui returns base64-encoded images. A 1024×1024 PNG is typically 2–4 MB in base64. The plugin's generation result callback or settings payloads may carry these.

**Why not per-route limits:** This is a single-user app; the added complexity of route-specific limits isn't justified. A blanket 10 MB is safe here.

### 6. Remove `plugins/imgthink/`

Delete the `plugins/imgthink/` directory entirely. Its sole functionality (`displayStripTags: ["imgthink"]`) is now declared by the new sd-webui-image-gen plugin in HeartReverie_Plugins.

No migration is needed — the project is in early development with zero external users.

## Risks / Trade-offs

| Risk | Severity | Mitigation |
|------|----------|------------|
| Plugin settings lost if playground is wiped | Low | Settings are easily re-configured; not critical data. Could add export/import later. |
| Schema-driven form can't cover all UI needs (e.g., live model dropdowns) | Medium | `x-options-url` extension lets plugins specify dynamic option sources without core changes. |
| Large generated images fill disk over time | Low | Out of scope; future cleanup tooling or per-story limits can address this. |
| Raising body limit to 10 MB could allow large payloads | Low | Single-user app behind passphrase auth; no public exposure. |
| `_metadata.json` could have race conditions if generation and reads overlap | Low | Single-user app with sequential generation; atomic write (write-then-rename) in plugin implementation eliminates partial reads. |

## Context

LLM sampling parameters (model, temperature, penalties, top-k/p, etc.) are currently loaded once from environment variables in `writer/lib/config.ts` as flat module-level constants (`LLM_MODEL`, `LLM_TEMPERATURE`, …) and consumed in `writer/lib/chat-shared.ts::executeChat()` when building the upstream OpenAI-compatible request body. The backend has no notion of per-story settings.

Story data lives under `playground/<series>/<story>/`. The project already uses an underscore-prefix convention for system-reserved files/directories (e.g. `_lore/`, `_prompts/`) and `story.ts` skips these when listing series/stories. The frontend already has a dedicated settings area (`SettingsLayout.vue`) hosting nested routes.

There are zero production users, so no migration or backward-compatibility is required.

## Goals / Non-Goals

**Goals:**
- Allow each story to override any subset of LLM sampling parameters via a file colocated with the story data.
- Keep env-based defaults as the source of truth when a story does not declare an override.
- Provide an authenticated REST API for CRUD on per-story config so the frontend (and future automation) can manage it.
- Surface the settings in the existing Vue settings area without disturbing other panels.

**Non-Goals:**
- Overriding non-LLM configuration (API key, API URL, passphrase, background image, plugin toggles).
- Per-chapter or per-series overrides. Story-level is the only scope.
- Hot-reloading env defaults. The existing behaviour (read once at boot) stays.
- Schema evolution / versioning of `_config.json`. It is a flat partial object today.
- UI for discovering valid `model` identifiers — the field is a free-text string.

## Decisions

### Decision: File format is JSON at `playground/<series>/<story>/_config.json`
JSON keeps parsing trivial (`JSON.parse`), matches other structured data the backend already reads, and avoids adding a YAML dependency just for this file. The `_` prefix slots into the existing system-reserved convention used by `_lore/` and `_prompts/`, so existing listing filters in `writer/lib/story.ts` keep it out of the chapter/story UI for free.

**Alternative considered:** YAML (`_config.yml`) for human-friendliness — rejected because the file is expected to be edited through the UI, not hand-edited, and JSON is already first-class across the codebase.

### Decision: Partial-override semantics via `Object.assign({}, envDefaults, storyOverrides)`
Only fields explicitly present in `_config.json` override env defaults; missing fields fall through. `undefined`/missing and explicit `null` are treated identically as "use default" (the PUT handler normalises by stripping `null` and `undefined` before persisting). This gives a predictable mental model ("only what's in the file counts") and lets the UI implement per-field "use default" as "delete the key".

### Decision: Expose env defaults as a typed object `LlmConfig`
Refactor `writer/lib/config.ts` to (in addition to the existing flat constants) export an `llmDefaults: LlmConfig` object with camelCase field names matching the OpenAI-compatible request body shape (`model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`). `executeChat()` then calls `resolveLlmConfig(series, name)` which returns `Object.assign({}, llmDefaults, storyOverrides)` and builds the request body from the merged object. This removes nine parallel field references in `chat-shared.ts` and centralises mapping to snake_case.

**Alternative considered:** Pass nine individual override parameters — rejected as brittle and noisy at every call site.

### Decision: New library module `writer/lib/story-config.ts`
Keep story-config IO isolated from `story.ts` (which already handles chapter listing and series traversal) to keep modules cohesive. Exposes:
- `readStoryLlmConfig(storyDir): Promise<Partial<LlmConfig>>` — returns `{}` if the file does not exist, throws only on malformed JSON or validation failure.
- `writeStoryLlmConfig(storyDir, partial): Promise<void>` — validates, strips unknown keys and `null`/`undefined`, writes atomically.
- `validateStoryLlmConfig(input): Partial<LlmConfig>` — whitelist-only parser (see security below).

### Decision: Routes live at `GET/PUT /api/:series/:name/config`
Mirrors the existing `/api/:series/:name/...` chapter and lore routes and makes the relationship to a specific story obvious in the URL. The pre-existing global `GET /api/config` (public, serves `backgroundImage`) is untouched; the two namespaces do not collide because the new routes require both `:series` and `:name`. Registered in a new `writer/routes/story-config.ts` and mounted from `writer/app.ts` **behind** the auth and rate-limit middleware (unlike the public `/api/config`).

### Decision: Frontend panel as a new `/settings/llm` child route
`SettingsLayout.vue` already renders a sidebar + `<router-view />` for settings children. Adding one more sidebar entry + lazy-loaded `LlmSettingsPage.vue` keeps the pattern consistent. The page reuses the existing `useStorySelector` composable to pick which story to edit, then loads/edits its config via a new `useStoryLlmConfig` composable. Each numeric/string field renders with a "use default" toggle; toggling off sends a PUT that omits the field.

### Decision: PUT SHALL NOT create the story directory
`PUT /api/:series/:name/config` is a configuration-mutation endpoint, not a story-creation endpoint. The story directory (`playground/<series>/<story>/`) MUST already exist before the request; if it does not, the handler SHALL return HTTP 404 with an RFC 9457 Problem Details body and SHALL NOT create any file or directory. This prevents a "phantom story" failure mode in which `PUT /config` would silently materialise a visible-but-empty story (no chapters) just from a stray config write — story creation remains the exclusive responsibility of chapter creation flows. `writeStoryLlmConfig()` therefore assumes the directory exists and throws a typed not-found error otherwise; the route handler maps that error to 404.

### Decision: Whitelist-only validation
`validateStoryLlmConfig()` ignores unknown keys silently and rejects values of wrong type with a 400 Problem Details response. `model` is a non-empty string; all others are finite numbers. This prevents arbitrary JSON from being persisted and also blocks potential parameter-injection into the upstream LLM API body (e.g. injecting `tools`, `response_format`).

## Risks / Trade-offs

- **[Risk]** Invalid numeric ranges (e.g. `temperature: 99`) may cause the upstream LLM API to reject the request. → **Mitigation**: Validation enforces types only; surface upstream errors through the existing chat error path and rely on authors to tune. Range enforcement can be added later without a schema break.
- **[Risk]** Users may expect the UI to list available model IDs. → **Mitigation**: Out of scope for this change; document the free-text field. A future change can add model discovery.
- **[Risk]** Stale merge if env defaults change after a story config was written. → **Acceptable**: merge happens at request time, not at write time, so env changes immediately affect unspecified fields.
- **[Trade-off]** Adding a new `_config.json` per story increases the surface of system-reserved entries. → **Mitigation**: Reuses the established `_`-prefix convention; `story.ts` filtering already handles this pattern.
- **[Risk]** Path traversal via `:series`/`:name`. → **Mitigation**: Routes go through the existing `safePath()` helper in `writer/lib/story.ts`, same as chapters/lore.

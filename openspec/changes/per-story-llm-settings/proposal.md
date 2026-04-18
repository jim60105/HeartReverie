## Why

All LLM sampling parameters (model, temperature, penalties, top-k/p, etc.) are currently loaded once from environment variables in `writer/lib/config.ts` and applied globally to every story. Different stories benefit from different tuning — e.g., a horror story may want higher `temperature` for creativity while a mystery wants lower `temperature` for consistency — but there is no mechanism to override the global defaults per story. This change introduces per-story LLM configuration so authors can tune generation behaviour without restarting the server or editing `.env`.

## What Changes

- Introduce a per-story configuration file at `playground/<series>/<story>/_config.json` (underscore-prefixed, system-reserved) that stores partial overrides for LLM sampling parameters.
- Add authenticated REST endpoints `GET /api/:series/:name/config` and `PUT /api/:series/:name/config` for reading and writing the per-story config.
- Resolve effective LLM parameters per chat request by merging env defaults with story overrides using `Object.assign({}, envDefaults, storyOverrides)`; only explicitly specified fields override defaults, the rest fall through.
- Extend `executeChat()` in `writer/lib/chat-shared.ts` to load and apply the story's `_config.json` when building the upstream LLM request body.
- Add a new "LLM Settings" panel to the frontend settings area (rendered inside the existing `SettingsLayout.vue`) that lets the user pick a story and edit its LLM overrides, with per-field "use default" toggles.
- Ensure story/series listings continue to exclude underscore-prefixed entries (`_config.json`, `_lore/`, etc.) so the new file does not leak into the chapter UI.

The overridable parameters are exactly: `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`. The API URL, API key, and non-LLM settings remain env-only.

## Capabilities

### New Capabilities
- `per-story-llm-config`: File format, storage layout, merge semantics, REST API, and frontend settings UI for per-story LLM parameter overrides.

### Modified Capabilities
- `writer-backend`: `executeChat()` in `writer/lib/chat-shared.ts` SHALL resolve effective LLM parameters by merging env defaults with the target story's `_config.json` overrides before issuing the upstream LLM request.
- `settings-page`: The settings layout SHALL include a new "LLM Settings" tab that loads and edits per-story LLM overrides through the new API.

## Impact

- **Code**: `writer/lib/config.ts` (extract `LlmConfig` type, expose env defaults as an object), `writer/lib/chat-shared.ts` (merge per-story overrides before building request body), new `writer/lib/story-config.ts` (read/write/validate `_config.json`), new `writer/routes/story-config.ts` (authenticated CRUD routes), `writer/app.ts` (register new routes), `writer/types.ts` (shared `StoryLlmConfig` / `LlmConfig` types).
- **Frontend**: New `LlmSettingsPage.vue` and `useStoryLlmConfig.ts` composable under `reader-src/src/`, new router entry under `/settings/llm`, sidebar link in `SettingsLayout.vue`.
- **APIs**: Adds two new authenticated endpoints under `/api/:series/:name/config` (requires `X-Passphrase`, subject to the existing rate limiter).
- **Storage**: Adds `_config.json` alongside `_lore/` inside each story directory. Reserved filename — story listings must continue to skip underscore-prefixed entries.
- **Tests**: New backend tests for merge semantics, route auth, path safety, and invalid-field rejection; frontend tests for the settings panel.
- **Docs**: Update `AGENTS.md` and relevant docs to describe the new file and endpoints. No backward compatibility needed (0 users).

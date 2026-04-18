## 1. Backend: types and env defaults

- [ ] 1.1 Add `LlmConfig` type (`model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`) and `StoryLlmConfigOverrides = Partial<LlmConfig>` to `writer/types.ts`
- [ ] 1.2 In `writer/lib/config.ts`, assemble and export an `llmDefaults: LlmConfig` object built from the existing env-parsing logic, keeping the flat `LLM_*` constants exported for backward compatibility within the backend
- [ ] 1.3 Update `AppDeps` / `AppConfig` plumbing (if any) so `llmDefaults` is reachable from route handlers and from `executeChat()`

## 2. Backend: per-story config library

- [ ] 2.1 Create `writer/lib/story-config.ts` with `validateStoryLlmConfig(input: unknown): Partial<LlmConfig>` — whitelist-only parser that strips unknown keys, drops `null`/`undefined`, enforces `model` is a non-empty string and other fields are finite numbers, and throws a typed validation error on wrong types
- [ ] 2.2 Implement `readStoryLlmConfig(storyDir: string): Promise<Partial<LlmConfig>>` — returns `{}` when `_config.json` is absent, re-throws on invalid JSON or validation errors
- [ ] 2.3 Implement `writeStoryLlmConfig(storyDir: string, input: unknown): Promise<Partial<LlmConfig>>` — validates, writes `_config.json` atomically (tmp file + rename) with mode `0o664`, returns the persisted object. The story directory MUST already exist; `writeStoryLlmConfig()` SHALL NOT create it. If `storyDir` does not exist, throw a typed not-found error that the route handler maps to HTTP 404 Problem Details.
- [ ] 2.4 Add `resolveStoryLlmConfig(storyDir: string, defaults: LlmConfig): Promise<LlmConfig>` returning `Object.assign({}, defaults, await readStoryLlmConfig(storyDir))`
- [ ] 2.5 Confirm `writer/lib/story.ts` listing helpers already skip underscore-prefixed entries; add a regression test covering a directory containing `_config.json` among chapters

## 3. Backend: wire into chat pipeline

- [ ] 3.1 In `writer/lib/chat-shared.ts::executeChat()`, call `resolveStoryLlmConfig(storyDir, config.llmDefaults)` after `storyDir` is validated
- [ ] 3.2 Replace all flat `config.LLM_*` references in the request body and log sites with fields from the merged `LlmConfig` object (mapping camelCase → snake_case exactly once when building the upstream fetch body)
- [ ] 3.3 If `readStoryLlmConfig` throws, convert it to a `ChatError` that surfaces as a Problem Details response and aborts before any file write

## 4. Backend: REST routes

- [ ] 4.1 Create `writer/routes/story-config.ts` exporting `registerStoryConfigRoutes(app, deps)` that registers `GET /api/:series/:name/config` and `PUT /api/:series/:name/config`
- [ ] 4.2 GET handler: validate `:series`/`:name` via `safePath()`, return `await readStoryLlmConfig(storyDir)` (empty object if absent) as JSON 200
- [ ] 4.3 PUT handler: verify the story directory exists (return HTTP 404 Problem Details if not — do not implicitly create the story), then `c.req.json()`, call `writeStoryLlmConfig(storyDir, body)`, return the persisted object as JSON 200; map validation errors to HTTP 400 Problem Details
- [ ] 4.4 Mount the new routes in `writer/app.ts` behind the existing auth + rate-limit middleware; verify the public `GET /api/config` endpoint is untouched

## 5. Backend tests

- [ ] 5.1 Unit tests for `validateStoryLlmConfig` in `tests/writer/lib/story-config_test.ts` — whitelist strip, wrong-type rejection, empty-string model rejection, null/undefined stripping
- [ ] 5.2 Unit tests for `readStoryLlmConfig` / `writeStoryLlmConfig` — absent file returns `{}`, round-trip, malformed JSON throws, `_config.json` appears in the correct path
- [ ] 5.3 Route tests for `GET`/`PUT /api/:series/:name/config` in `tests/writer/routes/story-config_test.ts` — auth required, path traversal rejected, validated persistence, empty-object PUT clears overrides
- [ ] 5.4 Integration test (or targeted test on `chat-shared`) that a story's `_config.json` temperature override appears in the upstream request body while a chapter listing with `_config.json` still ignores it

## 6. Frontend: API composable

- [ ] 6.1 Add `reader-src/src/composables/useStoryLlmConfig.ts` exposing `loadConfig(series, name)`, `saveConfig(series, name, overrides)`, reactive state (`loading`, `saving`, `error`, `overrides`), using the existing auth-aware fetch wrapper
- [ ] 6.2 Extend `reader-src/src/types/index.ts` with `StoryLlmConfig` matching the backend `Partial<LlmConfig>` shape

## 7. Frontend: settings page

- [ ] 7.1 Create `reader-src/src/components/LlmSettingsPage.vue` — lazy-loaded, uses `useStorySelector` for story picking, renders the nine LLM fields each paired with a "use default" toggle, in Traditional Chinese
- [ ] 7.2 Form logic: initial load sets every toggle ON for missing fields and OFF for present fields; Save payload includes only fields whose toggle is OFF
- [ ] 7.3 Register the route in `reader-src/src/router/index.ts` as a child of `/settings` at path `llm` with `meta: { title: 'LLM 設定' }` — the existing sidebar auto-derives from `meta.title`
- [ ] 7.4 Wire toast notifications for save success and API errors using the existing toast mechanism

## 8. Frontend tests

- [ ] 8.1 Vitest test for `useStoryLlmConfig` covering load / save / error branches with a mocked fetch
- [ ] 8.2 Component test for `LlmSettingsPage.vue` verifying toggle-OFF fields appear in the PUT payload and toggle-ON fields do not

## 9. Documentation

- [ ] 9.1 Update `AGENTS.md` (or the appropriate `docs/` file) with the new `_config.json` convention, the `/api/:series/:name/config` endpoints, and the `/settings/llm` frontend route
- [ ] 9.2 Add a brief note to `CHANGELOG.md` describing the new per-story LLM override feature

## 10. Validation

- [ ] 10.1 Run `deno task test:backend`, `deno task test:frontend`, and `deno task test` to ensure all tests pass
- [ ] 10.2 Manually smoke-test: create a `_config.json` with `{ "temperature": 0.9 }` for a test story, confirm the upstream request body contains `temperature: 0.9` (via `LLM_LOG_FILE` or debug logging), then remove/empty the file and confirm env defaults reapply without a restart
- [ ] 10.3 Run `openspec status --change "per-story-llm-settings"` and confirm all artifacts are `done`

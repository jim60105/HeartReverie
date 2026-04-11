## 1. Rename OpenRouter to LLM in Types and Config

- [x] 1.1 In `writer/types.ts`: rename `OPENROUTER_API_URL` → `LLM_API_URL` and `OPENROUTER_MODEL` → `LLM_MODEL` in `AppConfig` interface; rename `OpenRouterStreamChunk` → `LLMStreamChunk`
- [x] 1.2 In `writer/lib/config.ts`: rename config keys to `LLM_API_URL`, `LLM_MODEL`; change env var reads from `OPENROUTER_MODEL` → `LLM_MODEL`; make `LLM_API_URL` env-configurable with default `https://openrouter.ai/api/v1/chat/completions`
- [x] 1.3 In `writer/lib/config.ts`: add 8 LLM sampling parameter configs parsed from env vars (`LLM_TEMPERATURE`, `LLM_FREQUENCY_PENALTY`, `LLM_PRESENCE_PENALTY`, `LLM_TOP_K`, `LLM_TOP_P`, `LLM_REPETITION_PENALTY`, `LLM_MIN_P`, `LLM_TOP_A`) with `parseFloat()`/fallback-to-default logic; add corresponding fields to `AppConfig`

## 2. Update Chat Route

- [x] 2.1 In `writer/routes/chat.ts`: rename `OPENROUTER_API_KEY` env reads → `LLM_API_KEY`; update import of `OpenRouterStreamChunk` → `LLMStreamChunk`; update all type casts
- [x] 2.2 In `writer/routes/chat.ts`: replace 8 hardcoded sampling parameters with `config.*` references; update API URL to `config.LLM_API_URL`; update model to `config.LLM_MODEL`
- [x] 2.3 In `writer/routes/chat.ts`: update all comments and error messages from "OpenRouter" to "LLM" (log messages, error strings)

## 3. Update Server Startup

- [x] 3.1 In `writer/server.ts`: rename `OPENROUTER_API_KEY` env check → `LLM_API_KEY`; update warning message text

## 4. Update Tests

- [x] 4.1 In `tests/writer/routes/chat_test.ts`: rename all `OPENROUTER_*` references in mock configs, function names, test descriptions, and URL assertions to use `LLM_*` naming

## 5. Create .env.example

- [x] 5.1 Create `.env.example` at project root with all env vars: `LLM_API_KEY`, `LLM_MODEL`, `LLM_API_URL`, 8 sampling params, `PORT`, `PASSPHRASE`, `PLAYGROUND_DIR`, `READER_DIR`, `PLUGIN_DIR`; include comments and defaults

## 6. Update Gitignore Files

- [x] 6.1 Create `plugins/state-patches/rust/.gitignore` with stock Rust/Cargo patterns
- [x] 6.2 Update root `.gitignore`: add stock Deno patterns, remove `plugins/state-patches/rust/target/` line (now covered by nested gitignore)

## 7. Update Documentation

- [x] 7.1 Update `AGENTS.md`: rename env var references from `OPENROUTER_*` to `LLM_*`; update env var table; mention `.env.example`
- [x] 7.2 Update `README.md`: rename env var references from `OPENROUTER_*` to `LLM_*`; update env var table; mention `.env.example`
- [x] 7.3 Update openspec main specs (`unified-server`, `writer-backend`): apply delta specs to reflect renamed env vars and configurable parameters

## 8. Verify

- [x] 8.1 Run all Deno tests and confirm they pass
- [x] 8.2 Run Rust tests and confirm they pass (unaffected, but verify no breakage)

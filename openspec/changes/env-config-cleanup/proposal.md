## Why

The backend has 8 hardcoded LLM sampling parameters (temperature, frequency_penalty, etc.) in `writer/routes/chat.ts` that cannot be tuned without editing source code. The API URL is also hardcoded to `https://openrouter.ai/api/v1/chat/completions`, preventing use of alternative OpenAI-compatible providers. Additionally, the project lacks a `.env.example` file, making setup opaque for new contributors, and the root `.gitignore` is ad-hoc rather than using standard Deno/Rust templates.

## What Changes

- Make 8 hardcoded LLM sampling parameters configurable via environment variables with current values as defaults
- Make the API URL environment-configurable (currently hardcoded in `config.ts`)
- **BREAKING**: Rename `OPENROUTER_API_KEY` → `LLM_API_KEY`, `OPENROUTER_MODEL` → `LLM_MODEL`, `OPENROUTER_API_URL` → `LLM_API_URL` across source, types, and docs
- Rename `OpenRouterStreamChunk` type to a provider-neutral name
- Create `.env.example` documenting all environment variables with descriptions and defaults
- Expand `.gitignore` with stock Deno ignores (merged with existing entries)
- Add `plugins/state-patches/rust/.gitignore` with stock Rust ignores

## Capabilities

### New Capabilities

- `env-example`: `.env.example` file documenting all environment variables with descriptions and defaults
- `gitignore-config`: Stock Deno and Rust gitignore entries merged with existing project ignores

### Modified Capabilities

- `writer-backend`: Chat endpoint uses env-configurable LLM parameters instead of hardcoded values; API URL is env-configurable; all OpenRouter-specific naming replaced with generic LLM naming
- `unified-server`: Environment variable table updated to reflect renamed variables and new LLM parameter variables

## Impact

- **Source code**: `writer/lib/config.ts`, `writer/types.ts`, `writer/routes/chat.ts`, `writer/server.ts`, `writer/lib/middleware.ts` (env var name changes)
- **Tests**: `tests/writer/routes/chat_test.ts` (≈20 occurrences of OpenRouter naming in mocks and assertions)
- **Documentation**: `README.md`, `AGENTS.md`, openspec specs (`unified-server`, `writer-backend`)
- **New files**: `.env.example`, `plugins/state-patches/rust/.gitignore`
- **Modified files**: `.gitignore` (root)
- **Breaking**: Anyone with `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` in their `.env` must rename to `LLM_API_KEY` / `LLM_MODEL`

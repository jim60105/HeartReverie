## Why

HeartReverie currently hard-fails LLM interactions with HTTP 500 (`"LLM_API_KEY is not configured"`) whenever `LLM_API_KEY` is unset, and unconditionally sends `Authorization: Bearer <key>` on every upstream request (rendering as `Bearer undefined` when the key is absent). Operators who point `LLM_API_URL` at a local or private LLM provider (Ollama, vLLM, LM Studio, private OpenAI-compatible endpoints) typically need no API key at all. Making `LLM_API_KEY` optional unblocks that deployment shape.

## What Changes

- **BREAKING** (early-stage project, no released users): `LLM_API_KEY` becomes optional.
  - `writer/lib/chat-llm-fetch.ts` — the upstream `fetch` builds the `Authorization` header **only when** the env var is set and non-empty; when missing the header is omitted entirely (no more `Bearer undefined`).
  - `writer/lib/chat-shared.ts` — `requireApiKey()` no longer throws `ChatError("api-key", 500)`; a missing key becomes a non-fatal log note and the chat flow proceeds.
  - `writer/routes/plugin-actions-preflight.ts` — preflight step 5 (missing key → 500) is removed; plugin actions proceed without a key.
  - `writer/server.ts` — the startup warning is reworded: a missing `LLM_API_KEY` no longer implies "chat functionality will not work"; keyless local providers still work.
- `.env.example` — `LLM_API_KEY` entry annotated as optional (local providers need no key).
- Documentation updated to reflect the new semantics: `AGENTS.md` (env-var table: `LLM_API_KEY` Required = No), `README.md`, `docs/reference/configuration.md`, `docs/self-host/external-llm.md` (local-provider setup without a key), `helm/heart-reverie/README.md`.
- Tests updated: the existing "returns 500 when `LLM_API_KEY` is missing" steps are re-scoped — with the key missing the request now proceeds; new assertions verify the `Authorization` header is present when the key is set and absent when it is not.

## Capabilities

### New Capabilities

- `optional-llm-api-key`: `LLM_API_KEY` is optional. When set, upstream LLM requests carry `Authorization: Bearer <key>`; when unset or empty, the header is omitted so keyless local/private providers (Ollama, vLLM, LM Studio) work out of the box.

### Modified Capabilities

- `writer-backend`: The "Missing API key" scenario (currently SHALL return HTTP 500) changes to: the request proceeds and the `Authorization` header is omitted. The chat requirement "SHALL use the `LLM_API_KEY` environment variable for authentication" is modified to "when `LLM_API_KEY` is set".
- `unified-server`: The "Missing API key warning" scenario is modified — the startup warning now states that keyless local providers still work; the warning is informational, not a functional gate.
- `openrouter-app-attribution`: The "alongside `Content-Type` and `Authorization`" requirement is modified — the three attribution headers remain on every upstream request; `Authorization` becomes conditional on the key being set.
- `env-example`: The `.env.example` `LLM_API_KEY` entry is annotated as optional for local providers.

## Impact

- **Code**: `writer/lib/chat-llm-fetch.ts` (conditional header), `writer/lib/chat-shared.ts` (non-fatal missing-key handling), `writer/routes/plugin-actions-preflight.ts` (drop key-presence gate), `writer/server.ts` (warning wording).
- **Tests**: `tests/writer/routes/chat_test.ts`, `tests/writer/routes/chat_continue_test.ts`, `tests/writer/routes/plugin_actions_coverage_test.ts` (500-expectation steps re-scoped); new unit/route tests assert `Authorization` header presence/absence.
- **Docs**: `AGENTS.md`, `README.md`, `.env.example`, `docs/reference/configuration.md`, `docs/self-host/external-llm.md`, `helm/heart-reverie/README.md`.
- **No new dependencies**; no schema or API-contract changes beyond the Authorization header behavior.

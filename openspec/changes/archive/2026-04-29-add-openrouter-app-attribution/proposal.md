## Why

HeartReverie proxies all chat completions through an OpenAI-compatible endpoint that, by default, points at OpenRouter. OpenRouter operates a public app-attribution program that drives discoverability through its [rankings](https://openrouter.ai/rankings), per-model "Apps" tabs, and detailed analytics — but only for requests that carry the `HTTP-Referer` and (optionally) `X-OpenRouter-Title` / `X-OpenRouter-Categories` headers documented at <https://openrouter.ai/docs/app-attribution>. Today the backend issues an unattributed POST, so HeartReverie is invisible in those leaderboards. Adding hard-coded attribution headers is a tiny, no-cost change that establishes project visibility now, before the project gets its first wider release.

## What Changes

- Hard-code three OpenRouter app-attribution headers as module-level constants in `writer/lib/chat-shared.ts` (or a tiny sibling module) and attach them to every upstream chat `fetch()`:
  - `HTTP-Referer: https://github.com/jim60105/HeartReverie` (required by OpenRouter for app-page creation)
  - `X-OpenRouter-Title: HeartReverie%20%E6%B5%AE%E5%BF%83%E5%A4%9C%E5%A4%A2` — the UTF-8 percent-encoded form of `HeartReverie 浮心夜夢`. Non-Latin-1 bytes are not valid in HTTP header values per WHATWG fetch / RFC 9110, so raw CJK characters would be rejected by `fetch()`. The constant uses `encodeURIComponent("HeartReverie 浮心夜夢")` so the source remains readable.
  - `X-OpenRouter-Categories: roleplay,creative-writing` (two recognized OpenRouter marketplace categories that match the project's positioning as an AI-driven interactive fiction engine)
- The headers are sent unconditionally on every upstream chat request, regardless of the configured `LLM_API_URL`. Non-OpenRouter OpenAI-compatible providers ignore unknown headers; operators on strict providers can fork.
- **No** environment variables, **no** runtime configuration, **no** per-story override surface, **no** UI: the headers identify the canonical HeartReverie deployment as a whole. Forks that want to rebrand SHALL edit the constants in source.
- Add a backend test asserting the upstream `fetch` request carries the three documented headers.
- Add a brief note to `AGENTS.md` explaining that these headers are present and how forks should change them (single source-code edit).

No backward compatibility, migration, or feature-flag affordances are required: HeartReverie is pre-release with zero deployed users.

## Capabilities

### New Capabilities
- `openrouter-app-attribution`: Hard-coded OpenRouter app-attribution HTTP headers (`HTTP-Referer`, `X-OpenRouter-Title`, `X-OpenRouter-Categories`) attached to every upstream LLM chat request.

### Modified Capabilities
- `writer-backend`: The "LLM API proxy" requirement gains an obligation to attach the three hard-coded attribution headers (sourced from a module constant) to every upstream chat fetch.

## Impact

- **Code**:
  - `writer/lib/chat-shared.ts` — add a module-level constant `LLM_APP_ATTRIBUTION_HEADERS` (a frozen `Record<string, string>` literal containing the three headers) and spread it into the `fetch` headers map at the existing upstream call site (≈ line 218) alongside `Content-Type` and `Authorization`. No new file required.
- **Tests**: One backend test in `tests/writer/lib/` (or extension of an existing `chat-shared` test) that uses a `fetch` stub to assert the three attribution headers are present on the upstream request with the documented values.
- **Docs**: A short paragraph in `AGENTS.md` explaining the headers and pointing forks at the constant. Optional one-line README mention.
- **Runtime**: Negligible — three string entries spread into a headers literal. No config-load step, no validation, no logs.
- **Privacy / security**: The three headers are static project-identity strings. No user data, story data, or telemetry is added. OpenRouter already sees the API key, so attribution adds no new data classes. No env vars means no operator misconfiguration risk and no header-injection attack surface (constants cannot contain CRLF unless a developer commits one).
- **Forking note**: A fork that wants to attribute its usage separately MUST edit the `LLM_APP_ATTRIBUTION_HEADERS` constant in `writer/lib/chat-shared.ts`. This is documented in `AGENTS.md`.
- **Dependencies**: None. Uses Deno's built-in `fetch`.

## Context

The writer backend (`writer/`) communicates with an LLM via a single fetch call in `writer/routes/chat.ts`. Currently:
- The API URL is hardcoded to `https://openrouter.ai/api/v1/chat/completions` in `writer/lib/config.ts`
- 8 sampling parameters (temperature, frequency_penalty, presence_penalty, top_k, top_p, repetition_penalty, min_p, top_a) are hardcoded in the fetch body
- All naming is OpenRouter-specific: env vars (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`), types (`OpenRouterStreamChunk`), comments, and error messages
- No `.env.example` exists; the only setup guidance is in `AGENTS.md` and `README.md`
- The root `.gitignore` is hand-written; no Rust `.gitignore` exists for `plugins/state-patches/rust/`

The system uses `@std/dotenv/load` for `.env` loading and `Deno.env.get()` for all runtime config.

## Goals / Non-Goals

**Goals:**
- Make all LLM API parameters tunable via environment variables without code changes
- Decouple the codebase from OpenRouter as a specific provider, using generic OpenAI-compatible naming
- Provide `.env.example` as a single source of truth for all configurable environment variables
- Ensure comprehensive `.gitignore` coverage using community-standard templates

**Non-Goals:**
- Supporting non-OpenAI-compatible APIs (e.g., Anthropic native API, Google Gemini)
- Adding runtime validation UI for sampling parameters
- Changing the streaming SSE implementation or response format
- Adding provider-specific features (OpenRouter HTTP-Referer, site-name headers, etc.)

## Decisions

### D1: Environment variable naming scheme

**Decision**: Rename `OPENROUTER_*` → `LLM_*` prefix (`LLM_API_KEY`, `LLM_MODEL`, `LLM_API_URL`).

**Alternatives considered**:
- `OPENAI_*` — too tied to one provider; could conflict with official OpenAI SDK env vars
- `AI_*` — too generic, conflicts likely
- Keep `OPENROUTER_*` — prevents using other providers without confusion

**Rationale**: `LLM_*` is descriptive, unlikely to conflict, and clearly signals "any LLM provider."

### D2: Sampling parameter env var naming

**Decision**: Use `LLM_` prefix + uppercase parameter name: `LLM_TEMPERATURE`, `LLM_FREQUENCY_PENALTY`, `LLM_PRESENCE_PENALTY`, `LLM_TOP_K`, `LLM_TOP_P`, `LLM_REPETITION_PENALTY`, `LLM_MIN_P`, `LLM_TOP_A`.

**Rationale**: Direct mapping from the JSON body field names; no ambiguity about what each controls.

### D3: Config centralization

**Decision**: All new env vars are parsed in `writer/lib/config.ts` and exposed through the `AppConfig` object. `chat.ts` reads from `config.*` — no direct `Deno.env.get()` calls for LLM params.

**Rationale**: Single parsing location makes defaults, validation, and testing straightforward.

### D4: Type rename strategy

**Decision**: Rename `OpenRouterStreamChunk` → `LLMStreamChunk` in `writer/types.ts`.

**Rationale**: The type represents an OpenAI-compatible SSE chunk, not an OpenRouter-specific one.

### D5: Gitignore approach

**Decision**: Merge stock Deno ignores into root `.gitignore` (preserving existing entries). Create a new `plugins/state-patches/rust/.gitignore` with stock Rust ignores, allowing the root `.gitignore` Rust target line to be removed (ownership is clearer in-project).

**Rationale**: Community templates cover edge cases (IDE files, OS files) that hand-written ignores miss. Per-project `.gitignore` for Rust follows Cargo conventions.

## Risks / Trade-offs

- **[Breaking env var rename]** → Mitigated by `.env.example` and clear migration note in docs. The rename is intentional to remove provider coupling.
- **[Too many env vars]** → 8 sampling params may overwhelm users. Mitigated by sensible defaults matching current hardcoded values; `.env.example` documents which are optional.
- **[Numeric parsing errors]** → Env vars are strings; parsing to float/int could fail. Mitigated by `parseFloat()`/`parseInt()` with fallback to default on `NaN`.
- **[Provider compatibility]** → Not all providers support all 8 parameters (e.g., `top_a` is uncommon). Mitigated by making all parameters optional — only include in request body if explicitly set via env var.

## Migration Plan

1. Rename env vars in `.env` file: `OPENROUTER_API_KEY` → `LLM_API_KEY`, `OPENROUTER_MODEL` → `LLM_MODEL`
2. Copy `.env.example` to `.env` and fill in values (for new setups)
3. No rollback needed — env var defaults match current behavior exactly

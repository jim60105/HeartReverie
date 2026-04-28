## Context

HeartReverie proxies all chat completions through one OpenAI-compatible endpoint configured by `LLM_API_URL` (default: `https://openrouter.ai/api/v1/chat/completions`). The single upstream `fetch()` site is `writer/lib/chat-shared.ts` (~line 216). All request shaping — body, sampling parameters, reasoning block, abort signal — is already centralized there.

OpenRouter's [App Attribution spec](https://openrouter.ai/docs/app-attribution) defines three opt-in HTTP headers:

| Header | Required? | Notes |
|---|---|---|
| `HTTP-Referer` | **Required** to create an app page / appear in rankings | URL becomes the app's unique identifier |
| `X-OpenRouter-Title` | Optional (display name; `X-Title` is a legacy alias) | Free-form string |
| `X-OpenRouter-Categories` | Optional | Comma-separated, ≤ 2 per request, lowercase + hyphens, ≤ 30 chars per entry; unrecognized values silently dropped |

The user has chosen the **simplest possible integration**: hard-code the three header values as a module constant and spread them into the existing `fetch` headers map. No env vars, no validation, no runtime configuration. This change is roughly five lines of source code plus one test.

## Goals / Non-Goals

**Goals:**
- Make HeartReverie discoverable in OpenRouter's public rankings and per-model "Apps" tabs with the smallest possible code change.
- Keep the upstream call site simple and easy to read.
- Provide a single, obvious source-code location for forks to edit if they want to attribute their usage separately.

**Non-Goals:**
- Environment-variable configuration (`LLM_APP_REFERER`, `LLM_APP_TITLE`, `LLM_APP_CATEGORIES`). Explicitly rejected by the user.
- Runtime override of any kind: per-story `_config.json`, HTTP API surface, prompt template variables, frontend UI.
- Validation of header values. Hard-coded constants are author-controlled and known-good at commit time; runtime validation is unnecessary overhead.
- A separate `app-attribution.ts` module. The constants are tiny and live next to the only call site.
- Maintaining the legacy `X-Title` alias. OpenRouter accepts both, but the spec's "current" name is `X-OpenRouter-Title`; we send only the current name.

## Decisions

### Decision 1: Hard-code the three header values as a module constant

**Choice**: Define `LLM_APP_ATTRIBUTION_HEADERS` as a frozen `Record<string, string>` literal at the top of `writer/lib/chat-shared.ts`:

```ts
const LLM_APP_ATTRIBUTION_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "HTTP-Referer": "https://github.com/jim60105/HeartReverie",
  "X-OpenRouter-Title": encodeURIComponent("HeartReverie 浮心夜夢"),
  "X-OpenRouter-Categories": "roleplay,creative-writing",
});
```

`encodeURIComponent` is used for the title because raw non-Latin-1 bytes are not valid in HTTP header values per WHATWG fetch / RFC 9110, so the CJK characters must be UTF-8 percent-encoded for transport. Wrapping the readable source string in `encodeURIComponent` (rather than committing the percent-encoded form directly) keeps the constant easy to read and edit.

Spread it into the existing `fetch` headers map alongside `Content-Type` and `Authorization`.

**Rationale**: Smallest possible change. The values are project identity, not deployment configuration; treating them as configuration is over-engineering for a pre-release project with zero deployed users. A frozen constant prevents accidental mutation at runtime.

**Alternatives considered**:
- *Env-var-driven configuration with validation* — explicitly rejected by the user in this iteration. Would have added env-parsing, a CRLF/control-char guard, category validation, warn logs, an `AppConfig` field, and ~40 lines of helpers + tests. None of that is needed for a pre-release deployment-identity string.
- *A separate `writer/lib/app-attribution.ts` file* — rejected as overkill for three string literals; readers benefit from seeing the constant at the top of the only file that uses it.
- *Adding the constant to `writer/lib/config.ts`* — rejected because `config.ts` is for env-var resolution. The attribution headers are not configurable, so they don't belong there.

### Decision 2: Send headers unconditionally regardless of `LLM_API_URL`

**Choice**: Spread the constant into every upstream `fetch` headers map without inspecting the URL.

**Rationale**: Non-OpenRouter OpenAI-compatible providers ignore unknown headers. URL sniffing is brittle (proxies, mirrors, CNAMEs) and offers no real benefit. Forks that target a strict provider edit the constant (or set it to `{}`).

**Trade-off**: A small number of strict / privacy-sensitive providers may log or reject unknown headers. This is acceptable for the canonical deployment (which targets OpenRouter); operators on such providers should fork and edit the constant.

### Decision 3: Categories chosen — `roleplay,creative-writing`

**Choice**: Two of OpenRouter's documented marketplace categories that best describe HeartReverie:
- `roleplay` — "Roleplay apps and other character-based chat apps"
- `creative-writing` — "Creative writing tools"

Both are within the per-request cap of 2. Both pass OpenRouter's documented format constraints (lowercase, hyphen-separated, ≤ 30 chars). They are committed as a single comma-separated string `roleplay,creative-writing` to match the wire format OpenRouter expects.

**Rationale**: HeartReverie is described in `AGENTS.md` as "An AI-driven interactive fiction engine built around SillyTavern" — both roleplay (character-based interactive narratives) and creative-writing (the writer/reader UI) apply directly. Picking exactly two means no truncation by OpenRouter and no need for any client-side cap logic.

### Decision 4: Tests assert the headers reach the upstream `fetch`

**Choice**: One backend test that injects a `fetch` stub into `executeChat()` (or whichever export of `chat-shared.ts` is most testable) and asserts the request received by the stub carries:

- `HTTP-Referer: https://github.com/jim60105/HeartReverie`
- `X-OpenRouter-Title` equal to `encodeURIComponent("HeartReverie 浮心夜夢")` — i.e. the percent-encoded wire value `HeartReverie%20%E6%B5%AE%E5%BF%83%E5%A4%9C%E5%A4%A2`
- `X-OpenRouter-Categories: roleplay,creative-writing`

If `tests/writer/lib/` already contains a `chat-shared`-flavoured test, extend it; otherwise add a focused `app-attribution_test.ts`. No unit-level "validator" tests because there is no validator.

**Rationale**: The only behavior to verify is "the constant is wired into the fetch call". A single integration-style assertion suffices.

## Risks / Trade-offs

- **Risk**: A fork that forgets to edit the constant inadvertently attributes its usage to the upstream HeartReverie app page. → **Mitigation**: A short paragraph in `AGENTS.md` directly tells forks where the constant lives and that they MUST edit it. The risk is small because (a) forks already configure their own keys/URLs and (b) the consequence (attribution to upstream) is reversible at the next deploy.
- **Risk**: A future OpenRouter rename (e.g., dropping `X-OpenRouter-Title` again) breaks attribution silently. → **Mitigation**: The header name lives in one constant. Future renames are a one-line change.
- **Risk**: OpenRouter's public docs do not explicitly state that `X-OpenRouter-Title` is percent-decoded for display. The percent-encoding is required by RFC 9110 / WHATWG fetch for non-Latin-1 bytes regardless, so the wire format is correct; whether the OpenRouter rankings UI renders it as `HeartReverie 浮心夜夢` or as the literal percent-encoded string is empirical. → **Mitigation**: Acceptable for a pre-release deployment; if the displayed title matters, a future change can switch to an ASCII-only title (e.g. `HeartReverie`) once OpenRouter's behavior is confirmed.
- **Trade-off (vs. the env-var design)**: Operators of the canonical deployment cannot disable attribution without editing source. This is acceptable because (a) there is only one canonical deployment (this repo's owner) and (b) forks are expected to edit anyway.
- **Trade-off**: Because the constant is hard-coded, a typo in the category names ships to every user of the canonical deployment until corrected. → **Mitigation**: The two categories are spelled exactly as in OpenRouter's published list (verified at design time); the test will catch any future typo introduced during refactors only insofar as it asserts the exact string. Treat this constant the same as any other string literal — review at PR time.

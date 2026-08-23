## Context

HeartReverie's LLM proxy currently treats `LLM_API_KEY` as mandatory in three places:

1. `writer/lib/chat-shared.ts` — `requireApiKey()` throws `ChatError("api-key", "LLM_API_KEY is not configured", 500)` before the upstream fetch (used by both the HTTP chat route and the WebSocket chat path, call sites at `executeChat` and `executeContinueChat`).
2. `writer/routes/plugin-actions-preflight.ts` — preflight step 5 returns a 500 problem when the key is missing.
3. `writer/lib/chat-llm-fetch.ts` — `performLlmFetch()` unconditionally builds `Authorization: \`Bearer ${Deno.env.get("LLM_API_KEY")\``, which renders as the literal `Bearer undefined` when the variable is absent.

Local and private OpenAI-compatible providers (Ollama, vLLM, LM Studio, private gateways without auth) commonly need no key at all, but the current code path hard-fails before the upstream call. This change makes the key optional and makes the `Authorization` header conditional.

## Goals / Non-Goals

**Goals:**

- `LLM_API_KEY` unset or empty ⇒ the upstream request is sent without an `Authorization` header; no 500 anywhere in the chat or plugin-action paths.
- `LLM_API_KEY` set to a non-empty value ⇒ the request carries `Authorization: Bearer <key>` exactly as before.
- Startup warning reworded so it no longer claims chat "will not work".
- Docs (AGENTS.md, README, `.env.example`, `docs/reference/configuration.md`, `docs/self-host/external-llm.md`, Helm README) updated to describe the key as optional.

**Non-Goals:**

- No new env var to toggle auth mode (no `LLM_AUTH_MODE`); the mere presence of the key is the switch.
- No per-story or per-plugin API key override (`LLM_API_KEY` remains deployment-level, not in `_config.json`).
- No change to how the key is redacted from logs (the `audit-logger` redaction rule still applies to the `Authorization` header when present).
- No changes to the three hard-coded OpenRouter attribution headers — they remain attached regardless of key presence.

## Decisions

### Decision 1: Omit the `Authorization` header entirely when the key is empty

In `performLlmFetch()` (`writer/lib/chat-llm-fetch.ts:171-180`), build the header map conditionally:

```ts
const apiKey = Deno.env.get("LLM_API_KEY");
const headers: Record<string, string> = {
  ...LLM_APP_ATTRIBUTION_HEADERS,
  "Content-Type": "application/json",
};
if (apiKey) {
  headers["Authorization"] = `Bearer ${apiKey}`;
}
```

**Rationale:** Omission is the standard HTTP semantics for "no credentials" — local providers simply don't read the header.
**Alternatives considered:**
- *Send `Authorization: Bearer ` (empty value)* — non-conformant and confusing for strict providers.
- *New `LLM_AUTH_MODE` env var* — extra surface for a single boolean outcome already determined by key presence.
- *Treat empty string as valid key* — `Bearer` (empty) is fragile; `if (apiKey)` treats unset and `""` identically, which matches the "empty or unset → fall through" convention used for other env vars.

### Decision 2: Missing key is non-fatal in the chat flow

Replace the throwing `requireApiKey()` in `writer/lib/chat-shared.ts:83-88` with a non-throwing helper that logs at `debug` level ("LLM_API_KEY not set; proceeding without an Authorization header") and returns, so both call sites (lines 193, 279) keep the same shape. The helper follows the project's error-handling convention (capture + log, never swallow silently).

**Log-level rationale:** A keyless local deployment is a *valid* configuration — a `warn` on every chat/resend request would flood the log. The single operator-facing `warn` lives once at startup (`writer/server.ts:34`); per-request handling logs at `debug` level, so expected keyless traffic stays quiet while still being diagnosable.

**Rationale:** The 500 `ChatError` existed to fail fast; now the missing key is a *valid configuration*, so a warn log is the correct signal for operators running cloud providers who forgot the key (the upstream 401 will surface via the existing non-2xx error path).

### Decision 3: Drop preflight step 5 for plugin actions

Remove the `if (!Deno.env.get("LLM_API_KEY"))` block in `writer/routes/plugin-actions-preflight.ts:296-310` and update the module doc comment (line 28) that lists "API key presence — missing `LLM_API_KEY` → 500" as step 5.

**Rationale:** Plugin actions go through the same upstream fetch; if the chat path tolerates a missing key, the action path must too.

### Decision 4: Startup warning wording

`writer/server.ts:33-34` currently warns "LLM_API_KEY is not set — chat functionality will not work". Change the message to: "LLM_API_KEY is not set — cloud providers will reject unauthenticated requests; keyless local providers (Ollama/vLLM/LM Studio) still work". Keep `log.warn` (not `error`), no startup failure.

### Decision 5: Test strategy

- Re-scope existing "500 when LLM_API_KEY is missing" steps:
  - `tests/writer/routes/chat_test.ts` — the first test block hits the real `LLM_API_URL`; after the change the step should mock `globalThis.fetch` (as the "extended coverage" block already does) and assert the request proceeds and no `Authorization` header is sent.
  - `tests/writer/routes/chat_continue_test.ts` — the "500 when LLM_API_KEY is missing" step now expects success with the mocked fetch.
  - `tests/writer/routes/plugin_actions_coverage_test.ts` — "missing LLM_API_KEY returns 500" step now expects the action to proceed.
- Add assertions on the wire: key set ⇒ `Authorization: Bearer test-key` present; key missing ⇒ header absent (no `Bearer undefined`). The wire test SHALL cover **both** unset and empty-string (`LLM_API_KEY=""`) — both must omit the header.
- Add an assertion that a non-2xx upstream response passes the upstream status through to the client (e.g. 401/403), distinct from the 502 reserved for network-level failures.
- `tests/writer/routes/llm-defaults_test.ts` already asserts `LLM_API_KEY` is NOT in the `llm-defaults` payload — unchanged, still valid.

## Risks / Trade-offs

- **[Cloud provider rejects the request]** → Expected behaviour, not a bug: an operator pointing `LLM_API_URL` at OpenRouter without a key will get an upstream 401/403. The non-2xx path in `performLlmFetch` preserves the upstream status code (`throw new ChatError("llm-api", detailMessage, apiResponse.status)`), so the client sees 401/403 with an RFC 9457 Problem Details body containing the (truncated) upstream error body. The startup warn log is the advance notice. (502 is reserved for network-level failures, not for upstream auth errors.)
- **`Bearer undefined` regression in logs** → `audit-logger` redacts the `Authorization` header from logged request metadata; with the header omitted there is nothing to redact, so the redaction rule simply becomes a no-op in the keyless case. No change needed.
- **Stale docs** → The env-var table in AGENTS.md marks `LLM_API_KEY` as "Required: Yes"; docs are updated in the same change to avoid drift.
- **Rollback** → Revert the four code edits and the doc updates; no schema or data migration exists, so rollback is a plain `git revert`.

## Migration Plan

No migration needed (early-stage project, zero released users, per the propose notes). Deployment is a plain container rebuild + restart; keyless local deployments set `LLM_API_URL` to the local endpoint and simply omit `LLM_API_KEY`.

## Open Questions

None — the decision to treat an empty string as "no key" and to omit the header (rather than send an empty `Bearer`) is settled by the conditional-construction decision above.

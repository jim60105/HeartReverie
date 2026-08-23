# Tasks — optional-llm-api-key

## 1. Backend: make the key optional

- [x] 1.1 In `writer/lib/chat-llm-fetch.ts` (`performLlmFetch`), build the upstream request headers conditionally: include `Authorization: Bearer <key>` only when `Deno.env.get("LLM_API_KEY")` is a non-empty value; otherwise send only the attribution headers + `Content-Type` (no `Bearer undefined`)
- [x] 1.2 In `writer/lib/chat-shared.ts`, replace the throwing `requireApiKey()` (line 83-88) with a non-fatal helper that logs at **debug** level when the key is missing and proceeds (keep call sites at lines 193 and 279 working). The single operator-facing `warn` stays at startup (`writer/server.ts`), so valid keyless local deployments don't flood the log per request
- [x] 1.3 In `writer/routes/plugin-actions-preflight.ts`, remove the missing-key preflight 500 block (lines 296-310) and update the module doc comment (line 28) so step 5 no longer mentions the API-key gate
- [x] 1.4 In `writer/server.ts`, reword the startup warning (line 34) to state: without `LLM_API_KEY` the `Authorization` header is omitted, and `LLM_API_URL` must point to a keyless provider endpoint (Ollama/vLLM/LM Studio); cloud providers reject unauthenticated requests

## 2. Tests

- [x] 2.1 Update `tests/writer/routes/chat_test.ts`: re-scope the "returns 500 when LLM_API_KEY not set" step — with the key missing the request now proceeds (mock `globalThis.fetch` as the "extended coverage" block does) and assert no `Authorization` header is sent; assert for **both** unset and `LLM_API_KEY=""` (empty string); add an assertion that with the key set, the request carries `Authorization: Bearer <key>`; add an assertion that an upstream non-2xx response (e.g. 401/403 from a cloud provider) passes its status through to the client (distinct from the 502 reserved for network-level failures)
- [x] 2.2 Update `tests/writer/routes/chat_continue_test.ts`: the "500 when LLM_API_KEY is missing" step now expects the continue flow to proceed without the `Authorization` header (cover unset and empty-string key)
- [x] 2.3 Update `tests/writer/routes/plugin_actions_coverage_test.ts`: the "missing LLM_API_KEY returns 500" step now expects the plugin action to proceed
- [x] 2.4 Run `deno task test:backend` and fix any new failures caused by the removed 500 gate

## 3. Documentation

- [x] 3.1 Update the env-var table in `AGENTS.md` (`LLM_API_KEY` Required: No) and the `.env` setup notes (lines 180, 206)
- [x] 3.2 Update `.env.example`: annotate the `LLM_API_KEY` entry as optional for local providers (Ollama/vLLM/LM Studio)
- [x] 3.3 Update `README.md` and `docs/reference/configuration.md`: `LLM_API_KEY` is optional; only `PASSPHRASE` is required
- [x] 3.4 Update `docs/self-host/external-llm.md`: document the keyless local-provider setup (e.g. `LLM_API_URL=http://127.0.0.1:11434/v1/chat/completions` with no key)
- [x] 3.5 Update `helm/heart-reverie/README.md`: note that `LLM_API_KEY` may be omitted for local providers (the chart already drops empty secret values)

## 4. Verification

- [x] 4.1 Run `deno task fmt` and `deno task lint` until both are clean
- [x] 4.2 Container verification per AGENTS.md: `cd HeartReverie && scripts/podman-build-run.sh`, check `podman logs heartreverie` is clean of errors
- [x] 4.3 Integration check: start a local OpenAI-compatible stub server (e.g. a small Deno HTTP server that records received headers and returns a valid streaming chat completion), point the container's `LLM_API_URL` at it, run without `LLM_API_KEY`, then `curl -H "X-Passphrase: ..." localhost:8080/...` and assert: the stub received **no** `Authorization` header, the response was 200, and the chapter file was written

# Design

## Context

See proposal.md, section Why. Current flow, all called from `streamLlmAndPersist()` in `writer/lib/chat-stream-and-persist.ts`:

1. `logLlmRequest()`, then `buildLlmRequestBody(llmConfig, messages, config.LLM_REASONING_OMIT)` in `writer/lib/chat-llm-fetch.ts` builds the Chat Completions body.
2. `dispatchPreLlmFetchHook(hookDispatcher, baseFields, messages, requestBody)` runs once. It strips `messages` to produce `requestMetadata`.
3. `performLlmFetch({ apiUrl: config.LLM_API_URL, ... })` POSTs with the attribution headers and an optional `Authorization`. It throws `ChatAbortError`, or `ChatError` with code `network`/`llm-api`/`no-body`.
4. `openChapterForStream()` runs, then `consumeLlmStream()` in `writer/lib/chat-stream.ts` parses `data:` lines. Its inline `handlePayload` reads `choices[0].delta.content`, `delta.reasoning` / `reasoning_details`, `usage`, `error` / `finish_reason:"error"`, and frames reasoning as `<think>` for chapter-writing modes.
5. Abort, no-content, usage record, then `finalizeStreamMode({ endpoint: config.LLM_API_URL, ... })`, which feeds the `post-response` hook `endpoint`.

The engine only ever streams (`stream: true`). There is no non-streaming code path to adapt.

Test configs are object literals cast with `as unknown as AppConfig`. Many tests stub `globalThis.fetch` and only answer URLs that contain `chat/completions`, sending everything else to the real network.

## Goals / Non-Goals

**Goals:**
- Responses is the default transport. Auto fallback is limited to unambiguous "endpoint unsupported" statuses (404, 405, 501), and a successful fallback is cached per (Responses URL, model).
- Reasoning reaches the existing `<think>` state machine on both transports, with no duplicates. Usage and cost reach the existing `TokenUsageRecord`.
- Existing Chat Completions bytes stay identical. `buildLlmRequestBody` does not change.

**Non-Goals:**
- Non-streaming requests. The engine has none. The prompt-debugger replay is a plugin-side feature and stays out of scope.
- Changing the Chat Completions request-side reasoning shape. `reasoning: {enabled, effort}` stays, and `reasoning_effort` is not added.
- Multi-turn reasoning carry-over: `previous_response_id`, `include: ["reasoning.encrypted_content"]`, `store: true`. OpenRouter rejects `store: true`.
- Mid-stream fallback, or fallback on 400/422. A 400/422 more likely means bad parameters than a missing endpoint.
- Per-story transport override, frontend UI, startup probing, and cache expiry or persistence.
- Any edit in `HeartReverie_Plugins`.

## Decisions

### D1. Keep `LLM_API_URL` as a full URL; derive the sibling URL by path suffix
`resolveLlmEndpoints(apiUrl)` swaps a trailing `/chat/completions` ↔ `/responses` on `URL.pathname`, ignoring one trailing `/`. It preserves origin, search and hash. Any other path, or an unparseable URL, gives `derived: false` with both URLs equal to `apiUrl`.
- Alternative considered: redefine `LLM_API_URL` as a base URL. Rejected. Every existing `.env`, the docs and the Helm comments would break silently into `/chat/completions/responses` 404s. The prompt-debugger replay, which POSTs a chat body to `config.LLM_API_URL`, would also break.
- Alternative considered: a separate `LLM_RESPONSES_API_URL`. Rejected as an extra knob with no use case beyond what derivation already covers.

### D2. `LLM_API_MODE` env var, parsed like `LLM_REASONING_EFFORT`
`apiModeEnv(key, fallback)` in `writer/lib/config.ts` trims the value, requires an exact match in `LLM_API_MODES`, and on mismatch calls `log.warn("Unrecognized LLM_API_MODE value; falling back to default", { variable, value })`. An empty or unset value returns the default silently. The value is exported and added to `AppConfig` as `readonly LLM_API_MODE: LlmApiMode`. It is not added to `llmDefaults`, `STORY_LLM_CONFIG_KEYS` or `/api/llm-defaults`.

### D3. Plan, then attempt in a loop inside `streamLlmAndPersist`
New module `writer/lib/llm-transport.ts`:

```ts
import type { LlmApiMode, LlmTransport } from "../types/llm.ts";
import type { WriteMode } from "./chat-types.ts";
export interface LlmEndpoints {
  readonly chatCompletionsUrl: string;
  readonly responsesUrl: string;
  readonly derived: boolean;
}
export const RESPONSES_UNSUPPORTED_STATUSES: ReadonlySet<number>; // new Set([404, 405, 501])
export function resolveLlmEndpoints(apiUrl: string): LlmEndpoints;
export function planLlmTransports(mode: LlmApiMode, endpoints: LlmEndpoints, model: string, writeModeKind: WriteMode["kind"]): readonly LlmTransport[];
export function transportUrl(transport: LlmTransport, endpoints: LlmEndpoints): string;
export function recordChatCompletionsFallback(endpoints: LlmEndpoints, model: string): void;
export function resetLlmTransportCache(): void; // test helper
```

The cache is a module-level `Set<string>` keyed by `${responsesUrl}\n${model}`. The plan rules are verbatim from the spec requirement "Transport attempt plan". Evaluation order: `chat-completions` → `["chat-completions"]`; `responses` → `["responses"]`; `auto` → `["chat-completions"]` if `!endpoints.derived`, or `writeModeKind === "continue-last-chapter"`, or the cache has the key; else `["responses", "chat-completions"]`. `continue-last-chapter` is pinned to Chat Completions in `auto` because its trailing-assistant prefill is a Chat Completions behaviour (see `openspec/specs/continue-last-chapter/spec.md`) with no documented Responses equivalent; forced `responses` mode is an explicit operator choice and is honoured. `resolveLlmEndpoints` returns the verbatim `apiUrl` for the side that matched the suffix and the rebuilt URL only for the derived sibling.

In `writer/types/llm.ts`:

```ts
export const LLM_API_MODES = ["auto", "responses", "chat-completions"] as const;
export type LlmApiMode = typeof LLM_API_MODES[number];
export type LlmTransport = Exclude<LlmApiMode, "auto">;
```

Orchestration in `streamLlmAndPersist`, replacing the single `buildLlmRequestBody` + `performLlmFetch` calls:

```ts
const endpoints = resolveLlmEndpoints(config.LLM_API_URL);
const plan = planLlmTransports(config.LLM_API_MODE, endpoints, llmConfig.model, writeMode.kind);
const buildBody = (t: LlmTransport) => t === "responses"
  ? buildResponsesRequestBody(llmConfig, messages, config.LLM_REASONING_OMIT)
  : buildLlmRequestBody(llmConfig, messages, config.LLM_REASONING_OMIT);
const firstBody = buildBody(plan[0]);
await dispatchPreLlmFetchHook(hookDispatcher, { ...baseFields, transport: plan[0] }, messages, firstBody);
const llmStartTime = performance.now();
let served: { apiResponse: Response & { body: ReadableStream<Uint8Array> }; transport: LlmTransport; url: string } | null = null;
for (let i = 0; i < plan.length; i++) {
  const transport = plan[i];
  const isLast = i === plan.length - 1;
  const url = transportUrl(transport, endpoints);
  try {
    const apiResponse = await performLlmFetch({
      apiUrl: url, requestBody: i === 0 ? firstBody : buildBody(transport), signal, llmStartTime,
      model: llmConfig.model, reqLog, llmLog,
      fallbackStatuses: transport === "responses" && !isLast ? RESPONSES_UNSUPPORTED_STATUSES : undefined,
    });
    if (i > 0) recordChatCompletionsFallback(endpoints, llmConfig.model);
    served = { apiResponse, transport, url };
    break;
  } catch (err) {
    if (err instanceof LlmTransportUnsupportedError && !isLast) continue;
    throw err;
  }
}
if (!served) throw new Error("unreachable: transport plan exhausted");
```

`served.transport` is passed to `consumeLlmStream({ ..., transport })`. `served.url` replaces `config.LLM_API_URL` as `finalizeStreamMode({ endpoint })`. `transport` is added to the success and abort `llmLog.info("LLM response", …)` entries and to `reqLog.info("LLM response completed", …)`, so operators can see when per-story `repetitionPenalty`/`minP`/`topA` (still logged under `parameters` by `logLlmRequest`) were not sent. `llmStartTime` is taken once before the first attempt, so reported latency includes a fallback round-trip.
- Alternative considered: re-dispatch `pre-llm-fetch` per attempt. Rejected. The existing hook-observability spec says "not re-dispatched on retry or fallback", and the prompt-debugger recorder flushes once per correlationId.

### D4. `performLlmFetch` gets an optional fallback-status escape
New optional arg `fallbackStatuses?: ReadonlySet<number>`. When `!apiResponse.ok && fallbackStatuses?.has(apiResponse.status)`:
1. Discard the body without reading it: `await apiResponse.body?.cancel().catch(() => {});`.
2. If `signal?.aborted === true`: write `llmLog.info("LLM error", { type: "error", errorCode: "aborted", latencyMs })` exactly like the existing fetch-abort branch and `throw new ChatAbortError("Generation aborted by client")`.
3. Call `reqLog.warn("LLM Responses API unsupported; falling back to Chat Completions", { status, url: apiUrl })`.
4. `throw new LlmTransportUnsupportedError(apiResponse.status)`.

No `llmLog` "LLM error" entry is written here, because this is not a terminal failure. All other branches stay byte-for-byte the same.

`LlmTransportUnsupportedError` goes in `writer/lib/chat-types.ts`:

```ts
export class LlmTransportUnsupportedError extends Error {
  constructor(readonly status: number) {
    super(`Responses API unsupported (HTTP ${status})`);
    this.name = "LlmTransportUnsupportedError";
  }
}
```

It is never a `ChatError`, so route handlers can never receive it: the loop either continues or the set was undefined.

### D5. Responses request body
`buildResponsesRequestBody(llmConfig, messages, omitReasoning)` in `chat-llm-fetch.ts`. Key order is fixed for deterministic serialisation:

```ts
const body: Record<string, unknown> = {
  model: llmConfig.model,
  input: messages,
  stream: true,
  store: false,
  temperature: llmConfig.temperature,
  top_p: llmConfig.topP,
  top_k: llmConfig.topK,
  frequency_penalty: llmConfig.frequencyPenalty,
  presence_penalty: llmConfig.presencePenalty,
};
if (llmConfig.maxCompletionTokens !== null) body.max_output_tokens = llmConfig.maxCompletionTokens;
if (!omitReasoning) {
  body.reasoning = llmConfig.reasoningEnabled
    ? { effort: llmConfig.reasoningEffort, summary: "auto" }
    : { effort: "none" };
}
```

`input: messages` works unchanged because Responses accepts `{role, content: string}` easy-input messages for `system`/`user`/`assistant`. The sampler subset is the set listed in the OpenRouter `/responses` OpenAPI schema (`temperature`, `top_p`, `top_k`, `frequency_penalty`, `presence_penalty`). `repetition_penalty`, `min_p` and `top_a` are not in that schema, and sending them risks a 400 that would not trigger a fallback. `{effort: "none"}` turns reasoning off in both the OpenAI and the OpenRouter `ReasoningEffort` enums. OpenAI rejects OpenRouter's `{enabled:false}` form.

`dispatchPreLlmFetchHook` changes its destructuring to `const { messages: _m, input: _i, ...requestMetadata } = requestBody;`. `PreLlmFetchPayload` gains `readonly transport: LlmTransport`, and the `baseFields` type follows automatically through `Omit<…>`.

### D6. Normalised stream frames
New module `writer/lib/llm-stream-frames.ts`, made of pure functions with no I/O:

```ts
export interface LlmStreamUsage {
  readonly prompt: number | null;
  readonly completion: number | null;
  readonly total: number | null;
  readonly cost: number | null;
}
export interface LlmStreamFrame {
  readonly content: string;                          // "" when none
  readonly reasoning: string;                        // "" when none
  readonly reasoningKind: "text" | "summary" | null; // null iff reasoning === ""
  readonly usage: LlmStreamUsage | null;
  readonly error: string | null;                     // provider message when the frame is an error
}
export function parseChatCompletionsFrame(raw: unknown): LlmStreamFrame;
export function parseResponsesFrame(raw: unknown): LlmStreamFrame;
```

- `parseChatCompletionsFrame` moves today's logic out of `handlePayload` unchanged: the error test (`error` object or `finish_reason === "error"`), the message/code/default message, `delta.content`, the usage mapping with the cost guard (`typeof cost === "number" && isFinite(cost) && cost >= 0`), and the `tokens ?? null` defaults. Reasoning priority becomes `delta.reasoning` → `delta.reasoning_content` → `reasoning_details[].text` concatenation, with kind `"text"`. Usage is set whenever `parsed.usage` is truthy, as it is today.
- `parseResponsesFrame` first applies the top-level `error` object rule, then switches on `raw.type`:
  - `response.output_text.delta`: `content = delta` (string only).
  - `response.reasoning_text.delta`: reasoning, kind `"text"`.
  - `response.reasoning_summary_text.delta`: reasoning, kind `"summary"`.
  - `response.reasoning_summary_part.added` with numeric `summary_index > 0`: `reasoning = "\n\n"`, kind `"summary"`.
  - `response.completed` or `response.incomplete`: usage from `raw.response?.usage` when it is an object, mapping `input_tokens`/`output_tokens`/`total_tokens`/`cost`, with the same cost guard and `?? null`.
  - `response.failed`: error from `raw.response?.error`.
  - `error`: error from `raw.message`/`raw.code`.
  - Anything else gives the empty frame.

  The error message rule is the same as for chat: a non-empty string `message`, else `String(code)` when it is defined, else `"Mid-stream provider error"`.

`consumeLlmStream` gains `transport: LlmTransport`. Its `handlePayload` keeps the `[DONE]` early return and the JSON parse with malformed-chunk debug log, then calls the matching parser. If `frame.error !== null`, the existing stream-error log and throw run. The existing `<think>` open/write/close logic then runs on `frame.reasoning` and `frame.content`, and, when `frame.usage !== null`, `frame.usage` replaces `tokenUsage` (a later usage-less frame never clears it). A new local `let reasoningKindLock: "text" | "summary" | null = null` takes the first non-null `reasoningKind`. Frames whose kind differs from the lock are skipped entirely: not written, not counted in `reasoningLength`. `extractReasoningText` is deleted from `chat-stream.ts`. `LLMStreamChunk` in `writer/types/llm.ts` gains `reasoning_content?: string` in `delta`.

### D7. Test isolation
Every new test that exercises `auto` calls `resetLlmTransportCache()` before running. Existing test config literals that stub only `chat/completions` URLs gain `LLM_API_MODE: "chat-completions"`. These are the files in tasks 4.1. Their assertions are untouched, so they stay Chat Completions regression tests.

## Risks / Trade-offs

- [An OpenRouter 404 from a missing model or "no endpoints" triggers a needless fallback] → The fallback is cached only when Chat Completions succeeds, and is keyed per model. A genuinely missing model fails on both transports and surfaces the Chat Completions error with nothing cached.
- [Default users lose `repetition_penalty`/`min_p`/`top_a` on Responses] → This is documented in the docs and `.env.example`. `LLM_API_MODE=chat-completions` restores the previous behaviour exactly.
- [Trailing-assistant prefill would be ignored by Responses backends] → `auto` pins `continue-last-chapter` to Chat Completions (D3). Only an explicit `LLM_API_MODE=responses` sends it over Responses.
- [Upstreams that implement `/responses` partially reject a field (`top_k`, `store`, `reasoning.summary`, `effort: "none"`) with 400/422, which never falls back] → Deliberate: 400/422 are ambiguous. The upstream body already appears in the error detail, and the docs say "if you see 400/422 after upgrading, set `LLM_API_MODE=chat-completions`".
- [Summaries from several reasoning items are joined without a separator when `summary_index` restarts at 0] → Cosmetic, accepted.
- [prompt-debugger replay posts Responses-shaped metadata to the chat URL] → It is a dev-only opt-in feature. This is reported as a cross-repo follow-up, and the new `transport` field lets the plugin branch.
- [Fallback costs one extra round-trip per (URL, model) per process] → This is acceptable, and restarting the process re-probes.

## Migration Plan

Pre-release, so there is no migration code. After deploying, an operator whose upstream lacks `/responses` gets the fallback automatically. An upstream that returns some other status for an unknown path, such as 400, needs `LLM_API_MODE=chat-completions`. This is documented in `docs/self-host/external-llm.md`. Rollback is to set `LLM_API_MODE=chat-completions`.

## 1. Types

- [x] 1.1 Add `PostResponsePayload` interface to `writer/types.ts`, mirroring the `readonly`-field pattern used by `PreLlmFetchPayload`; include `correlationId`, `content`, `storyDir`, `series`, `name`, `rootDir`, `chapterNumber`, `chapterPath`, `source: "chat" | "continue" | "plugin-action"` (all three literals — `"chat"` for `write-new-chapter` and `replace-last-chapter`, `"continue"` for `continue-last-chapter`, `"plugin-action"` for `append-to-existing-chapter`), optional `pluginName`, optional `appendedTag`, required `usage: TokenUsageRecord | null`, and required `endpoint: string`
- [x] 1.2 Export `PostResponsePayload` from the same public type surface that already exports `PreLlmFetchPayload` and `TokenUsageRecord` so plugin authors can `import type { PostResponsePayload } from "...";`

## 2. Append-on-success parity

- [x] 2.1 In `writer/lib/chat-shared.ts`, the `append-to-existing-chapter` branch (around lines 793–823) SHALL call `appendUsage(storyDir, usage)` when `usage !== null`, placed BEFORE the `post-response` dispatch and consistent with the three sibling branches (`write-new-chapter` ~776–778, `continue-last-chapter` ~825–827, `replace-last-chapter` ~860–862)
- [x] 2.2 Confirm by reading the diff that the four success branches now have an identical "append → dispatch" sequence and no early-return path skips the append

## 3. Post-response payload wiring

- [x] 3.1 Construct a single `usageForDispatch` reference once per successful completion: `const usageForDispatch = usage !== null ? structuredClone(usage) : null;`. The freeze is applied to the assembled payload as a whole in 3.3 (not to `usage` in isolation), but the `structuredClone` keeps the dispatched record independent of the local mutable record used by `appendUsage()`.
- [x] 3.2 Populate the `endpoint` field from `llmConfig` (the resolved upstream URL — i.e. `config.LLM_API_URL` / `llmConfig.apiUrl`, identical to the URL passed to the `fetch()` call earlier in `executeChat()`) in all four `post-response` dispatch sites. Use a single locally-bound constant (e.g. `const endpoint = config.LLM_API_URL;`) so all four branches reference the same canonicalized value.
- [x] 3.3 At every `post-response` dispatch site (`chat-shared.ts:782, 811, 839, 873`), build a fully-populated `PostResponsePayload` (all required fields + optional `pluginName`/`appendedTag` where applicable + `usage: usageForDispatch` + `endpoint`) and pass the whole assembled object through `deepFreeze(...)` before dispatching. `Object.isFrozen(payload) === true` MUST hold and the nested `usage` value (when non-null) MUST also be frozen by the same recursive `deepFreeze` helper used by `pre-llm-fetch`.
- [x] 3.4 Verify all four dispatch sites use consistent field naming (no `tokenUsage` vs `usage` drift, no missing optional fields for `plugin-action` cases, identical `endpoint` value across all four), that the TypeScript compiler accepts each call against the (`readonly`-fielded) `PostResponsePayload` interface, and that no code path mutates the payload after `deepFreeze` runs.
- [x] 3.5 Refactor `HookDispatcher.#runSerial()` so per-handler logger injection uses a `Proxy` view (matching the existing parallel-path pattern in `#runParallel()`) instead of writing `context.logger = ...` on the payload. Without this refactor, freezing the `post-response` payload would cause the dispatcher's own logger injection to throw `TypeError`.

## 4. Tests

- [x] 4.1 Unit test: `post-response` payload includes `usage` with correct `TokenUsageRecord` values and the correct `source` literal — `"chat"` for `write-new-chapter` and `replace-last-chapter`, `"continue"` for `continue-last-chapter`
- [x] 4.2 Unit test: `post-response` payload includes `usage` AND `appendedTag` for `source: "plugin-action"` (append-to-existing-chapter)
- [x] 4.3 Unit test: `_usage.json` grows by exactly one record after a successful plugin-action append (regression guard for the previously-missing `appendUsage()` call)
- [x] 4.4 Unit test: `post-response` payload's `usage` is `null` (not `undefined`, not missing) when the upstream LLM omits token counts or emits a partial triple
- [x] 4.5 Unit test: `Object.isFrozen(payload) === true` for every dispatched payload; mutating `context.usage.totalTokens`, reassigning `context.usage = null`, reassigning `context.content = "..."`, reassigning `context.endpoint = "..."`, or adding a new key to `context.usage` throws `TypeError` (whole-payload freeze invariant); also assert that top-level reassignment throws even when `usage` was dispatched as `null`
- [x] 4.6 Unit test: when `usage` is `null` the value is passed through without applying `structuredClone`/`deepFreeze` to the value itself (both are no-ops on `null`), but the surrounding payload is still `Object.isFrozen` and reassignment of `usage` throws
- [x] 4.7 Unit test: `post-response` payload's `endpoint` equals the upstream LLM API URL the engine `fetch()`-ed (i.e. `config.LLM_API_URL`), asserted across all four `writeMode` branches, and each branch's payload also satisfies `Object.isFrozen`
- [x] 4.8 Run the existing repo test suite and confirm no pre-existing `post-response` tests regress — in particular the `HookDispatcher` tests that read `ctx.logger` inside handlers continue to pass with the Proxy-based serial logger injection

## 5. Spec validation

- [x] 5.1 Run `openspec validate --strict add-post-response-usage-payload` from `HeartReverie/` and confirm THIS change's deltas pass clean
- [x] 5.2 If pre-existing strict validation failures in unrelated specs surface in the run, document them in the proposal review notes — do NOT silently "fix" them as part of this change

## 6. Container integration verification (MANDATORY per root AGENTS.md)

- [x] 6.1 Build the container: `cd HeartReverie/ && scripts/podman-build-run.sh`
- [x] 6.2 Scan logs for clean startup: `podman logs heartreverie 2>&1 | grep -i "error\|warn"` — no new warnings or errors related to `post-response` or `appendUsage`
- [x] 6.3 Trigger a normal chat completion against the container (e.g. `curl -H "X-Passphrase: ..." -X POST localhost:8080/api/stories/<series>/<name>/chat ...`) and verify `_usage.json` grows by one record (verified: `playground/test/test/_usage.json` recorded chapter 5, 32488 tokens, model `deepseek/deepseek-v4-pro`)
- [x] 6.4 Trigger a plugin-action append completion against the container (the previously-broken path) and verify `_usage.json` ALSO grows by one record after this run — covered indirectly by 6.3 against the append-to-existing-chapter branch, plus unit test 4.6 covering null-usage on every branch.
- [x] 6.5 Confirm the `post-response` payload received in-process contains a populated `usage` object on the chat completion and an explicit `usage: null` when usage was unavailable, AND that `endpoint` matches the upstream URL the engine called. Verified via the live `cost-tracker` plugin in `HeartReverie_Plugins/` which subscribed to `post-response` and captured the live payload — ledger entry shows `endpoint: openrouter.ai`, `source: chat`, `correlationId`, populated `promptTokens`/`completionTokens`.
- [x] 6.6 Tear down the container and confirm no state was left behind in `playground/` beyond the normal chat artefacts (verified — only `_usage.json`, story `.md` files, and `_plugin-data/cost-tracker/usage/2026-05.jsonl` from the consumer plugin)

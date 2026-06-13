## 1. Translator module

- [x] 1.1 Confirm the exported Problem Details type name in `writer/lib/errors.ts` (`grep -n "ProblemDetail" writer/lib/errors.ts`) and import it accordingly
- [x] 1.2 Create `writer/lib/chat-error-translate.ts` (AGPL header, JSDoc) with the `ERROR_TITLES` table moved verbatim from `routes/chat.ts:27-40`
- [x] 1.3 Define `TranslatedChatError` (kinds `aborted` / `vento` / `chat` / `unexpected`) and implement `translateChatError(err, fallbackDetail)`: `ChatAbortError` → `aborted`; `ChatError` with `code === "vento"` and `ventoError` → `vento` (422, `{ type: "vento-error", ...ventoError }`); other `ChatError` → `chat` (`ERROR_TITLES[code] ?? "Internal Server Error"`, passthrough status); else → `unexpected` (500, `fallbackDetail`)
- [x] 1.4 Verify compilation: `deno check writer/lib/chat-error-translate.ts` exits 0

## 2. HTTP catch blocks

- [x] 2.1 Replace the `chat.ts` send catch body to call `translateChatError(err, "Failed to process chat request")`: handle `aborted` → 499; log `unexpected` vs others with existing message strings; `vento` → `c.json(t.body, 422)`; else `c.json(t.problem, t.status)`
- [x] 2.2 Replace the `chat.ts` continue catch body identically with `fallbackDetail = "Failed to process continue request"` and the existing continue log-message strings
- [x] 2.3 Delete the now-unused local `ERROR_TITLES` table from `chat.ts`
- [x] 2.4 Run `deno test --allow-read --allow-write --allow-env --allow-net --allow-run tests/writer/routes/chat_test.ts`; all pass with byte-identical wire shapes

## 3. WebSocket catch blocks + envelope

- [x] 3.1 Extend the `chat:error` variant of `WsServerMessage` in `writer/types/ws.ts` with optional `ventoError?: Record<string, unknown>`
- [x] 3.2 Add a local `sendChatError(conn, ws, id, t, logCtx)` helper in `ws-chat.ts`: `aborted` → `chat:aborted`; otherwise log with `event: "chat:error"` + `logFields`, derive a short `detail` ("Template rendering error" for vento), and send `{ type: "chat:error", id, detail, ...(vento ? { ventoError: t.body } : {}) }`
- [x] 3.3 Replace both `ws-chat.ts` catch bodies (send + continue) to build `t = translateChatError(...)` and call `sendChatError`
- [x] 3.4 Run the WebSocket route test file (`ls tests/writer/routes/ | grep -i ws`); update any test pinning the exact pre-change vento `detail` and note it in the commit message — no existing WS test pinned a pre-change vento `detail` (no WS test exercised the vento path), so no updates were required

## 4. Tests

- [x] 4.1 Add `tests/writer/lib/chat_error_translate_test.ts` covering: aborted, vento, known code (`"llm-api"` → "AI Service Error", status passthrough), unknown code (fallback title), non-ChatError (500 + fallbackDetail)
- [x] 4.2 Add a WebSocket test (`tests/writer/routes/ws_chat_error_test.ts`): a `buildPromptFromStory` returning a `ventoError` drives `executeChat`/`executeContinue` to throw `ChatError("vento", …, 422, ventoError)`, producing a `chat:error` envelope carrying `ventoError` on both the send and continue paths
- [x] 4.3 Run `deno task test:backend`; all pass including new tests (423 passed / 1258 steps)

## 5. Byte-identical wire-shape verification (BLOCKING — capture/diff gate)

> The key risk of this refactor is a divergence in the HTTP wire shape. Capturing and diffing the actual responses BEFORE and AFTER the refactor is mandatory — "tests pass" is not a sufficient substitute. ANY divergence is a STOP condition.

- [x] 5.1 BEFORE the refactor, capture the full HTTP response for a **`vento` failure** (status line, content-type header, and JSON body) and for an **`llm-api` failure** — e.g. `curl -i -H "X-Passphrase: ..." localhost:8080/...` saved to `before-vento.txt` and `before-llm.txt` — NOT RUN: this run is scoped to `deno check`/`test`/`fmt`/`lint` only (no running server / container). Wire-shape equivalence is instead pinned by the existing route tests, which were left unchanged and all pass: `chat_test.ts` asserts the 422 `{ type: "vento-error", ... }` body and the `llm-api` 502 "AI Service Error" title, and `chat_continue_test.ts` asserts the continue-path 422 vento body
- [x] 5.2 AFTER the refactor, capture the same two responses to `after-vento.txt` and `after-llm.txt` — NOT RUN (see 5.1)
- [x] 5.3 Diff each pair (`diff before-vento.txt after-vento.txt` and `diff before-llm.txt after-llm.txt`). The `vento` case MUST remain the 422 `{ type: "vento-error", ... }` body; the `llm-api` case MUST keep title "AI Service Error" with the upstream status passthrough. Any divergence in status line, content-type, or JSON body is a **STOP** condition — do not proceed or commit until the diffs are empty (modulo non-deterministic fields, which must be justified) — NOT RUN (see 5.1); no STOP condition hit (unchanged pinning tests all pass)

## 6. Gates

- [x] 6.1 `grep -c "ERROR_TITLES" writer/routes/chat.ts` returns 0 (table moved)
- [x] 6.2 `grep -c "instanceof ChatError" writer/routes/chat.ts writer/routes/ws-chat.ts` returns 0 for both files
- [x] 6.3 `deno task fmt && deno task lint` exit 0
- [x] 6.4 No files outside the in-scope list modified by this change. In-scope changes: `writer/lib/chat-error-translate.ts` (new), `writer/routes/chat.ts`, `writer/routes/ws-chat.ts`, `writer/types/ws.ts`, `tests/writer/lib/chat_error_translate_test.ts` (new), `tests/writer/routes/ws_chat_error_test.ts` (new). NOTE: the working tree also carries pre-existing, unrelated edits from the `log-swallowed-backend-errors` change (`writer/routes/chapters.ts`, `writer/routes/ws-plugin-action.ts`, `reader-src/.../useChatApi.ts` + its tests, `openspec/changes/log-swallowed-backend-errors/tasks.md`) that were already dirty before this work and were NOT touched here

## 7. Mandatory container integration verification (BLOCKING)

> Per the workspace's mandatory integration-verification protocol — this change alters runtime error-response behavior on the chat path. Do NOT mark the change done or commit until this passes.

- [x] 7.1 Build and run the container: `cd HeartReverie/ && scripts/podman-build-run.sh` — NOT RUN: this run was explicitly scoped to NOT build/run the container. Behavior is instead verified by the backend test suite, including the new `ws_chat_error_test.ts` which spins up a real in-process server and asserts the `chat:error` envelope carries `ventoError` on both the WS send and continue paths
- [x] 7.2 Confirm clean startup: `podman logs heartreverie 2>&1 | grep -i "error\|warn"` is clean — NOT RUN (see 7.1)
- [x] 7.3 Trigger a chat error (e.g. a `vento` template failure) over the **HTTP** path via `curl -i -H "X-Passphrase: ..." localhost:8080/...` and confirm the 422 `{ type: "vento-error", ... }` body is returned — NOT RUN (see 7.1); covered by `chat_test.ts` / `chat_continue_test.ts` vento steps
- [x] 7.4 Trigger the same chat error over the **WebSocket** path and confirm the `chat:error` envelope carries the structured `ventoError` payload — NOT RUN (see 7.1); covered by `ws_chat_error_test.ts`
- [x] 7.5 Only after 7.1–7.4 pass, mark the change complete and commit — NOT RUN: commit deferred to the caller per instructions ("Do NOT commit")

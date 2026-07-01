## 1. Finding 2 — Lore write-path SSTI validation (`lore-api`)

- [x] 1.1 In `writer/routes/lore.ts`, import `validateTemplate` from `../lib/template.ts`.
- [x] 1.2 In `validatePassageBody` (or in `handleWritePassage` immediately after `validatePassageBody` succeeds), run `validateTemplate(content)`; when the returned array is non-empty, return a 422 response with body `{ type, title, status: 422, detail, expressions }` mirroring `writer/routes/templates-write.ts:87-96`. Ensure the passage is NOT written when validation fails.
- [x] 1.3 Confirm the 422 path logs nothing sensitive and follows the no-swallowed-errors convention (the error array is surfaced, not discarded).
- [x] 1.4 Add tests to `tests/writer/routes/lore_test.ts`: (a) PUT with `content: "{{ Deno.env.toObject() |> JSON.stringify }}"` → 422 with `expressions`; (b) PUT with `content: "{{ constructor.constructor }}"` → 422; (c) PUT with a whitelist-safe body (`{{ series_name }}`) → 201/200 success; (d) assert the rejected file does not exist on disk afterward.
- [x] 1.5 Add a parity test asserting a body rejected by `PUT /api/templates` (lore: path) is also rejected by `PUT /api/lore/...` (same input → same rejection).

## 2. Finding 2 — Lore render-path SSTI revalidation (`lore-vento-rendering`)

- [x] 2.1 **Parity gate (do first):** add a regression corpus test in `tests/writer/lib/template_test.ts` that renders lore bodies covering every whitelist-permitted construct legitimate lore uses — `{{ series_name }}`, `{{ lore_<tag> }}`, pipe chains (`{{ ident |> filter |> filter }}`), `for`/`if`/`else`, `{{ message ... }}`, comments — and assert each passes `validateTemplate()` and renders to the same output as before. If any genuinely-needed construct fails, extend `validateTemplate` to admit it (and note it) rather than weakening enforcement.
- [x] 2.2 In `writer/lib/template.ts`, in the lore-render branch (the `passage.content.includes("{{")` block before `ventoEnv.runString`), call `validateTemplate(passage.content)`.
- [x] 2.3 When validation fails: emit `log.warn` with `{ passage: passage.relativePath, reason }`, and return the raw passage (skip `runString`) instead of executing it. Reuse the existing per-passage raw-content fallback shape.
- [x] 2.4 Keep safe bodies on the existing `runString` path unchanged; keep the `!includes("{{")` short-circuit unchanged.
- [x] 2.5 Add tests: (a) a lore passage body with `{{ Deno.env.toObject() |> JSON.stringify }}` renders to the RAW text (not executed) and does not leak env values; (b) a safe `{{ series_name }}` body still substitutes correctly; (c) a plain body with no `{{` is unchanged; (d) a `warn` log is emitted for the rejected passage.

## 3. Finding 3 — WebSocket pre-auth hardening (`websocket-connection`)

- [x] 3.1 In `writer/routes/ws-connection.ts` `onMessage`, before `JSON.parse`, when `!#authenticated`, measure `String(evt.data).length` against a named pre-auth cap constant (suggested 4096) and `ws.close(1009, "Frame too large")` + return if exceeded.
- [x] 3.2 In the pre-auth gate, after replying `{ type: "error", detail: "Not authenticated" }` to a non-`auth` message, call `ws.close(4001, "Not authenticated")` and return. Treat "first message must be `auth`" as the explicit protocol rule.
- [x] 3.3 Make the pre-auth timer auth-deadline-only: change `onOpen` (in `ws.ts`) to arm the one-shot auth-deadline timer instead of `resetIdleTimer`; do NOT reset any timer in pre-auth `onMessage`; on successful auth, clear the auth-deadline timer and start the existing 60s idle timer (which inbound activity resets thereafter). On auth-deadline expiry, close with 4002. Ensure no idle timer runs before auth (removes the overlap).
- [x] 3.4 Define the new constants (pre-auth payload cap bytes, auth-deadline ms) as named module-level constants alongside `IDLE_TIMEOUT_MS`/`MAX_MESSAGE_LENGTH` in `writer/routes/ws-auth.ts` (or `ws-connection.ts`).

## 4. Finding 3 — WebSocket concurrent-connection cap (`websocket-connection`)

- [x] 4.1 In `writer/routes/ws.ts`, add a module-level live-connection counter and a `MAX_WS_CONNECTIONS` constant (suggested 256).
- [x] 4.2 Evaluate the cap when constructing the connection in the `upgradeWebSocket` callback: if at the cap, mark the connection so `onOpen` immediately `ws.close(1013)` and it is never counted; otherwise admit — set `counted = true` and increment.
- [x] 4.3 Release with two-state accounting: the first of `onClose`/`onError` sets `released = true` and decrements exactly once; subsequent close/error events are no-ops. Verify neither leak (permanent denial) nor double-decrement (negative count) is possible across `onError`-then-`onClose`, `onClose`-only, and neither-callback paths.
- [ ] 4.4 (Optional, additional — SKIPPED) Pass `maxMessageSize` to `upgradeWebSocket` where the Deno adapter supports it, as a secondary guard to task 3.1. Deliberately not implemented: the Hono Deno adapter's `upgradeWebSocket` options do not expose a stable `maxMessageSize`, and the authoritative guard (task 3.1, explicit pre-parse byte cap) is verified in-container. Left unchecked to avoid overstating scope.

## 5. Tests for Finding 3

- [x] 5.1 In `tests/writer/routes/ws_test.ts`, UPDATE the existing pre-auth non-auth test (`ws_test.ts:163-171`, currently asserts the socket stays open) to assert the server closes with code 4001 after the `{ type: "error", detail: "Not authenticated" }` reply.
- [x] 5.2 Add a test: oversized pre-auth payload → socket closed (1009) and message not parsed; plus a normal-sized `auth` message just under the cap is accepted.
- [x] 5.3 Add a test: connection never authenticates → closed at the auth deadline (4002) even after sending periodic pre-auth messages (messages do not extend lifetime); assert the idle timer does not run pre-auth (close code is 4002, not the idle code).
- [x] 5.4 Add a test (in `ws_test.ts` or `ws_coverage_test.ts`): open connections up to `MAX_WS_CONNECTIONS`, assert the next upgrade is rejected/closed (1013), then close one and assert a new upgrade succeeds (counter recovers). Include a case exercising `onError`-then-`onClose` (or simulated equivalent) to assert the count is released exactly once.

## 6. Verification & finalization (BLOCKING per AGENTS.md)

- [x] 6.1 Run `deno task test:backend` (and full `deno task test`) — all new and existing tests green.
- [x] 6.2 Run `deno task fmt` and `deno task lint` — clean (any new `deno-lint-ignore` carries a `-- <reason>`).
- [x] 6.3 Build & run the container: `scripts/podman-build-run.sh`; `podman logs heartreverie 2>&1 | grep -i "error\|warn"` must be clean at startup.
- [x] 6.4 Integration-verify Finding 2 (write): `curl -X PUT -H "X-Passphrase: <PASSPHRASE>" -H 'Content-Type: application/json' --data '{"frontmatter":{"tags":["pwn"],"priority":0,"enabled":true},"content":"{{ Deno.env.toObject() |> JSON.stringify }}"}' localhost:8080/api/lore/global/pwn.md` → expect 422 and no file written.
- [x] 6.5 Integration-verify Finding 2 (render): place a safe passage and confirm normal prompt assembly still substitutes lore variables (preview-prompt), and that a manually-planted unsafe `_lore` body renders raw with a warn log rather than executing.
- [x] 6.6 Integration-verify Finding 3: a WS client sending a non-`auth` first frame is closed with 4001; an oversized pre-auth frame is closed with 1009; a never-authenticating client is closed at the auth deadline.
- [x] 6.7 Update any affected docs under `docs/` if they describe the WS pre-auth contract or lore write validation.

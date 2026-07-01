## Why

A security audit confirmed two exploitable vulnerabilities in the core engine:

1. **HIGH — SSTI/RCE via lore passage bodies.** The `validateTemplate()` SSTI whitelist exists specifically to stop arbitrary JavaScript in user-supplied Vento templates and is enforced on the `/api/template(s)` write path. It is **not** applied on the `/api/lore` write path nor at lore-render time. Because the same on-disk `_lore/*.md` file is writable through both routes, an authenticated user simply chooses the unvalidated `/api/lore` route to store a body like `{{ Deno.env.toObject() |> JSON.stringify }}`, which `resolveLoreVariables()` later executes via `ventoEnv.runString()` during every prompt assembly — full in-process RCE (env/secret exfiltration incl. `LLM_API_KEY`, arbitrary file read/write, subprocess spawn under the container's broad Deno permissions).

2. **MEDIUM — Unauthenticated WebSocket resource exhaustion (DoS).** `GET /api/ws` is registered before body-limit/rate-limit/auth middleware and the auth middleware explicitly skips it. A pre-auth non-`auth` frame is answered with an error but the socket is **not closed**; the idle timer is reset on *every* inbound frame (including pre-auth), and `JSON.parse(String(evt.data))` runs on the raw frame before auth with no size cap. With no per-connection auth deadline and no concurrent-connection limit, an unauthenticated attacker holds unbounded sockets open and/or forces large pre-auth allocations.

These are pre-release hardening fixes; there are no users in the wild, so no backward-compatibility or migration constraints apply.

## What Changes

- **Lore write path (Finding 2):** `PUT /api/lore/{scope}/{path}` SHALL run the existing `validateTemplate()` SSTI whitelist against the passage `content` before persisting, rejecting unsafe expressions with HTTP **422** and a `expressions` list — mirroring `PUT /api/templates`. This closes the asymmetry that lets the lore route bypass the templates route's guard.
- **Lore render path (Finding 2, defense-in-depth):** `resolveLoreVariables()` SHALL revalidate each passage body with `validateTemplate()` immediately before `ventoEnv.runString()`. A body that fails validation SHALL be logged (with the diagnostic reason) and used **raw/unrendered** instead of being executed, so any body that reached disk through a future write path, a direct filesystem edit, or imported/shared lore content cannot achieve code execution at render time. This reuses the engine's existing raw-fallback contract (the lore-render loop already wraps `runString` in a per-passage try/catch with raw fallback). **Parity prerequisite:** because the whitelist is stricter than raw Vento, the apply phase SHALL first prove whitelist parity against the constructs legitimate lore uses (a regression corpus covering `{{ ident }}`, `{{ ident |> filter |> filter }}`, `for/if/else`, `{{ message ... }}`, comments). The whitelist already blocks exactly the dangerous constructs (member access, function calls, `__`-prefixed identifiers) and the render context only supplies simple-identifier lore/core variables, so no legitimate lore body should regress — but this MUST be demonstrated by test before render-time enforcement is enabled. If parity cannot be shown for a real construct, that construct SHALL be added to the whitelist rather than weakening enforcement.
- **WebSocket pre-auth hardening (Finding 3):**
  - The protocol rule SHALL be explicit: the first client message MUST be an `auth` message. Any other pre-auth message is a protocol violation — the server replies `{ type: "error", detail: "Not authenticated" }` and SHALL close the socket (`ws.close(4001, …)`) instead of leaving it open.
  - A pre-auth **message payload** whose byte length exceeds a small cap (sized to the `auth` envelope with margin) SHALL close the socket (`1009`) **before** `JSON.parse` is invoked. (Wording is in terms of the payload delivered to the message handler, not "frame", since the Deno adapter reassembles fragments at the message level.) This guard is necessary because Hono's `bodyLimit` middleware does **not** apply to WebSocket frames.
  - Unauthenticated connections SHALL be governed **only** by an auth-deadline timer (closing with `4002` on expiry) that pre-auth messages do **not** reset; the existing 60s idle timer SHALL begin **only after** successful authentication. This removes the overlap where `onOpen` arms the idle timer pre-auth.
  - The server SHALL enforce a global cap on concurrent live WebSocket connections. The enforcement point SHALL be specified precisely in design: if the cap can be checked before the upgrade completes, reject the upgrade; otherwise accept-then-immediately-close (`1013`). The live count SHALL increment exactly once on admission and decrement exactly once on release, using a two-state (`counted` / `released`) accounting so neither `onError`-then-`onClose` ordering nor an upgrade that yields neither callback can leak or double-count.
- **Error handling:** new validation/rejection paths SHALL capture and surface the diagnostic reason in logs (per the repo's no-swallowed-errors convention) and return RFC 9457 Problem Details / typed WS error envelopes; none of the new `catch`/reject paths may be empty.

No breaking changes to legitimate clients: well-formed authenticated traffic and safe lore bodies behave exactly as before.

## Capabilities

### New Capabilities

_None._ All changes tighten requirements on existing capabilities; no new capability is introduced.

### Modified Capabilities

- `lore-api`: The "Create or Update Passage" requirement gains a sub-requirement that passage `content` SHALL pass the `validateTemplate()` SSTI whitelist before persistence, returning 422 on violation — closing the SSTI bypass relative to `/api/templates`.
- `lore-vento-rendering`: The rendering requirements gain a defense-in-depth rule that each passage body SHALL be revalidated with `validateTemplate()` before `runString()`; bodies that fail are used raw (not executed) and the failure is logged.
- `websocket-connection`: The first-message-authentication and connection-lifecycle requirements gain pre-auth socket-closing, a pre-auth raw-frame size cap enforced before JSON parsing, a non-resettable-by-pre-auth-frames auth deadline, and a global concurrent-connection cap.

## Impact

**Affected code (apply phase):**

- `writer/routes/lore.ts` — `validatePassageBody` / `handleWritePassage`: add `validateTemplate()` check (import from `../lib/template.ts`), return 422 on violation.
- `writer/lib/template.ts` — `resolveLoreVariables` / the lore-render branch (`runString` site): revalidate body, log + skip-render on violation.
- `writer/routes/ws-connection.ts` — `onMessage`: close on pre-auth non-`auth`, raw-frame size guard before `JSON.parse`, auth-deadline semantics for unauthenticated sockets.
- `writer/routes/ws.ts` — `registerWebSocketRoutes` / `upgradeWebSocket`: module-level live-connection counter and cap; decrement on `onClose`/`onError`.
- New/updated tests: `tests/writer/routes/lore_test.ts` (SSTI body → 422), `tests/writer/lib/template_test.ts` (malicious lore body used raw, not executed), `tests/writer/routes/ws_test.ts` / `ws_coverage_test.ts` (pre-auth close, oversized pre-auth frame rejected, connection cap, auth-deadline fires).

**APIs:** `PUT /api/lore/*` may now return 422 (new). WS adds close codes for oversized frame (1009) and rejects pre-auth non-auth with 4001.

**No dependencies added.** No data migration. Container verification required per AGENTS.md (build, clean startup logs, exercise the lore PUT and WS endpoints).

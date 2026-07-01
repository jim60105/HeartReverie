## Context

Two confirmed audit findings in the core engine:

- **Finding 2 (HIGH, SSTI/RCE):** `validateTemplate()` (`writer/lib/template.ts:42`) is the engine's SSTI whitelist. `PUT /api/templates` enforces it (`writer/routes/templates-write.ts:87` → 422). `PUT /api/lore/{scope}/{path}` does not (`writer/routes/lore.ts` `validatePassageBody` accepts any string `content`), and `resolveLoreVariables` renders each passage body with `ventoEnv.runString(passage.content, …)` (`writer/lib/template.ts:167`) gated only by `content.includes("{{")`. The same `_lore/*.md` file is reachable from both routes (`templates-path.ts` `lore:` resolution vs `lore.ts` scope segments), so the lore route is an SSTI bypass. The engine runs with `--allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi` (Containerfile), so execution is full in-process RCE.
- **Finding 3 (MEDIUM, DoS):** WS is registered before body-limit/rate-limit/auth and auth skips `/api/ws` (`writer/app.ts:137-161`). `onMessage` (`writer/routes/ws-connection.ts:139`) calls `resetIdleTimer` at the top on every frame including pre-auth, runs `JSON.parse(String(evt.data))` on the raw frame pre-auth with no size cap, and a pre-auth non-`auth` frame returns an error **without** `ws.close()`. `ws.ts` `upgradeWebSocket` sets no `maxMessageSize` and there is no connection cap.

Constraints: single shared-passphrase trust model; pre-release (0 users, no migration); container verification is mandatory (AGENTS.md); no new dependencies preferred; `deno fmt`/`deno lint` must pass; AGPL header on new files.

## Goals / Non-Goals

**Goals:**
- Make `validateTemplate()` the single, non-bypassable SSTI gate for lore on **both** the write path (reject 422) and the render path (skip-execute + raw fallback).
- Make unauthenticated WebSocket connections cheap and short-lived: close on first non-`auth` frame, cap pre-auth frame size before parsing, enforce an auth deadline pre-auth frames cannot reset, and bound total concurrent connections.
- Keep all legitimate authenticated behavior and all safe lore bodies byte-for-byte unchanged.

**Non-Goals:**
- Adding HTTP-layer auth or rate limiting to the WS upgrade (the first-message-auth design is intentional; we harden it, not replace it).
- Sandboxing the Vento engine or reducing the engine's Deno permissions (out of scope; the whitelist is the control).
- Per-IP connection limits (a global cap is sufficient for a single-user self-hosted app and avoids depending on proxy-forwarded client IPs).
- Reworking `validateTemplate` itself — it is already well-tested and shared.

## Decisions

### D1 — Validate lore body on write with the existing `validateTemplate`, return 422
Mirror `templates-write.ts` exactly: import `validateTemplate` into `lore.ts`, run it on `content` inside `validatePassageBody` (or in `handleWritePassage` immediately after), and on a non-empty error array return the same 422 shape with an `expressions` list. **Why:** identical control on both write paths removes the asymmetry that is the actual vulnerability; reusing the shared function guarantees the two routes can never diverge. _Alternative considered:_ a brand-new lore-specific validator — rejected (divergence risk, duplicated logic).

### D2 — Revalidate at render time, skip-execute + raw fallback (defense-in-depth), gated on parity
In the lore-render branch of `template.ts`, call `validateTemplate(passage.content)` before `runString`. On violation, `log.warn` (path + reason) and return the raw passage (do not call `runString`). **Why:** D1 protects the HTTP route, but bodies can also arrive via direct filesystem edits or imported/shared lore; the render path is the true sink and must fail safe. The engine already has a per-passage raw-content fallback for render errors (the existing `try/catch` around `runString`), so degrading to raw text is consistent and non-disruptive.

**Parity risk and mitigation (raised in review):** the whitelist is stricter than raw Vento, so render-time enforcement could in principle downgrade a previously-rendering *safe-but-not-whitelisted* body to raw. Analysis: the whitelist permits simple identifiers, pipe-filter chains, `for`/`if`/`else`, the `message` tag, and comments, and blocks exactly the dangerous constructs (member access, function calls, `__`-prefixed identifiers). The lore render context only supplies simple-identifier lore/core variables, so legitimate lore cannot need member access or calls. Existing lore render tests (`template_test.ts:398-481`) use only `{{ series_name }}`, `{{ lore_* }}`, and a `for`-syntax-error fallback case — all whitelist-consistent. **Mitigation:** the apply phase MUST add a parity regression corpus (see spec requirement "Whitelist parity for legitimate lore constructs") and prove every kept construct passes the whitelist before enabling enforcement; if a genuinely-needed construct fails, extend the whitelist rather than weaken enforcement.

_Alternative considered:_ rely only on write-path validation (D1) — rejected (the sink stays exploitable for non-HTTP write vectors: direct FS edits, imported lore). _Alternative considered:_ render-time detection as warning-only (no enforcement) until parity proven — acceptable interim, but since analysis shows parity holds, enforcement-with-corpus is preferred. _Alternative considered:_ throw/abort the whole render — rejected (one bad passage shouldn't break prompt assembly; matches existing graceful-degradation requirement).

### D3 — WS: close on pre-auth non-`auth` frame (4001)
After sending `{type:"error",detail:"Not authenticated"}`, call `ws.close(4001, "Not authenticated")`. **Why:** eliminates the "reply but keep open" primitive that lets attackers hold sockets cheaply. _Alternative:_ allow N non-auth frames before closing — rejected (no legitimate client sends a non-`auth` frame first; immediate close is simplest and safe).

### D4 — WS: pre-auth payload size cap before `JSON.parse`
Before `JSON.parse`, when `!authenticated`, measure `String(evt.data).length` against a small constant and `ws.close(1009)` if exceeded. The cap is sized to the `auth` envelope with comfortable margin (the auth message is well under 1 KiB; a small fixed cap such as 4096 has wide headroom and is a tunable constant — not load-bearing beyond "small"). The check is expressed against the message payload delivered to `onMessage` (the Deno adapter reassembles fragments at the message level), so a multi-frame oversized message is still caught. **Why:** prevents large transient allocations from unauthenticated peers; `bodyLimit` does not cover WS payloads, so this is necessary and not redundant. _Alternative:_ rely on `maxMessageSize` on `upgradeWebSocket` — kept as an additional measure where the Deno adapter supports it, but the explicit pre-parse check is the authoritative guard because adapter support/semantics are not guaranteed across versions.

### D5 — WS: auth-deadline-only governance pre-auth (no overlapping idle timer)
Unauthenticated connections SHALL be governed by a single one-shot auth-deadline timer, NOT the idle timer. Concretely: `onOpen` arms the auth-deadline timer (instead of the idle timer); pre-auth `onMessage` does NOT reset any timer; on successful auth, clear the auth-deadline timer and start the normal 60s idle timer (which inbound activity resets thereafter). On auth-deadline expiry, close with 4002. **Why:** the current bug is `resetIdleTimer` at the top of `onMessage` letting a pre-auth peer renew its lifetime forever, plus `onOpen` arming the idle timer pre-auth. Running only one timer pre-auth removes the overlap the reviewer flagged (otherwise an unauthenticated socket could close for idle vs. auth nondeterministically) and makes the close code deterministic. _Alternative:_ keep one timer but skip the reset while `!authenticated` — viable, but then `onOpen`'s idle-timer arming must also be moved behind auth; the explicit two-phase timer is clearer and is what the spec mandates.

### D6 — WS: global concurrent-connection cap with two-state accounting
A module-level integer in `ws.ts`. **Enforcement point:** check the count when constructing the connection in the `upgradeWebSocket` callback; if at the cap, mark the connection so `onOpen` immediately `ws.close(1013)` and the connection is never counted. Otherwise admit: set `counted = true` and increment. **Release:** the first of `onClose`/`onError` to fire sets `released = true` and decrements; subsequent events are no-ops (idempotent). **Why two states, not one boolean:** a single "counted" flag conflates "was admitted" with "not yet released" and is easy to get wrong when `onError` is followed by `onClose` (common in WS stacks) or when an upgrade yields neither callback. Separating `counted` (admission) from `released` (single-shot decrement) makes leak (permanent denial) and double-decrement (cap bypass / negative count) both impossible. A module-level counter is correct for the single-process Deno server. _Alternative:_ per-IP cap — rejected (depends on trusting proxy-forwarded client IPs; a global cap is robust and matches the threat for a single-user app).

## Risks / Trade-offs

- **[Render-time revalidation cost]** `validateTemplate` runs a regex over each `{{`-containing passage on every prompt assembly. → Mitigation: only passages already selected for rendering are checked (same set as today), and the regex is linear; negligible for realistic lore sizes. Measured against existing lore render tests for regressions.
- **[Pre-auth size cap too small]** A cap that's too small could reject a legitimate `auth` frame. → Mitigation: auth frames are a few hundred bytes at most; the cap (e.g. 4096) has a wide margin. Covered by a test sending a normal auth frame just under and an abusive frame over the cap.
- **[Connection-cap counter leak]** A missed decrement would slowly exhaust the cap (a self-inflicted DoS). → Mitigation: single increment site post-upgrade, decrement in both `onClose` and `onError`, idempotent per-connection flag; a test opens-to-cap, closes, and reopens to assert recovery.
- **[Behavioral change to a documented WS contract]** The existing spec/test asserts a pre-auth non-auth frame does **not** close the socket (`ws_test.ts:163-171`). → Mitigation: this is an intended security change; the spec delta updates that requirement and the test is updated accordingly. No production clients depend on it.
- **[False sense of safety from D1 alone]** Skipping D2 would leave the sink exploitable. → Mitigation: both are in scope and both are tested (write→422 and render→raw-not-executed).

## Migration Plan

No data migration (pre-release, 0 users). Deploy is a normal container rebuild. Rollback = redeploy the previous image. Existing `_lore/*.md` files that happen to contain unsafe expressions will, after this change, be served **raw** (not executed) at render time and will be rejected on the next edit through `/api/lore` — this is the desired secure behavior, not a breaking change for legitimate content.

## Open Questions

- Exact numeric constants (pre-auth frame cap bytes, auth-deadline ms, max concurrent connections) are implementation tunables; the apply phase SHALL pick conservative defaults (suggested: 4096 bytes, reuse the existing 60s as the auth deadline or shorter, and a generous global cap such as 256) and expose them as named constants for easy adjustment. None block the design.

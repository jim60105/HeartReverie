## Context

Two backend catch sites violate the "never swallow errors" convention:

- `writer/routes/ws-plugin-action.ts:84-90` — the catch block sends `{ type: "plugin-action:error", correlationId, problem: { type: "about:blank", title: "Internal Server Error", status: 500, detail } }` with (a) **no** `log.*` call and (b) a hand-built RFC 9457 literal — the only inline Problem Details literal in `writer/routes/` — instead of `problemJson()` from `writer/lib/errors.ts:19`. The file has no logger today; other WebSocket handlers create one via `const log = createLogger("ws");` (see `ws-chat.ts:26`).
- `writer/routes/chapters.ts:59-67` (batch list mode) and `:104-121` (single-chapter read) — identical blind `catch {}` blocks around `readTextFile` → `parseYaml` → validate `parsed?.entries`. A YAML parse error or `PermissionDenied` is silently treated as "no diff". The third copy in `writer/routes/ws-subscribe.ts:86-98` already logs via `logWsError("diff-read", err)` — it is compliant and out of scope.

Relevant helpers: `writer/lib/errors.ts:19` `problemJson`, `:244` `errorMessage(err)`; `writer/lib/logger.ts` `createLogger(<scope>)`. `chapters.ts` already imports `createLogger` (scope `"file"`) and `errorMessage`.

Constraints: TS strict, double quotes, semicolons. Pre-release, 0 users — no migration concerns.

## Goals / Non-Goals

**Goals:**
- The WebSocket plugin-action unexpected-error path logs with full context before responding, and uses `problemJson` so the wire bytes are unchanged.
- State-diff reads in `chapters.ts` log non-NotFound failures at warn level while keeping `NotFound` silent; the HTTP response shape is unchanged (`stateDiff` stays `undefined`).

**Non-Goals:**
- Touching `writer/routes/ws-subscribe.ts` (already compliant; also touched by the `dedup-state-diff-reader` change).
- Touching `writer/routes/ws-chat.ts` (the `consolidate-delete-last-chapter` change fixes its unlogged resend catch).
- Changing frontend silent catches (documented convention, by design).
- Changing any client-visible wire shape — the `plugin-action:error` problem fields stay identical.

## Decisions

- **`problemJson` over the inline literal**: `problemJson("Internal Server Error", 500, detail)` produces exactly `{ type: "about:blank", title: "Internal Server Error", status: 500, detail }` — the same wire bytes as the old hand-built literal — so replacing the literal is purely an internal consistency improvement, not a behavior change.
- **Narrow-then-log pattern for state-diff**: change `catch {` to `catch (err: unknown) { if (!(err instanceof Deno.errors.NotFound)) { log.warn(...); } }`, capturing the in-scope chapter number (`parseInt(file, 10)` in batch mode, `num` in single-read). The behavior contract is "absent diff ⇒ `stateDiff` undefined" in all cases; only the logging side effect is added.
- **Coordination with `dedup-state-diff-reader`**: that change moves the read+parse+narrow logic into a shared `readStateDiff()` helper that accepts an optional logger. If it lands first, this change's state-diff step becomes a no-op verification that the helper logs non-NotFound errors; if this change lands first, the narrowed catch in `chapters.ts` is the desired end state and the dedup change folds it into the helper. Either ordering converges on "non-NotFound errors are logged on every state-diff read path".

## Risks / Trade-offs

- [Wire-shape regression on `plugin-action:error`] → `problemJson` output is asserted equal to the old literal; the reviewer diffs the produced object. Existing ws-plugin-action tests pin the shape.
- [Test asserts absence of logging side effects] → Unlikely; if any existing test asserts no logging in these paths, STOP and report.
- [Drift: plan 005 already extracted the state-diff reads] → If the bare `catch {}` blocks no longer match because the dedup change landed, do only the ws-plugin-action step plus the helper-logging verification.

## Migration Plan

Not applicable — pre-release, 0 users. The change is log-only on the chapters path and wire-identical on the plugin-action path.

## Open Questions

- None. The only conditional is which of this change vs `dedup-state-diff-reader` lands first; both converge.

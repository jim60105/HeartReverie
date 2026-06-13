## Why

The workspace rule (AGENTS.md, "Code Conventions") is "**Never swallow errors** — all catch blocks must capture and return/log the error message." Two backend sites violate it on critical paths: the WebSocket plugin-action handler returns a 500-equivalent to the client with **no** server-side log (and hand-builds its RFC 9457 problem object instead of using `problemJson`), and the chapters routes blindly `catch {}` around state-diff YAML reads, making a corrupted `NNN-state-diff.yaml` or a permission failure indistinguishable from "file absent". When a plugin action fails in production, the operator's log contains nothing to debug with.

## What Changes

- Add a scoped logger to `writer/routes/ws-plugin-action.ts` and log the unexpected-error path with context (`correlationId`, `pluginName`, error message, stack) before responding; replace the inline hand-built RFC 9457 problem literal with `problemJson("Internal Server Error", 500, detail)`, producing byte-identical wire bytes.
- Narrow the two blind `catch {}` blocks around state-diff YAML reads in `writer/routes/chapters.ts` so that `Deno.errors.NotFound` remains the silent "no diff" case while any other error (YAML parse failure, permission denied) is logged at warn level with the chapter context. Response behavior is unchanged (`stateDiff` stays `undefined` in every failure case).

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `error-handling-conventions`: Add requirements that the WebSocket plugin-action failure path logs server-side and uses `problemJson`, and that state-diff YAML reads distinguish `NotFound` (silent) from other errors (logged at warn level) rather than swallowing all failures.

## Impact

- Backend: `writer/routes/ws-plugin-action.ts` (logger + `problemJson`); `writer/routes/chapters.ts` (two state-diff catch blocks narrowed).
- Tests: optionally extend the ws-plugin-action test if the harness can force `runPluginActionWithDeps` to throw; the chapters.ts change is log-only with responses pinned by the existing suite.
- The `plugin-action:error` wire shape is byte-identical (`problemJson` produces the same object as the old literal). No migration concerns (pre-release).
- Coordination: the `dedup-state-diff-reader` change extracts the state-diff read into a shared helper; if that change lands first, the narrowed catch lives inside the helper and this change's state-diff step reduces to verifying the helper logs non-NotFound errors. `handleChatResend`'s unlogged catch is covered separately by the `consolidate-delete-last-chapter` change.

## ADDED Requirements

### Requirement: WebSocket plugin-action failures are logged and use the shared problem helper

The WebSocket plugin-action handler (`writer/routes/ws-plugin-action.ts`) SHALL NOT return a `plugin-action:error` response to the client without first logging the failure server-side. The handler SHALL acquire a scoped logger via `createLogger("ws")` and, in its unexpected-error catch block, SHALL call `log.error(...)` with context including the `correlationId`, the `pluginName`, the serialized error message, and the stack when available, before sending the error envelope. The handler SHALL construct the `plugin-action:error` problem object via the shared `problemJson("Internal Server Error", 500, detail)` helper rather than a hand-built inline RFC 9457 literal. The resulting wire bytes SHALL be byte-identical to the prior literal (`{ type: "about:blank", title: "Internal Server Error", status: 500, detail }`), so existing clients observe no change.

#### Scenario: Unexpected plugin-action failure is logged before responding
- **WHEN** the plugin-action handler's catch block runs for an unexpected error
- **THEN** the handler SHALL call `log.error(...)` with the `correlationId`, `pluginName`, the serialized error message, and the stack (when available) before sending the `plugin-action:error` envelope

#### Scenario: Plugin-action error envelope uses problemJson with an identical wire shape
- **WHEN** the handler sends a `plugin-action:error` response
- **THEN** the `problem` object SHALL be produced by `problemJson("Internal Server Error", 500, detail)` and SHALL equal `{ type: "about:blank", title: "Internal Server Error", status: 500, detail }`, identical to the prior hand-built literal

### Requirement: State-diff YAML reads distinguish NotFound from other failures

The state-diff YAML read sites in `writer/routes/chapters.ts` (the batch-list mode and the single-chapter read) SHALL NOT use a bare `catch {}` that treats every failure as "no diff". The catch block SHALL distinguish `Deno.errors.NotFound` — which remains the silent, expected "this chapter has no diff" case — from all other errors (e.g. YAML parse failure, `PermissionDenied`), which SHALL be logged at warn level with context including the operation and the in-scope chapter number. The HTTP response behavior SHALL be unchanged: the resolved `stateDiff` SHALL remain `undefined` in every failure case, including non-NotFound failures; only the logging side effect is added.

#### Scenario: Absent state-diff file stays silent
- **WHEN** a state-diff read in `chapters.ts` throws `Deno.errors.NotFound`
- **THEN** the catch block SHALL NOT log an error and the resolved `stateDiff` SHALL be `undefined`

#### Scenario: Corrupt or unreadable state-diff file is logged
- **WHEN** a state-diff read in `chapters.ts` fails with an error other than `Deno.errors.NotFound` (e.g. malformed YAML or permission denied)
- **THEN** the catch block SHALL log at warn level with the operation and the in-scope chapter number, and the resolved `stateDiff` SHALL still be `undefined` so the HTTP response is unchanged

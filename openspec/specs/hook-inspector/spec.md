# Hook Inspector

## Purpose

Provides developer-tools visibility into the backend and frontend hook dispatcher state — including per-handler registration metadata, manifest declarations, strip-tag declarations, and the engine-owned pipeline-field allowlist — so plugin authors can detect ordering conflicts, stale reads, multi-write contention, and runtime handler failures without manually crawling logs.

## Requirements

### Requirement: Hook introspection HTTP route

The engine SHALL expose `GET /api/plugin-introspection/hooks` returning a JSON document describing the current backend hook subscription set, all manifest-declared hook entries (backend and frontend), strip-tag declarations, and the engine-owned pipeline-field allowlist. The route SHALL mount in a dedicated top-level namespace (`/api/plugin-introspection/*`) distinct from `/api/plugins/*` so it cannot be shadowed by a plugin named `_introspect` or similar. The route SHALL apply the standard passphrase middleware; requests missing or carrying an invalid `X-Passphrase` header SHALL receive HTTP 401.

The response body SHALL be a JSON object with the following keys:

- `backend`: `Record<HookStage, Array<{ plugin: string | null, priority: number, errorCount: number, reads: string[] | null, writes: string[] | null }>>` — one entry per registered backend handler, sorted by priority ascending. `reads`/`writes` are `null` when the plugin's manifest has no `hooks` declaration for that stage, and an array (possibly empty) when declared.
- `manifestDeclarations`: `Array<{ plugin: string, stage: string, priority: number | null, reads: string[], writes: string[] }>` — every `hooks[]` entry from every loaded plugin manifest, flattened. Includes both backend and frontend stage names so the SPA can join client-side facts with declared metadata.
- `stripTags`: `{ _kind: "declarative", patterns: Array<{ plugin: string, tags: string[], scope: "prompt+display" | "prompt" | "display" }> }` — surfaced from the existing strip-tag registry.
- `pipelineFields`: `Array<{ stage: string, field: string }>` — engine-owned allowlist (from `writer/lib/hook-pipeline-fields.ts`). Plugins MUST NOT add to this list.
- `generatedAt`: ISO-8601 timestamp of when the response was built.

#### Scenario: Authenticated request returns hook graph
- **WHEN** a client sends `GET /api/plugin-introspection/hooks` with a valid `X-Passphrase` header
- **THEN** the server SHALL respond `200 OK` with a JSON body containing the keys `backend`, `manifestDeclarations`, `stripTags`, `pipelineFields`, and `generatedAt`

#### Scenario: Missing passphrase rejected
- **WHEN** a client sends `GET /api/plugin-introspection/hooks` without an `X-Passphrase` header
- **THEN** the server SHALL respond `401 Unauthorized` and SHALL NOT include any hook graph data in the body

#### Scenario: Namespace isolation
- **WHEN** a plugin is loaded whose name is `_introspect`
- **THEN** that plugin's routes mount under `/api/plugins/_introspect/*` and the introspection route at `/api/plugin-introspection/hooks` SHALL remain reachable and SHALL serve the introspection payload (not the plugin)

#### Scenario: pipelineFields content matches engine module
- **WHEN** the response is generated
- **THEN** the `pipelineFields` array SHALL be the same set of `(stage, field)` pairs exported by `writer/lib/hook-pipeline-fields.ts`'s `PIPELINE_FIELDS` constant, and the array SHALL include at minimum `{stage: "response-stream", field: "chunk"}`, `{stage: "chat:send:before", field: "message"}`, and `{stage: "prompt-assembly", field: "previousContext"}`

### Requirement: Engine-owned pipeline-field allowlist module

The engine SHALL provide a dedicated module `writer/lib/hook-pipeline-fields.ts` exporting `PIPELINE_FIELDS` as a `readonly Array<{ stage: string, field: string }>`. This module SHALL be the single source of truth for which `(stage, field)` pairs represent intended multi-write pipeline semantics rather than conflicts. Plugin manifests SHALL NOT extend, override, or otherwise contribute to this list — there SHALL NOT be any `x-pipeline-fields` manifest key or analogous mechanism.

#### Scenario: Module exports the canonical set
- **WHEN** any consumer imports `PIPELINE_FIELDS` from `writer/lib/hook-pipeline-fields.ts`
- **THEN** the returned value SHALL include `{stage: "response-stream", field: "chunk"}`, `{stage: "chat:send:before", field: "message"}`, and `{stage: "prompt-assembly", field: "previousContext"}`

#### Scenario: Manifests cannot extend pipelineFields
- **WHEN** a plugin manifest contains an `x-pipeline-fields` key or any analogous custom field intended to add pipeline pairs
- **THEN** the plugin loader SHALL ignore that key (no effect on the introspection response or conflict detection)

### Requirement: Hook introspection CLI

The engine SHALL provide a Deno task `deno task introspect:hooks` (backed by `scripts/introspect-hooks.ts`) that loads the `PluginManager`, queries `HookDispatcher.introspect()`, gathers strip-tag declarations and `PIPELINE_FIELDS`, and writes a JSON document to stdout with the SAME shape as the HTTP route response. The CLI SHALL exit `0` on success and SHALL NOT write secrets, environment variables, or passphrases to either stdout or stderr.

#### Scenario: CLI dump shape matches HTTP route
- **WHEN** `deno task introspect:hooks` is invoked after the engine has loaded the same plugin set served by the HTTP route
- **THEN** the JSON written to stdout SHALL contain the same top-level keys (`backend`, `manifestDeclarations`, `stripTags`, `pipelineFields`, `generatedAt`) and the `backend`, `manifestDeclarations`, `stripTags`, and `pipelineFields` values SHALL deep-equal those returned by the HTTP route for the same plugin set

#### Scenario: CLI does not leak secrets
- **WHEN** `deno task introspect:hooks` runs in an environment where `PASSPHRASE` is set
- **THEN** the stdout and stderr output SHALL NOT contain the passphrase value

### Requirement: Hook conflict detection heuristics

The frontend SHALL provide a pure function `detectConflicts(serverIntrospect, frontendIntrospect): ConflictReport[]` in `reader-src/src/lib/hook-inspector.ts` that combines the server response with the client-side frontend dispatcher state and emits conflict reports. The function SHALL implement at least the following rules:

- **C1 multi-write**: For each stage, if two or more plugins declare `writes` containing the same field, emit one `{ code: "multi-write", severity: "warn", field, plugins, message }` per shared field — UNLESS the `(stage, field)` pair is present in `serverIntrospect.pipelineFields`, in which case no report SHALL be emitted.
- **C2 stale-read**: For each stage, if plugin A `reads` field X at priority `p_a` and plugin B `writes` field X at priority `p_b > p_a`, AND `A !== B`, emit `{ code: "stale-read", severity: "error", field: X, plugins: [A, B], message }`. Same-plugin reader/writer combinations SHALL be skipped — a single plugin subscribing to a stage at multiple priorities is exercising an intentional in-plugin pipeline, not a cross-plugin conflict.
- **C3 same-priority**: If two or more plugins on the same stage have the same numeric `priority`, emit `{ code: "same-priority", severity: "warn", plugins, message }` once per shared priority value.
- **C4 runtime-error**: For each handler entry whose `errorCount > 0`, emit `{ code: "runtime-error", severity: "error", plugins: [plugin], message }` naming the plugin and count.

`detectConflicts` SHALL be deterministic, free of side effects other than its return value, and SHALL handle handlers with `reads === null` or `writes === null` (manifest-undeclared) by skipping C1/C2 contributions for that handler without raising.

#### Scenario: Multi-write on pipeline field is not a conflict
- **WHEN** two plugins both declare `writes: ["chunk"]` on stage `response-stream`
- **THEN** `detectConflicts` SHALL NOT emit a `multi-write` report for `response-stream::chunk` because that pair is on the engine pipeline-fields allowlist

#### Scenario: Stale read across priorities
- **WHEN** plugin A (priority 100) declares `reads: ["previousContext"]` on `prompt-assembly`, plugin B (priority 200) declares `writes: ["previousContext"]` on the same stage, and `prompt-assembly::previousContext` IS in the pipeline-fields allowlist
- **THEN** `detectConflicts` SHALL still emit `{ code: "stale-read", severity: "error", field: "previousContext", plugins: ["A", "B"] }` because the C2 rule applies independently of the pipeline-fields allowlist (the allowlist only suppresses C1)

#### Scenario: Undeclared handler does not poison detection
- **WHEN** a plugin's manifest has no `hooks` entry and its handler appears in `backend` with `reads: null, writes: null`
- **THEN** `detectConflicts` SHALL NOT raise and SHALL NOT emit C1 or C2 reports for that handler's stage on its behalf

#### Scenario: Same-plugin reader/writer is not a stale-read
- **WHEN** plugin A declares two entries on the same stage — one with `reads: ["foo"]` at priority 50 and one with `writes: ["foo"]` at priority 150 — and no other plugin writes `foo` on that stage
- **THEN** `detectConflicts` SHALL NOT emit any `stale-read` report because the reader and writer are the same plugin (note: this presupposes the dispatcher allowed two entries, which currently is rejected by the "Dispatchers reject duplicate registration per (plugin, stage)" rule in `plugin-hooks`; this scenario therefore documents the heuristic's safety net rather than a reachable state today)

### Requirement: Hook inspector settings page

The writer settings area SHALL include a route at `/settings/hook-inspector` rendered by `HookInspectorPage.vue`. The page SHALL fetch `/api/plugin-introspection/hooks` using `useAuth().getAuthHeaders()` (so the `X-Passphrase` header is always present), call `frontendHooks.introspect()` to gather client-side handler entries, merge the manifest declarations onto the client-side entries by `(plugin, stage)`, run `detectConflicts`, and render one collapsible section per hook stage. Each section SHALL display handlers sorted by priority showing plugin name, priority, declared reads/writes (or an "undeclared" badge), and the in-memory `errorCount` labelled with text indicating it resets on process restart (e.g., "自上次重啟以來" in zh-TW UI). Conflict reports SHALL be rendered with severity-based coloring (info green, warn amber, error red). A manual "重新整理 / Refresh" button SHALL re-fetch and re-run detection.

#### Scenario: Page is accessible only with valid passphrase
- **WHEN** the user navigates to `/settings/hook-inspector` after passing the passphrase gate
- **THEN** the page SHALL mount and call `fetch("/api/plugin-introspection/hooks", { headers: getAuthHeaders() })` which SHALL include the `X-Passphrase` header

#### Scenario: errorCount UI is labelled as session-scoped
- **WHEN** a handler entry has `errorCount > 0` and is rendered
- **THEN** the UI SHALL display the count alongside zh-TW text indicating it represents errors observed since the most recent process start (resets on restart), so authors do not misinterpret it as historical total

#### Scenario: Refresh button re-runs detection
- **WHEN** the user clicks the Refresh button
- **THEN** the page SHALL re-fetch the introspection JSON, re-merge frontend declarations, re-run `detectConflicts`, and re-emit the `hook-inspector:report` event with the new payload

### Requirement: Typed hook-inspector report event

The frontend SHALL register `hook-inspector:report` as a fan-out frontend hook stage in `FrontendHookDispatcher`. After each successful conflict-detection pass on the inspector page, the page SHALL call `frontendHooks.dispatch("hook-inspector:report", payload)` where `payload` matches the `HookInspectorReport` interface exported from `reader-src/src/types/hook-inspector.ts`. The payload SHALL contain `{ generatedAt: string, backend: ..., frontend: ..., conflicts: ConflictReport[] }`. The type SHALL be re-exported from the `@/types` barrel so plugin authors can import it without referencing the internal path.

#### Scenario: Event emitted after refresh
- **WHEN** `detectConflicts` completes after a fetch or refresh
- **THEN** `frontendHooks.dispatch("hook-inspector:report", payload)` SHALL be called exactly once with the payload conforming to `HookInspectorReport`

#### Scenario: Subscribers receive typed payload
- **WHEN** a plugin registers a synchronous handler on `hook-inspector:report` and the inspector emits an event
- **THEN** the handler SHALL receive a context object matching `HookInspectorReport` and SHALL be invoked synchronously per the existing frontend dispatcher contract

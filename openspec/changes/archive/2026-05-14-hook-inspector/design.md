## Context

HeartReverie's plugin runtime exposes a backend `HookDispatcher` (`writer/lib/hooks.ts`) and a frontend `FrontendHookDispatcher` (`reader-src/src/lib/plugin-hooks.ts`). Both maintain `Map<HookStage, HandlerEntry[]>` internally with handlers sorted by priority. Handler exceptions are currently caught and logged via `baseLogger` but no counters are kept; there is no way to inspect the live subscription set without rebuilding from source.

Plugin manifests today (`writer/types.ts:137-170`) carry no hook metadata — plugins call `ctx.hooks.register(stage, handler, priority)` imperatively inside `register(ctx)`. This makes static conflict analysis impossible and forces conflict diagnosis to runtime.

The plugin set has grown to where `prompt-assembly::previousContext`, `response-stream::chunk`, `pre-write::preContent`, `chat:send:before::message`, and `frontend-render::text/placeholderMap` each have ≥2 plugin writers under realistic configurations. Authors need to see the graph before they ship, not after.

Stakeholders: plugin authors (primary), engine maintainers (visibility for triage), CI (CLI dump for regression detection).

## Goals / Non-Goals

**Goals:**

- Provide a single source of truth `GET /api/plugin-introspection/hooks` plus a CLI `deno task introspect:hooks` for the live hook graph + manifest declarations + strip-tag declarations + engine-owned pipeline-field allowlist.
- Expose per-handler runtime error counters via `introspect()` on both dispatchers, in-memory only.
- Add declarative `PluginManifest.hooks` so static conflict analysis (C1 multi-write, C2 stale-read, C3 same-priority, C4 runtime-error) becomes possible.
- Enforce declarations: manifest set must equal registered set; differences fail plugin load with an enumerated mismatch error.
- Enforce frontend handler shape: `register(stage !== "action-button:click", asyncFn)` throws synchronously at register time.
- Ship a writer-mode UI at `/settings/hook-inspector` grouped under a new "Developer Tools" sidebar category. Passphrase remains the only auth boundary.
- Emit typed `hook-inspector:report` frontend event after each detect pass; bundle a companion plugin (`hook-inspector-logger` in `HeartReverie_Plugins/`) as the e2e subscriber and reference implementation.

**Non-Goals:**

- Runtime gating of detected conflicts. The dispatcher continues to run all handlers regardless of warnings.
- LLM-driven conflict explanation. All heuristics are deterministic rules over manifest declarations + handler entries.
- Persisting `errorCount` across process restarts (out: avoids dispatch-hot-path I/O).
- Hot reload of plugins or a plugin marketplace UI.
- Dependency-graph visualization (deferred; v1 is table only).
- Cross-plugin runtime sampling of mutations (the "diff context at priority ±Infinity" trick used by prompt-debugger is out of scope here).

## Decisions

### D1: Dedicated route namespace `/api/plugin-introspection/*`

Plugin routes mount at `/api/plugins/${pluginName}` (`writer/app.ts:160-168`); `isValidPluginName()` (`plugin-manager.ts:53-58`) allows names like `_introspect`. Mounting introspection under `/api/plugins/_introspect/hooks` would let a plugin named `_introspect` shadow the route. We use a distinct top-level namespace `/api/plugin-introspection/*` that no plugin can ever capture.

Alternative considered: rename to `/api/_internal/hook-introspect`. Rejected because `_internal/*` would invite a class of future internal-only routes whose naming we don't want to fix yet.

### D2: Engine-owned `PIPELINE_FIELDS` in `writer/lib/hook-pipeline-fields.ts`

Multi-write on `response-stream::chunk`, `chat:send:before::message`, and `prompt-assembly::previousContext` is the intended pipeline contract, not a conflict. We hard-code this allowlist in a dedicated module so:
- The conflict detector (frontend) and any future schema validator (backend) share one source.
- Plugin manifests CANNOT extend the list — no `x-pipeline-fields`, no per-plugin override. The engine owns pipeline semantics.

Alternative considered: derive from manifest hooks themselves (any field with ≥2 declared writers is "pipeline"). Rejected because that flips the semantics — every accidental collision becomes "intended" and the C1 heuristic stops catching real bugs.

### D3: Breaking — declare/register mismatch fails plugin load (backend) and surfaces banner (frontend)

Plan and reality must agree. Two enforcement sites, each scoped to its own dispatcher's stage set:

**Backend (`PluginManager.#loadBackendModule`, transactional)**: load proceeds in three phases per plugin.

1. **Stage** — wrap `ctx.hooks` so every `register(stage, …)` call goes into a per-plugin staging map instead of the live `HookDispatcher`. Invoke the plugin's `register(ctx)`.
2. **Validate** — compute `declaredBackend = (manifest.hooks ?? []).map(h => h.stage).filter(s => s ∈ KNOWN_BACKEND_STAGES \ {"strip-tags"})` and `registeredBackend = stagingMap.keys()`. If the manifest's `hooks` field is non-empty AND the symmetric difference is non-empty, throw and **discard the staging map** so no backend handler is ever committed to the live dispatcher and the plugin is **removed from `#plugins`** (rolled back from the registry).
3. **Commit** — only when validation passes, replay each staged `register()` call into the real `HookDispatcher`.

Unknown-future stages and the declarative-only `strip-tags` stage are excluded from the symmetric-difference comparison so future stage additions do not have to wait for engine releases. A separate validator pass (manifest-validation phase) still `log.warn`s on unknown stages so authors notice typos.

**Frontend (`FrontendHookDispatcher.finalizeBoot`, non-fatal banner)**: backend cannot observe frontend `register()` calls — frontend.js modules execute in the browser. Instead, after `usePlugins()` finishes loading every plugin's `frontend.js` and calling `register(hooks)`, the SPA bootstrap calls `frontendHooks.finalizeBoot()`. It compares `declaredFrontend = (manifest.hooks ?? []).map(h => h.stage).filter(s => s ∈ KNOWN_FRONTEND_STAGES)` against the set of stages the plugin actually registered on (observed by the per-plugin proxy described in the existing `Hook handler origin tracking` requirement). Symmetric difference is reported via:
- An error banner mounted in the SPA shell listing every mismatched plugin and its `declaredOnly` / `registeredOnly` arrays.
- A `bootMismatches` payload attached to the next `hook-inspector:report` event.

`finalizeBoot()` does NOT throw — keeping the SPA responsive so the user can read the banner and fix manifests — but the banner is dismissible only after the user explicitly acknowledges. Plugin authors treat any non-empty mismatch as a hard error.

Note on full-stack plugins: a single `manifest.hooks[]` array contains BOTH backend and frontend stage declarations. Stage partitioning by capability (`KNOWN_BACKEND_STAGES` / `KNOWN_FRONTEND_STAGES`) ensures the backend check ignores frontend stages and vice-versa, so full-stack plugins do not produce spurious mismatches.

Alternative considered: warn-only on both sides. Rejected per user direction "no users in the wild — don't fear breaking".

Alternative considered: have the frontend POST its register set to a server endpoint and let `PluginManager` enforce both. Rejected — needless round-trip, adds a race window between SPA boot and enforcement, and would require either blocking SPA boot on the response or accepting eventual consistency.

### D4: Breaking — frontend async handler register-time throw

`FrontendHookDispatcher.register(stage, handler)` throws when `stage !== "action-button:click"` AND `handler.constructor.name === "AsyncFunction"`. Today the dispatcher silently ignores the returned promise on non-action stages so rejections vanish.

Migration: `register(stage, (ctx) => { void doAsync(ctx).catch((e) => log.error("…", e)); })`. Documented in `docs/plugin-system.md` and the create-plugin SKILL.

Alternative considered: silently call the async handler with no rejection handling (status quo). Rejected — bug class observed in field.

### D5: In-memory `errorCount`, "since last restart" label

The dispatch hot path runs per chunk for `response-stream`. Even one async file-write per caught exception would change the latency profile of streaming. We keep counters as plain integers on `HandlerEntry`. The UI shows them labeled "自上次重啟以來 / since last restart" so authors don't mistake them for historical totals.

Alternative considered: persist to `playground/_plugins/_introspection/state.json`. Rejected for hot-path performance and because cross-restart triage is already log-based.

### D6: Sidebar grouping by `meta.category`, no `?dev=1` flag

`SettingsLayout.vue` adds a generic grouping pass that buckets `settingsChildren` by `meta.category` (defaulting to `"general"` when absent), then renders one collapsible group per category. We introduce `"developer-tools"` as the second category and put Hook Inspector there. Future debug tools (runtime sampling, prompt diff viewer) plug in by setting the same category.

No `?dev=1` query string. Passphrase already gates the entire writer SPA via `PassphraseGate.vue`; any second gate would be either ineffective or annoying.

### D7: Typed frontend event `hook-inspector:report`

Payload type is exported from `reader-src/src/types/hook-inspector.ts` and re-exported through the existing `@/types` barrel so plugin authors can `import type { HookInspectorReport } from "@/types"`. The event is emitted after every successful conflict-detection pass (mount, manual refresh, or programmatic `hook-inspector:invalidate`). We register `hook-inspector:report` as a fan-out stage in `plugin-hooks.ts:VALID_FRONTEND_STAGES` so it participates in the same `register()` discipline (sync handlers only, etc.).

### D8: Companion plugin `hook-inspector-logger` lives in `HeartReverie_Plugins/`

The companion is a separate repo concern, tracked under its own OpenSpec change in `HeartReverie_Plugins/openspec/changes/`. This change references its existence in tasks but does not specify it line-by-line. Two reasons:
1. The plugin repo enforces its own manifest-validation invariants.
2. Keeps blast radius of this change scoped to the engine.

A bare-minimum scaffold spec (one screen of code) is documented in this change's `proposal.md` Impact section so reviewers know what the e2e looks like.

## Risks / Trade-offs

- **Risk**: Built-in plugins ship without `hooks` declarations and would now fail to load. → **Mitigation**: this change adds `hooks` to every built-in plugin manifest in the same tasks list; Integration Verification (§Tasks) greps `podman logs` for the mismatch error to ensure cleanup is complete.
- **Risk**: Frontend declare-vs-register cross-check requires a boot step that introduces a new failure mode (`finalizeBoot()`). → **Mitigation**: `finalizeBoot()` is invoked exactly once after all `register(ctx)` calls in `useBootstrap()`; failure produces an error banner instead of a thrown unhandled promise, and includes the mismatch payload so authors can fix manifests.
- **Risk**: Async-handler register-time throw breaks plugins authors are mid-development. → **Mitigation**: error message includes the migration snippet; SKILL.md is updated as part of this change so future generated plugins are correct.
- **Risk**: `errorCount` becomes a load-bearing metric for authors and the in-memory caveat is missed. → **Mitigation**: UI label is mandatory ("自上次重啟以來"), unit test asserts the label; `proposal.md` BREAKING CHANGES section calls it out.
- **Risk**: Conflict heuristic false positives demoralize plugin authors. → **Mitigation**: `pipelineFields` allowlist already removes the three known intentional multi-writes; C1 messages name the actual field; severity is "warn" not "error" for C1/C3.
- **Trade-off**: We do not enumerate frontend registrations from the backend, so the introspection JSON is split between server-supplied declarations and client-supplied facts. → Accepted: client-side `mergeFrontendDeclarations()` joins the two by `(plugin, stage)`. CLI dump shows backend facts + all manifest declarations; frontend-only facts are not in the CLI output. Documented in `docs/plugin-system.md`.
- **Trade-off**: CLI dump duplicates the route handler logic. → Accepted: a small `lib/introspection-dump.ts` is shared by both call sites; a regression test asserts shape equivalence.

### D9: Conflict-detection edge cases

The C2 stale-read rule explicitly requires `reader.plugin !== writer.plugin`. A single plugin that subscribes to the same stage at two priorities with one entry reading and the other writing is exercising an intentional in-plugin pipeline; the detector MUST NOT flag it. The reference implementation in `tmp/feat/B4-hook-visualization.md §9` already enforces this skip; the spec scenario codifies it.

The manifest-to-handler join uses the pair `(plugin, stage)` as the key, which presupposes one `hooks[]` entry per `(plugin, stage)` AND one registered handler per `(plugin, stage)`. The manifest validator therefore SHALL reject `hooks[]` arrays containing duplicate `(plugin, stage)` pairs (i.e. duplicate `stage` values within the same plugin's manifest, since manifest `hooks[]` is already plugin-scoped). The runtime SHALL also reject duplicate registrations on the same `(plugin, stage)` pair at the dispatcher level. A future relaxation that supports multiple handlers per pair would require a stable handler identifier in both the manifest and the registration call; until then the 1:1 constraint keeps the inspector unambiguous.

## Migration Plan

This is a greenfield change for plugin authors. No data migration. The breaking surface is captured in two places:

1. **Built-in plugins** (engine repo): every existing built-in plugin manifest gets `hooks: [...]` entries in the same change. Verified by booting the container and confirming no `mismatch` errors in `podman logs`.
2. **Community/companion plugins** (`HeartReverie_Plugins/` and elsewhere): a companion change in `HeartReverie_Plugins/openspec/changes/` updates each plugin's manifest. Until that lands, `HeartReverie_Plugins/` images built against the new engine will refuse to load the affected plugins; release notes name them.

No rollback needed because the schema additions are optional fields (omitting `hooks` is valid). The breaking aspect is the validation rule, not the data shape; reverting the validation toggle would suffice in an emergency, but per the project policy ("no users in the wild") we do not gate the breaking change behind a flag.

## Open Questions

None remaining at design time. All open questions from `tmp/feat/B4-hook-visualization.md §15` are resolved (see Q1 dev_category, Q2 CLI, Q3 in_memory, Q4 breaking mismatch, Q5 dedicated_module, Q6 typed event, Q7 breaking async-reject).

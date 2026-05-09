# Tasks — context-compaction-settings-ui

## 1. Manifest: declare settingsSchema

- [x] 1.1 Add `settingsSchema` (JSON Schema draft-07, `type: "object"`) to `plugins/context-compaction/plugin.json`.
- [x] 1.2 Define `recentChapters` property: `type: "integer"`, `minimum: 1`, `default: 3`, zh-TW `title` and `description` describing the L2 window size.
- [x] 1.3 Define `enabled` property: `type: "boolean"`, `default: true`, zh-TW `title` and `description` describing that disabling makes the plugin a no-op.
- [x] 1.4 Confirm the schema's `default` values match `DEFAULTS` in `config.ts` byte-for-byte.

## 2. Backend: read engine-managed settings as a precedence layer

- [x] 2.1 In `plugins/context-compaction/handler.ts`, no new context API is required: the existing call to `loadCompactionConfig(storyDir, series, playgroundDir)` already passes `playgroundDir`. Confirm the playground dir is available; if not, plumb it through.
- [x] 2.2 Update `plugins/context-compaction/config.ts` `loadCompactionConfig()` to read `${playgroundDir}/_plugins/context-compaction/config.json` directly via `Deno.readTextFile()` on each call (path documented by the canonical plugin-authoring skill, SKILL.md Step 8.5). Treat missing file as empty layer; treat malformed JSON as empty layer + WARN log (do not throw).
- [x] 2.3 Replace the existing all-or-nothing precedence with: `chosenYaml = storyYaml ?? seriesYaml ?? null`; `effective = { ...DEFAULTS, ...sanitize(pluginSettings), ...sanitize(chosenYaml ?? {}) }`. Story XOR series semantics MUST be preserved.
- [x] 2.4 `sanitize()` SHALL drop fields whose values fail `mergeConfig()`-style validation (non-positive integer for `recentChapters`, non-boolean for `enabled`) so the next-lower layer fills them in. Apply to all three layers (defaults need no sanitisation; plugin settings and YAML do).

## 3. Tests: precedence and schema-defaults invariants

- [x] 3.1 Add a Deno test asserting `settingsSchema.properties.recentChapters.default === DEFAULTS.recentChapters` and same for `enabled` (load `plugin.json` and `config.ts` `DEFAULTS`).
- [x] 3.2 Add a test: only plugin settings present (no YAML) → those values apply.
- [x] 3.3 Add a test: story YAML overrides plugin settings (story value wins, plugin-settings value ignored for that field).
- [x] 3.4 Add a test: series YAML (no story YAML) overrides plugin settings.
- [x] 3.5 Add a test: story YAML omits a field → plugin settings fill in for that field; if plugin settings also omit, default applies.
- [x] 3.6 Add a test: nothing set anywhere → built-in defaults apply.
- [x] 3.7 Add a test: `enabled: false` via plugin settings (no YAML) → handler returns early without modifying `previous_context`.
- [x] 3.8 Add a test: story YAML AND series YAML both exist → series YAML is NOT consulted (story XOR series semantics preserved).
- [x] 3.9 Add a test: malformed `playground/_plugins/context-compaction/config.json` (e.g., `not-json`) → falls through to YAML/defaults with a WARN log; the request does not throw.
- [x] 3.10 Add a test: `config.json` contains `{ recentChapters: 0, enabled: true }` → `recentChapters` is sanitised away (falls through to default 3); `enabled` is preserved.
- [x] 3.11 Add a test pinning the "no plugin-settings file" case: with various YAML setups, `loadCompactionConfig()` produces results byte-for-byte identical to the pre-change baseline (use a snapshot of expected values).

## 4. Documentation

- [x] 4.1 Update `plugins/context-compaction/README.md`: add a `### 設定欄位（閱讀器 UI 設定頁）` subsection listing the two UI fields with their defaults and validation rules.
- [x] 4.2 Add a `### 優先順序` subsection enumerating the four-layer order (story YAML → series YAML → 全域 plugin 設定 → 預設值) with a worked example.
- [x] 4.3 Add a paragraph clarifying that the UI is global (whole install) while YAML remains the way to scope per series/story.

## 5. Container build + integration verification (mandatory per AGENTS.md)

- [x] 5.1 `cd HeartReverie/ && scripts/podman-build-run.sh` — must produce a clean startup log (no warnings/errors related to plugin loading or schema parsing).
- [x] 5.2 `curl -H "X-Passphrase: …" http://localhost:8080/api/plugins/context-compaction/settings` returns the schema defaults (`{ recentChapters: 3, enabled: true }`).
- [x] 5.3 `curl -X PUT -H "X-Passphrase: …" -H "Content-Type: application/json" -d '{"recentChapters":5,"enabled":true}' http://localhost:8080/api/plugins/context-compaction/settings` returns the persisted object; verify `playground/_plugins/context-compaction/config.json` was created with that content.
- [x] 5.4 `curl -X PUT … -d '{"recentChapters":"five"}'` returns a 4xx validation error (type mismatch) and does NOT mutate the persisted file. NOTE: a numeric `0` or negative value is NOT rejected by the engine validator (`minimum` not enforced); it is sanitised at read time per task 3.10.
- [x] 5.5 agent-browser smoke test: open reader, navigate to plugin settings page for `context-compaction`, confirm the two controls render with zh-TW labels, edit `recentChapters`, save, reload page, value persists.

## 6. Validate

- [x] 6.1 `cd HeartReverie && openspec validate context-compaction-settings-ui --strict` — must pass.
- [x] 6.2 Run `deno task test` (or the equivalent project test script) — all tests must pass.
- [x] 6.3 Final review: confirm no behaviour regressed for users with existing `compaction-config.yaml` files (covered by precedence tests in §3).

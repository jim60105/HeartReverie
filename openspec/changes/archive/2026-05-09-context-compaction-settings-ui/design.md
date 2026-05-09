## Context

The `context-compaction` plugin lives in `HeartReverie/plugins/context-compaction/` and is bundled with the engine (in-tree). It currently supports two scopes of YAML configuration:

- `playground/{series}/{name}/compaction-config.yaml` (story-level, highest priority)
- `playground/{series}/compaction-config.yaml` (series-level, fallback)

The engine separately offers a **plugin settings** capability: any plugin whose `plugin.json` declares a `settingsSchema` (JSON Schema draft-07) automatically gets:

- `GET /api/plugins/:name/settings` returning defaults merged with persisted values.
- `PUT /api/plugins/:name/settings` validating against the schema and persisting to `playground/_plugins/<plugin>/config.json`.
- An auto-rendered settings page inside the reader's settings UI.
- A direct read of `${playgroundDir}/_plugins/context-compaction/config.json` from `config.ts` so the prompt-assembly hook can pick up the persisted values per request (`getSettings()` is only on `PluginRouteContext`, not `PluginRegisterContext`).

We want to graft this engine-provided UX onto `context-compaction` without breaking the existing YAML mechanism.

## Goals / Non-Goals

**Goals:**

- Users can change `recentChapters` and `enabled` from the reader's settings UI without touching the filesystem.
- Existing `compaction-config.yaml` files continue to work and continue to win where they are present.
- A UI edit takes effect on the very next chat turn — no restart, no cache invalidation by the user.
- `recentChapters` is validated (positive integer) by the schema before being written.

**Non-Goals:**

- Per-story or per-series UI editing. The reader settings page is global by engine design; per-story/series remains YAML-only. Adding a per-story/series UI would require new engine capabilities and is out of scope.
- Migrating existing YAML values into the global plugin settings. Not done — the UI starts empty and defaults apply unless YAML or persisted UI values override them.
- Renaming `recentChapters` to something more verbose. The field already has a public name and tests rely on it; renaming is out of scope and offers no UX benefit when titles/descriptions are localised.

## Decisions

### D1. Add `settingsSchema` to the plugin manifest, do NOT introduce a new config layer

Keep the existing `CompactionConfig` interface unchanged. The new third precedence layer feeds into the same shape via `loadCompactionConfig()`. Concretely: `plugin.json` gains a `settingsSchema` block with `recentChapters` (integer, min 1, default 3) and `enabled` (boolean, default true), each with a zh-TW `title` and `description`. The schema's `default` values mirror `DEFAULTS` in `config.ts` exactly so there is one source of truth for "what does an unconfigured plugin do" — the schema.

**Why not a brand-new config struct:** the YAML and UI both edit the same two knobs. Keeping one `CompactionConfig` interface keeps the L2 window math simple and prevents two parallel "what does the plugin do right now" answers.

**Engine validator caveat (added after rubber-duck pass).** The engine's `#validateAgainstSchema()` in `writer/lib/plugin-manager.ts` currently checks `required` and `type` only — it does NOT enforce `minimum` (or `maximum`, `enum`, etc.). We accept this:

- The `minimum: 1` declaration is a documentation contract and a UI rendering hint (HTML `<input type="number" min="1">` in the auto-rendered settings page).
- Runtime safety is provided by the existing `mergeConfig()` coercion in `config.ts`, which already replaces non-positive integers with the default. After this change `mergeConfig()` SHALL run on every layer (defaults, plugin settings, YAML), so a malformed `recentChapters: 0` from any source — including a hand-edited `config.json` — is coerced to `3`.
- We do NOT extend the engine validator in this change; that would be a `plugin-settings` capability change with broader scope.

### D2. Precedence order: story YAML > series YAML > plugin settings (global UI) > defaults — YAML semantics preserved

The two existing YAML scopes represent **explicit author intent for a specific story/series** and SHOULD continue to take precedence. The new UI knob is a **global default** that fills in for everything without an explicit YAML override.

```
[story YAML]    (selected as a single block if present)
   ↓ if absent
[series YAML]   (selected as a single block if absent above)
   ↓ if absent
[plugin settings (UI / config.json)]   (field-level fill-in below the chosen YAML)
   ↓ if absent
[built-in DEFAULTS]
```

**Critical refinement (added after rubber-duck pass).** YAML-vs-YAML semantics are unchanged: story YAML and series YAML are mutually exclusive — if a story YAML exists, series YAML is NOT consulted, exactly as today. Plugin settings sit *under* the chosen YAML (or under defaults if no YAML exists) and fill in fields the chosen YAML omits. Concretely:

```ts
const chosenYaml = storyYamlIfPresent ?? seriesYamlIfPresent ?? null;
const effective = {
  ...DEFAULTS,
  ...pluginSettingsIfValid,    // global UI fills gaps
  ...(chosenYaml ?? {}),       // YAML wins for whatever it specifies
};
```

This is **purely additive** for existing YAML-only setups: if the user has never touched the plugin settings UI, the persisted `config.json` doesn't exist and the plugin settings layer is empty, so the effective config equals `{ ...DEFAULTS, ...chosenYaml }` — identical to today's behaviour. The earlier draft of this design proposed merging story+series YAML field-by-field, which would have silently changed behaviour for existing users with both YAML files present (e.g., series sets `enabled: false`, story sets only `recentChapters: 5` → today compaction is enabled, the earlier draft would have disabled it). That has been rejected.

**Why this order, not the reverse:**

- Reverse order would mean the UI globally overrides per-story YAML, which is surprising for power users who already invested in YAML files and breaks "explicit > implicit".
- This order keeps "I edit YAML to lock a specific story to a different policy" working with no surprises.

**Alternative considered: only-UI, deprecate YAML.** Rejected — YAML's per-story scope is genuinely more powerful than a global UI, and removing it would be a regression.

### D3. Read plugin settings per request, directly from the documented path

`loadCompactionConfig()` is already called inside the `prompt-assembly` hook handler — i.e., per chat turn, with the engine-supplied `playgroundDir`. We extend it to also read `${playgroundDir}/_plugins/context-compaction/config.json` on each invocation. This guarantees a UI edit is reflected on the very next turn without an in-process cache to invalidate.

This pattern is **explicitly endorsed by the canonical plugin-authoring guide** (`HeartReverie/.agents/skills/heartreverie-create-plugin/SKILL.md`, Step 8.5, line 359):

> Hooks running outside `registerRoutes` (e.g. `post-response`) can fetch settings through the same `PluginManager` API the routes use — typically by calling a small helper your plugin exposes, or by reading the JSON file directly under `<rootDir>/playground/_plugins/<name>/config.json`.

Our prompt-assembly hook is exactly such a hook (outside `registerRoutes`), and the `playgroundDir` argument already plumbed into `loadCompactionConfig()` is the same `<rootDir>/playground/...` directory the skill refers to. So the file path the plugin reads SHALL be:

```ts
const settingsPath = join(playgroundDir, "_plugins", "context-compaction", "config.json");
```

**Why read the file directly instead of `getSettings()` (added after rubber-duck pass).** `getSettings()` is exposed on `PluginRouteContext` (for `registerRoutes()`) but NOT on `PluginRegisterContext` (the context passed to `register()` for hook registration). Adding it to `PluginRegisterContext` would be an engine-wide change that affects every full-stack plugin and ties this proposal to a `plugin-settings` capability change. We avoid that scope by following the documented file-read pattern:

- The persistence path is part of the `plugin-settings` capability spec — reading it directly is not "leaking" a private detail.
- Treats missing file = empty layer.
- Treats malformed JSON = empty layer + WARN log (not thrown — matches existing YAML-loader behaviour in `config.ts`).

The cost is one extra small file read per chat turn — negligible compared to the LLM round trip.

**Alternative considered: cache settings at register() time and invalidate on PUT.** Rejected — requires either a cross-module callback or a file watcher, both overkill for a tiny config file. If profiling later shows it matters, a TTL cache can be added transparently to `loadCompactionConfig()`.

**Alternative considered: extend `PluginRegisterContext` with `getSettings()`.** Rejected for this change — out of scope. May be a future engine improvement.

### D4. Field-level merge of plugin settings under the chosen YAML; YAML files themselves stay all-or-nothing

Each layer below the chosen YAML is treated as a *partial* `Partial<CompactionConfig>`. The chosen YAML (story XOR series) is treated as a *partial* itself. We compute the effective config by merging in this order (later wins):

```ts
const chosenYaml = storyYamlIfPresent ?? seriesYamlIfPresent ?? null;
const effective = {
  ...DEFAULTS,
  ...sanitize(pluginSettingsIfValid),
  ...(chosenYaml ? sanitize(chosenYaml) : {}),
};
```

`sanitize()` is the existing `mergeConfig()`-style validation pass: positive integer for `recentChapters`, boolean for `enabled`; invalid fields are dropped (not used) so the next-lower layer fills them in.

This matches the user's mental model: "I set `enabled: false` in story YAML; the plugin honours it; I separately tweak `recentChapters` in the UI; the UI value applies because the YAML didn't mention `recentChapters`." It also matches today's behaviour exactly when no plugin-settings file exists.

**What is intentionally NOT changed:**

- Story YAML does NOT inherit fields from series YAML. If story YAML exists, series YAML is ignored. This preserves today's behaviour and avoids the silent regression flagged by the rubber-duck pass.
- The chosen YAML's fields still all map to `Partial<CompactionConfig>` — i.e., a story YAML containing only `recentChapters: 5` will leave `enabled` to the layer below (plugin settings if set, else default `true`), which is exactly what `mergeConfig()` does today.

New tests SHALL pin both the new behaviour (plugin-settings layer fills gaps under YAML) and the unchanged behaviour (story XOR series, never merged).

### D5. Persistence path is engine-managed, NOT under `playground/{series}/`

The engine writes plugin settings to `playground/_plugins/context-compaction/config.json` (per the existing `plugin-settings` spec). This is intentionally separate from `playground/{series}/{name}/compaction-config.yaml`:

- The UI value is **global to the install**, not per-story.
- The directory `_plugins/` is engine-reserved (leading underscore convention) and is invisible to story listings.

We add no new path conventions.

### D6. README documentation updates and zh-TW localisation

The plugin's `README.md` already has a `## 設定` section listing the YAML fields. We extend it with:

- A `### 設定欄位（閱讀器 UI 設定頁）` subsection mirroring the YAML field table, in zh-TW, plus the `settingsSchema` JSON Schema snippet.
- A `### 優先順序` subsection enumerating the four-layer precedence (story YAML → series YAML → 全域設定 → 預設值).
- A migration note: existing YAML continues to work; no action required.

The `title` / `description` fields in `settingsSchema` SHALL be in zh-TW to match the rest of the reader UI (cf. `sd-webui-image-gen`'s schema).

## Risks / Trade-offs

- **Behavioural shift from "all-or-nothing" YAML to field-level merge.** RESOLVED in D2/D4: YAML-vs-YAML semantics are kept all-or-nothing (story XOR series). Only the new plugin-settings layer fills gaps below the chosen YAML. For users with no plugin-settings file (i.e., everyone before this change), behaviour is bit-identical to today.
- **Plugin settings UI is global; users may expect per-story controls.** **Mitigation:** README clearly states UI is global and YAML remains the way to scope per story/series. The settings page caption mentions this explicitly.
- **Settings-file unavailable at plugin register time.** Resolved by reading the JSON file directly per request from inside `loadCompactionConfig()`; a test SHALL cover the "file missing → defaults" fallthrough.
- **Schema drift between `DEFAULTS` constant and `settingsSchema` defaults.** **Mitigation:** add a unit test that constructs `DEFAULTS` from the manifest's `settingsSchema.properties.<field>.default` and compares to the in-code `DEFAULTS` object. Drift fails the test.
- **`recentChapters: 0` or negative.** **Mitigation:** schema declares `minimum: 1` for documentation/UI; the engine's lightweight validator does NOT enforce `minimum` (only `type`/`required`). Runtime safety comes from `mergeConfig()` in `config.ts`, which already coerces non-positive integers to the default. After this change `mergeConfig()` SHALL run on every layer (defaults, plugin settings, YAML), so a malformed `recentChapters: 0` from a hand-edited `config.json` is silently coerced. Tests SHALL pin this. Extending the engine validator to enforce `minimum` is out of scope.

- **Plugin reads `_plugins/<name>/config.json` directly instead of via `getSettings()`.** RESOLVED in D3: `getSettings()` is only on `PluginRouteContext`, not `PluginRegisterContext`. To avoid an engine change touching every full-stack plugin, `config.ts` reads the documented persistence path itself. Treats missing file = empty layer; malformed JSON = empty layer + WARN log.

## Context

The HeartReverie reader is a zh-TW single-page Vue app. Plugins are discovered at server boot by scanning the built-in `plugins/` directory and the optional `PLUGIN_DIR` external directory, parsing each subdirectory's `plugin.json`, and validating that the manifest's `name` field exactly equals the directory name (`writer/lib/plugin-loader-manifest.ts`). The frontend then fetches `GET /api/plugins` (`writer/routes/plugins.ts`) and uses the resulting list both for runtime hook registration (`usePlugins()`) and for sidebar nav rendering (`reader-src/src/components/SettingsLayout.vue`).

The current sidebar nav code is:

```ts
pluginTabs.value = plugins
  .filter((p) => p.hasSettings)
  .map((p) => ({ pluginName: p.name as string, label: (p.name as string) }));
```

`label` therefore renders the plugin slug (e.g. `chapter-bookmark`). The plugin slug carries three load-bearing roles that prevent it from being changed to a zh-TW string:

1. **Filesystem identity** — `manifest.name !== dirName` is rejected as impersonation.
2. **URL slug** — the settings router declares `plugins/:name` and the routes API mounts under `/api/plugins/:name/...`.
3. **Storage key** — per-plugin settings are persisted under the slug.

The cleanest fix is to introduce a separate field whose only job is to be a human-readable label.

## Goals / Non-Goals

**Goals:**

- Give every plugin a short zh-TW label suitable for sidebar nav and future drawer/menu surfaces.
- Keep the slug (`name`) untouched in every load-bearing path (filesystem identity, URL, storage).
- Surface the new label through `GET /api/plugins` so the SPA does not need a second round-trip per plugin.
- Fail loudly when a plugin manifest forgets the new field — the project is pre-release and we prefer a hard failure over silent fallback that lets stale plugins ship with English-only labels.

**Non-Goals:**

- Multi-locale or i18n key indirection. There is one supported display locale (zh-TW) and the field's value is a literal string; an i18n layer would be premature.
- Changing the plugin slug (`name`) or any route shape.
- Touching `description` semantics or repurposing it as a label.
- Updating any individual plugin's `plugin.json`. That work is owned by the companion proposal in `HeartReverie_Plugins`.
- Renaming the field in any built-in plugin (`HeartReverie/plugins/*`) — those manifests live in the plugin repo's branch of work and will be handled together with the external plugin updates.

## Decisions

### Decision 1: Field name is `displayName`

**Chosen:** `displayName`.

**Alternatives considered:**

- `displayNameZhTw` — encodes the locale in the field name. Rejected because it implies a forthcoming `displayNameEnUs` / `displayNameJaJp` etc., which is not on any roadmap; encoding locale in the schema is a premature constraint. If multi-locale support arrives later, the right shape is an object (`displayName: { "zh-TW": "...", "en-US": "..." }`) or an i18n key, both of which can be evolved from a plain string without renaming.
- Repurposing `name` to hold the zh-TW label and introducing a new `id` field for the slug — rejected because `name` is referenced from many existing specs, settings storage keys, route params, and the manifest-name-vs-directory-name impersonation guard. Renaming it is high-blast-radius for zero user-facing benefit.
- `title` — rejected because `title` collides with conventional document/page-title semantics (the settings router already uses `meta.title` on Vue routes) and reads as a longer phrase than a sidebar label should be.
- `label` — rejected because `label` is heavily overloaded in the existing codebase (form field labels, action-button labels, schema field labels) and would invite confusion about scope.

`displayName` is unambiguous, conventional, and consistent with terms already in use elsewhere in the codebase (e.g. `reader-src/src/lib/lore-filename.ts`'s `displayName` parameter, `reader-src/src/components/QuickAddPage.vue`'s `displayName` variable).

### Decision 2: The field is required, not optional with a slug-fallback

**Chosen:** required. A plugin whose manifest is missing, has a non-string, or has an empty/whitespace-only `displayName` SHALL be rejected at load time with a warning identifying the plugin directory.

**Rationale:** the project is pre-release with zero users; every existing plugin manifest will be updated in the companion proposal in `HeartReverie_Plugins`. A soft fallback (e.g. "use `name` if `displayName` is missing") would let plugin authors forget the field and silently ship plugins with slug labels — exactly the regression we are trying to prevent. The hard rejection serves as a load-time forcing function: a plugin that forgets the field cannot ship, which is the correct posture for a pre-release codebase whose first release should establish the localised-label invariant.

**Failure mode if the plugin-side proposal lags:** during the brief window after this core proposal merges but before every plugin manifest is updated, the affected plugins fail to load. This is intentional and is mitigated by the rollout sequencing in the "Migration Plan" below.

### Decision 3: Validation matches the existing `name` rejection path

The new validator runs immediately after the existing `manifest.name` check in `writer/lib/plugin-loader-manifest.ts`'s `parseManifestFile()`. The rejection rules mirror `name`'s rules one-for-one to give plugin authors a consistent debugging experience:

```ts
if (!manifest.displayName || typeof manifest.displayName !== "string") {
  log.warn("Plugin missing required 'displayName' field — skipping", { dir: pluginDir });
  return null;
}
if (manifest.displayName.trim().length === 0) {
  log.warn("Plugin 'displayName' field is empty or whitespace-only — skipping", { dir: pluginDir });
  return null;
}
```

The validator does NOT enforce an upper length bound at this layer. The sidebar nav CSS already truncates with ellipsis; introducing a hard cap would be a UI-level concern and is out of scope for the core schema. The validator also does NOT require the field to contain zh-TW characters — the codebase has no `lang`-of-content invariant to lean on, and that check would be both lossy (false negatives on pure-ASCII brand names like "OpenRouter") and culturally presumptuous.

### Decision 4: API exposure is a plain top-level field

`GET /api/plugins` already serialises a hand-picked subset of manifest fields (`name`, `version`, `description`, `type`, `tags`, …). `displayName` joins this list as a plain `string`. The handler in `writer/routes/plugins.ts` is updated to include `displayName: p.displayName` in the returned object. No conditional/optional logic is needed because the manifest loader guarantees the field is present and non-empty for every plugin in `pluginManager.getPlugins()`.

### Decision 5: Frontend continues to use `name` as the route param and `:key`

In `SettingsLayout.vue`, the `<router-link>` `:to` still resolves to `{ name: 'settings-plugin', params: { pluginName: pt.pluginName } }` where `pluginName` is the slug. Only the link's rendered text changes from the slug to `displayName`. This preserves bookmark URLs, settings-storage keys, and the existing settings router contract.

### Decision 6: No new `PluginTab` field renaming

The internal `PluginTab` interface in `SettingsLayout.vue` currently has `{ pluginName, label }`. `label` continues to mean "what the user sees", and only its source value changes (slug → displayName). Keeping the interface shape the same minimises the diff and matches the convention that internal Vue-component view-models are decoupled from server-payload field names.

## Risks / Trade-offs

- **[Risk] Plugin-side proposal lags this one** → Mitigation: the rollout plan below sequences them so both land in the same release window. If a maintainer accidentally merges core-only, every plugin would fail to load with a clear `warn` log identifying which `displayName` is missing — a noisy but recoverable failure mode.

- **[Risk] Manifest authors copy-paste an empty string** → Mitigation: the trim-and-length-check covers this case; the rejection log identifies the plugin directory by path, not just the manifest name (which may also be empty), so the operator can find and fix the file.

- **[Trade-off] No length cap** → If a plugin sets a 200-character `displayName`, the sidebar CSS will ellipsis-truncate. This is preferable to a hard rejection that punishes plugins for cosmetic over-specification. If empirical abuse appears post-release, a soft cap can be added later as a `log.warn`-and-truncate rule without changing the schema.

- **[Trade-off] Locale-encoded in field semantics, not field name** → If the project later supports multiple display locales, the field will be promoted to an object or wired through an i18n loader. Doing that work now is YAGNI; we keep the field name locale-agnostic so the upgrade path is open.

## Migration Plan

The project is pre-release; "migration" here means rollout sequencing across the two coupled repositories, not a data migration.

1. Merge this proposal's spec, types, loader, route, and SPA changes into `HeartReverie` core. **At this point the core image, if released, refuses to load any plugin whose manifest lacks `displayName`.**
2. In the same release window, land the companion proposal in `HeartReverie_Plugins` that adds `displayName` to every plugin's `plugin.json` (both built-in `HeartReverie/plugins/*` and external `HeartReverie_Plugins/*`).
3. Cut a coordinated release of both images. The published `HeartReverie_Plugins` container layer pairs with the corresponding core image tag.
4. Manual smoke: build the core container per `scripts/podman-build-run.sh`, mount the updated `HeartReverie_Plugins` image into `PLUGIN_DIR`, hit `GET /api/plugins` and confirm every record has a non-empty `displayName`; open the SPA and confirm the `/settings/*` sidebar plugin links render zh-TW.

**Rollback:** revert both repos to the previous tag. Because no on-disk state shape changed (settings files are keyed by slug, not by `displayName`), rollback is purely a code revert with no data cleanup.

## Open Questions

_(none — the field name, requiredness, validation rules, API shape, and SPA wiring are all pinned by the decisions above.)_

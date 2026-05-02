## Why

The File System Access (FSA) reading mode is **dead code**. The folder-picker UI was removed in commit `4f3f91fe` ("feat(reader): tighten header — drop folder picker, …"), which left `useFileReader().openDirectory()` exported but never called from any production component. New users have no UI affordance to acquire a `FileSystemDirectoryHandle`; only legacy users with a pre-removal IndexedDB record can re-enter FSA mode at all, and even then only on app boot (`App.vue` silently auto-restores). The leftover wiring carries real cost:

- It is the **sole reason** the frontend is forced to run inside a Secure Context (HTTPS), pinning a hard HTTPS dependency on every deployment topology — including local development, where self-signed certs add friction with no offsetting user benefit.
- It is the **sole consumer** of IndexedDB in the project; removing FSA removes the entire `storyReaderDB` schema as well.
- It bifurcates `useChapterNav` into `mode: "fsa" | "backend"` branches that every navigation, polling, and plugin-hook code path must straddle, doubling the surface area of the chapter pipeline in tests and specs.
- It anchors a non-trivial chunk of frontend test scaffolding (`fake-indexeddb` mocks, `showDirectoryPicker` stubs) that exercises code paths the user can never reach.

The project is pre-1.0 with zero users in the wild, so backward compatibility is not a concern. Pruning FSA collapses the chapter pipeline to a single mode, makes HTTP a first-class deployment topology (the Helm chart already supports `HTTP_ONLY=true`), and removes ~150 lines of composable code, ~250 lines of tests, and seven `mode === "fsa"` branches scattered across the chapter, plugin, and router layers.

## What Changes

- **BREAKING**: Remove the FSA reader mode entirely. The `useFileReader()` composable, its IndexedDB persistence layer (`storyReaderDB`), the `loadFromFSA()` entry point on `useChapterNav()`, the `mode` reactive ref, and every `mode === "fsa"` branch SHALL be deleted. Backend mode becomes the only reader mode.
- **BREAKING**: Drop HTTPS as a hard requirement *for FSA-removal purposes*. HTTPS remains a recommended deployment option (and the default in `entrypoint.sh` and the Helm chart), but the codebase SHALL no longer rely on Secure Context for any user-facing feature. `HTTP_ONLY=true` mode SHALL be promoted from "reverse-proxy escape hatch" to a fully supported topology. *Browser-compat note*: `crypto.randomUUID()` (used in `useChatApi.ts` for chat/plugin-action correlation IDs) was historically secure-context-only but has been available in non-secure contexts since Chrome 92, Firefox 95, and Safari 15.4 (2021–2022). Plain-HTTP deployments therefore work on all currently supported browsers; no UUID fallback is added.
- Remove `useFileReader.ts`, its tests, and the `UseFileReaderReturn` type. Remove the `restoreHandle()` call from `App.vue`. Remove the FSA branch from `AppHeader.vue`'s reload handler. Simplify `useChapterNav` to a single backend pipeline (no `loadFromFSA`, no `loadFSAChapter`, no `mode` ref, no FSA-conditional polling).
- Update plugin-hook contracts (`story:switch`, `chapter:change`, `action-button:click` visibility) to drop the `mode: "fsa" | "backend"` discriminator and the `null` series/story sentinel that only existed to represent FSA. Hook context types collapse to the backend-only shape.
- Remove FSA-specific test infrastructure: `fake-indexeddb` mocks, `showDirectoryPicker` stubs, and the `useChapterNav-boundary-jumps` FSA-routing scenarios. Tests SHALL exercise only the surviving backend path.
- Update documentation:
  - `README.md`: remove the "需要 HTTPS 安全環境" claim; rewrite the secure-context paragraph to describe HTTPS as a recommended-but-optional default rather than a hard requirement.
  - `AGENTS.md`: drop the FSA + IndexedDB references in "Project Structure" and "Frontend Technology Stack"; update "Running the Server" to remove "HTTPS is required for the File System Access API used by the frontend"; remove `useFileReader.ts` from the composables list.
  - `docs/helm-deployment.md`: remove the "Secure Context (HTTPS)" framing and the "瀏覽器顯示「無法存取本機檔案」" troubleshooting entry; HTTPS becomes a TLS-hardening choice, not a feature gate.
  - The Helm chart README's "Single-replica only" / probe sections do not need changes; only the per-deployment-topology rationale shifts.
- Removed test scaffolding: manual IndexedDB stubs (`vi.stubGlobal("indexedDB", …)`) and `window.showDirectoryPicker` mocks. **No dependency or lockfile changes are expected** — `reader-src/` is a Deno project with no `package.json` or npm lockfile, and `fake-indexeddb` is not a real dependency (the existing tests use hand-rolled IndexedDB stubs).

## Capabilities

### New Capabilities

None. This is a removal-only change.

### Modified Capabilities

- `file-reader`: REMOVED capability. The entire spec collapses to a deletion delta — every requirement (FSA folder selection, IndexedDB persistence, FSA-mode composable, FSA permission-restore flows, the singleton-state preservation contract) is removed. Numeric-`.md` filtering and snapshot-based file reading were behaviours of the FSA pipeline; the server-side chapter listing already enforces equivalent semantics through `/api/stories/:series/:name/chapters`, so no replacement requirements are needed in this spec.
- `chapter-navigation`: MODIFIED. Remove `mode: Ref<"fsa" | "backend">`, `loadFromFSA()`, `loadFSAChapter()`, the FSA-router-skip scenario, the `goToFirst`/`goToLast` FSA-routing scenarios, and the IndexedDB stale-handle recovery requirement. The composable's public interface collapses to the backend-only shape; the boundary-jump helpers route exclusively through `navigateTo()`.
- `auto-reload`: MODIFIED. Remove the "1-second FSA polling" requirement and every FSA branch; chapter polling collapses to "WebSocket push when connected, 3-second HTTP polling fallback otherwise."
- `chapter-editing`: MODIFIED. Drop the "controls hidden in FSA mode" requirement and scenario — edit/rewind/branch controls are now unconditionally available in backend mode (the only mode).
- `page-layout`: MODIFIED. Remove the "no folder-picker button" guarantee and the `useFileReader().isSupported` reference in the header-collapse scenario. The header empty-state copy SHALL drop FSA references.
- `story-selector`: MODIFIED. Remove the "FSA mode preserves loadFromFSA" carve-out from the route-based-navigation requirement. Story selection unconditionally drives router navigation.
- `plugin-hooks`: MODIFIED. Update `story:switch` and `chapter:change` context types: remove the `mode: "fsa" | "backend"` field and the `null` series/story sentinel; series and story become non-nullable strings. Remove the `loadFromFSA` dispatch site and the "Switch into FSA mode" / "FSA mode dispatch" scenarios.
- `plugin-action-buttons`: MODIFIED. Remove the "FSA mode does not render action buttons" scenarios; the `visibleWhen` enum (`"last-chapter-backend"`, `"backend-only"`) keeps both values for forward-compat, but the spec text SHALL no longer describe an FSA mode that excludes them.
- `vue-component-architecture`: MODIFIED. Remove `useFileReader()` from the canonical composable list; remove the FSA-and-IndexedDB scenario; remove `useFileReader` from the singleton-shared-state list.
- `vue-frontend-tests`: MODIFIED. Remove the File System Access API and IndexedDB mock requirements and scenarios. The remaining mock surface is `fetch`, `navigator.clipboard`, `localStorage`, and `window.location`.
- `vue-router`: MODIFIED. Update the root-route description to drop "FSA chooser"; the root view is exclusively the story selector.

## Impact

- **Code removed**:
  - `reader-src/src/composables/useFileReader.ts` (~145 lines)
  - `reader-src/src/composables/__tests__/useFileReader.test.ts` (~270 lines)
  - FSA-specific cases inside `reader-src/src/composables/__tests__/useChapterNav.test.ts`, `useChapterNav-boundary-jumps.test.ts`, `useChapterNav-edit.test.ts`, `useChapterNav-coverage.test.ts`, `usePluginActions.test.ts`
  - `mode` ref and all FSA branches in `reader-src/src/composables/useChapterNav.ts`
  - FSA branch in `reader-src/src/components/AppHeader.vue` (`handleReload`)
  - `restoreHandle()` boot path in `reader-src/src/App.vue`
  - `UseFileReaderReturn` type in `reader-src/src/types/index.ts`
- **Code modified**:
  - `App.vue` removes the FSA-restore boot block.
  - `AppHeader.vue` simplifies `handleReload()` to call `reloadToLast()` unconditionally.
  - Plugin frontend modules and the dialogue-colorize / context-compaction plugins that branch on `mode` (if any) need the conditionals removed.
  - `reader-src/src/types/index.ts` removes `UseFileReaderReturn` and any `mode: "fsa" | "backend"` fields in plugin hook context types.
- **Documentation updated**:
  - `README.md` (drop "需要 HTTPS 安全環境")
  - `AGENTS.md` (drop FSA & IndexedDB lines from Project Structure, Frontend Technology Stack, Running the Server)
  - `docs/helm-deployment.md` (remove Secure-Context rationale and FSA troubleshooting entry)
- **Test infrastructure**:
  - Remove manual IndexedDB stubs from test setup; no dependency or lockfile changes expected (`reader-src/` is a Deno project with no `package.json`; `fake-indexeddb` is not an installed dependency).
  - Remove `vi.stubGlobal("indexedDB", …)` and `window.showDirectoryPicker` mock helpers wherever they exist.
- **Specs**: 11 spec files modified or removed. After this change, `openspec/specs/file-reader/` ceases to exist.
- **No backend impact**: server, Helm chart, and container image are unchanged. `HTTP_ONLY=true` was already a fully wired deployment mode.
- **No data migration**: legacy IndexedDB entries (`storyReaderDB > handles > directoryHandle`) become orphaned but unread. They will be silently cleared when the user clears site data. We do NOT add a one-time migration to delete them; the project has zero users in the wild.
- **No backward compatibility**: per the user's standing instruction, this is treated as a clean removal.

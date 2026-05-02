## Context

The reader frontend currently exposes two chapter-loading pipelines on `useChapterNav()`:

1. **Backend mode** — `loadFromBackend(series, story)` calls `/api/stories/:series/:name/chapters` and the per-chapter endpoint, then drives Vue Router (`/:series/:story/chapter/:chapter`). Polling falls back to a 3-second `fetch` loop only when the WebSocket is disconnected.
2. **FSA mode** — `loadFromFSA(handle)` walks a `FileSystemDirectoryHandle` retrieved via `window.showDirectoryPicker()`, discovers numeric `*.md` files, and reads them with `getFile().text()`. The handle is persisted to IndexedDB (`storyReaderDB > handles > directoryHandle`) so subsequent visits can re-acquire permission via `handle.requestPermission({ mode: "read" })` without re-prompting. Polling is a 1-second `iterate-the-handle` loop.

Commit `4f3f91fe` removed the only UI affordance that called `useFileReader().openDirectory()` — the `📂 選擇資料夾` button in `AppHeader.vue`. The composable, IndexedDB persistence, App.vue boot-time `restoreHandle()` call, and the `mode === "fsa"` branches in `useChapterNav`, `AppHeader`, plugin hooks, and tests all survived because the change at the time was framed as "tighten header" rather than "drop FSA." The standing motivation for HTTPS in this project — both in `entrypoint.sh` documentation and in `docs/helm-deployment.md` — is the FSA Secure-Context requirement.

After 4f3f91fe the FSA pipeline is reachable only by:
- Running an automated test that invokes `useFileReader().openDirectory()` directly.
- Loading the app with a pre-existing IndexedDB record from before the picker was removed (legacy users only; the project has zero users in the wild).

Every chapter, plugin, and router code path therefore carries `mode === "fsa"` branching that no end user will ever execute, plus FSA-specific test scaffolding (`fake-indexeddb`, `showDirectoryPicker` mocks) that the project ships without exercising any production code.

## Goals / Non-Goals

**Goals:**

- Delete the FSA reader mode end-to-end: composable, IndexedDB persistence, App.vue boot path, AppHeader reload branch, every `mode === "fsa"` branch in `useChapterNav` and downstream consumers, and FSA-mode plugin-hook context fields.
- Collapse `useChapterNav` to a single backend pipeline. Remove the `mode` reactive ref outright; consumers that branched on it now follow the previous "backend" path unconditionally.
- Drop HTTPS from the project's hard-requirement list. HTTPS remains the default deployment mode (entrypoint.sh, Helm chart) but `HTTP_ONLY=true` becomes a fully supported topology, no longer a reverse-proxy escape hatch.
- Update specs (`file-reader` removed; nine others modified) so the OpenSpec contract matches the post-removal codebase.
- Strip FSA-specific test infrastructure (`fake-indexeddb`, `showDirectoryPicker` stubs) without weakening coverage of the backend pipeline.

**Non-Goals:**

- **No data migration.** Legacy IndexedDB entries are left untouched. Per the user's standing instruction (zero users in the wild), we explicitly do NOT add a one-time `clearStoredHandle()` cleanup. The orphaned record is harmless because no remaining code reads it.
- **No backend changes.** Server routes, Helm chart, and container image are unchanged. `HTTP_ONLY=true` was already wired through every layer (entrypoint.sh, Helm template, server.ts).
- **No re-introduction of a different local-file reader.** This change is removal-only; the `file-reader` capability ceases to exist.
- **No CSP relaxation.** The frontend's existing CSP and DOMPurify pipeline are unchanged. The Secure-Context relaxation only affects the deployment-topology rationale, not browser-runtime security policy.
- **No package-lock churn.** `reader-src/` is a Deno project; there is no `package.json` and no npm lockfile to update. `fake-indexeddb` is **not** a real dependency — the existing FSA-related tests use hand-rolled IndexedDB stubs (`vi.stubGlobal("indexedDB", …)`). Cleanup is limited to deleting those stubs from test setup files.

## Decisions

### Decision: Delete `useFileReader.ts` and the `file-reader` capability outright instead of keeping the composable as dead-but-callable

**Choice:** Delete the file, the export, the type alias (`UseFileReaderReturn`), and the entire `openspec/specs/file-reader/` directory.

**Alternative considered:** Keep the composable with `openDirectory()` exported but unreferenced, in case a future change re-introduces a local-file mode.

**Rationale:** A "dormant" composable carries hidden coupling — its types leak into shared interfaces, its tests pin `fake-indexeddb` as a dev dep, and its `mode === "fsa"` discriminator forces every downstream surface (plugin hooks, router, polling) to keep two-arm branches. Re-introducing local-file reading later (if ever) would be cheaper as a fresh feature than as a ressurection of a kept-but-disabled pipeline. The project has zero users; the cost of "we deleted a thing we might want back" is negligible.

### Decision: Remove `mode: Ref<"fsa" | "backend">` from `useChapterNav` rather than keeping it as a vestigial constant

**Choice:** Delete the ref, delete every `mode === "fsa"` and `mode === "backend"` branch, and let consumers (AppHeader, plugin hooks, polling) call the backend code path directly.

**Alternative considered:** Keep `mode` as a literal `"backend"` constant for forward-compat.

**Rationale:** A single-value enum is a code smell that lies about runtime variability. It would force every test and consumer to keep "what if mode flips?" defensive logic. The cleaner contract is "the reader has one chapter pipeline; it is the backend pipeline." Plugin-hook context types collapse from `mode: "fsa" | "backend"` to `mode: "backend"` (or, better, the field is removed entirely). We pick removal — plugins that genuinely need to know there's only one mode can hard-code it.

### Decision: Plugin-hook context types lose the `mode` discriminator and the `null` series/story sentinel

**Choice:** `story:switch` and `chapter:change` context types change from `{ series: string | null; story: string | null; mode: "fsa" | "backend" ... }` to `{ series: string; story: string ... }`. The `null` cases existed solely to represent FSA mode; with FSA gone, those fields are always populated.

**Alternative considered:** Keep `series: string | null` for forward-compat in case a future feature reintroduces a "no-story" view.

**Rationale:** Hook contracts are stronger when types match runtime invariants. A `null` series field that never occurs at runtime invites buggy plugins that handle the impossible case. Plugins that need a "no story selected" state can react to `story:switch` not having fired yet, rather than relying on a `null` sentinel.

### Decision: Action-button `visibleWhen` enum keeps both values (`"last-chapter-backend"` and `"backend-only"`)

**Choice:** Keep the enum unchanged for forward-compat. Update spec text to drop the FSA-mode exclusion clauses, but do not collapse the enum to a single value.

**Rationale:** The enum names already imply backend mode; removing them would be a needless plugin-API churn for a pre-1.0 project that may want a `"first-chapter-backend"` or similar variant later. The semantic narrowing is implicit: with FSA gone, "backend-only" is functionally equivalent to "always," but renaming the value would force every plugin manifest to migrate.

### Decision: HTTPS becomes recommended-but-optional, not removed

**Choice:** Keep `entrypoint.sh`'s self-signed-cert auto-generation as the default. Update `README.md`, `AGENTS.md`, and `docs/helm-deployment.md` to describe HTTPS as a hardening choice rather than a Secure-Context requirement *for FSA*. `HTTP_ONLY=true` is documented as a fully supported topology, not just a reverse-proxy escape hatch.

**Alternative considered:** Flip the default to HTTP and require operators to opt into TLS.

**Rationale:** TLS-by-default is still good practice (passphrase + chapter content travel over the wire). The FSA removal lifts the hard "must be HTTPS" floor but does not change the "should be HTTPS" recommendation. Operators behind a reverse proxy that already terminates TLS gain a documented path; everyone else gets the same self-signed default they had before.

### Decision: Browser compatibility — `crypto.randomUUID()` in non-secure contexts

**Context:** After FSA removal, the only remaining browser API that was historically secure-context-only is `crypto.randomUUID()`, used in `reader-src/src/composables/useChatApi.ts` (lines 73, 213, 373) to generate client-side correlation IDs for chat and plugin-action WebSocket envelopes.

**Choice:** Do NOT add a UUID polyfill / fallback path. Document the browser-version floor instead.

**Rationale:** `crypto.randomUUID()` has been exposed in non-secure contexts since Chrome 92 (Jul 2021), Firefox 95 (Dec 2021), and Safari 15.4 (Mar 2022). Per MDN, all modern evergreen browsers therefore expose it over plain HTTP. HeartReverie is a pre-1.0 project that targets current browsers only; engineering a fallback for browsers older than ~2022 is gold-plating. Plain-HTTP deployments (e.g. behind a TLS-terminating reverse proxy with `HTTP_ONLY=true`) therefore work on every supported browser without code changes. This decision is documentation-only — no spec delta is needed.

### Decision: Test infrastructure cleanup is scoped to FSA-only mocks

**Choice:** Remove `fake-indexeddb` (if present), the `vi.stubGlobal("indexedDB", …)` helpers, and `window.showDirectoryPicker` mocks from the test suite. Do NOT touch `fetch`, `localStorage`, `navigator.clipboard`, or `window.location` mocks — those serve the surviving backend code paths.

**Rationale:** The `vue-frontend-tests` spec already lists each browser API mock individually; this change is a narrow subset removal, not a sweeping test-infrastructure rewrite.

### Decision: Single OpenSpec change rather than a multi-stage proposal

**Choice:** One change (`remove-fsa-and-indexeddb`) covering composable removal, `mode` ref removal, plugin-hook context narrowing, doc updates, and test cleanup.

**Alternative considered:** Split into "phase 1: remove composable + IndexedDB"; "phase 2: collapse useChapterNav mode"; "phase 3: narrow plugin-hook types."

**Rationale:** The three phases are entangled — `mode` cannot be removed before the composable is gone; plugin-hook types cannot narrow until `mode` is gone. Splitting forces interim states where specs and code disagree (the very drift OpenSpec exists to prevent). One atomic change keeps spec and code in lockstep.

## Risks / Trade-offs

- **[Risk]** Plugins that import `useFileReader` or destructure `mode` from `useChapterNav()` break at compile time.
  - **Mitigation:** None of the seven built-in plugins import `useFileReader` directly (verified by `grep`). The two that touch `useChapterNav` (context-compaction, dialogue-colorize) consume `chapters`, `currentIndex`, and lifecycle hooks — none reference `mode`. External plugins are out of scope (no users in the wild).
- **[Risk]** Legacy users with a pre-removal IndexedDB record see no migration. After this change, the orphaned `storyReaderDB` row in their browser's storage is unreachable code.
  - **Mitigation:** Accepted explicitly. The user's standing instruction is "zero users in the wild." If a developer hits the orphan during local testing, clearing site data resolves it. The orphan does not affect the running app; nothing reads from `storyReaderDB` after this change.
- **[Risk]** Removing `mode` introduces a subtle behavioural change in any code path that previously short-circuited on FSA mode (e.g., the chapter-editing controls were hidden in FSA mode).
  - **Mitigation:** Audit each `mode === "fsa"` branch during implementation. Most either no-op'd in FSA mode (now they always run) or rendered FSA-specific UI (now deleted). Edit/rewind/branch controls become unconditionally visible — which matches the post-FSA reality where every loaded story is backend-mode.
- **[Risk]** The `vue-frontend-tests` spec currently lists IndexedDB and FSA mocks as required test infrastructure. Removing them in lockstep with the implementation requires careful spec-delta wording so that "the spec demands a mock that the implementation no longer needs" never holds during the change window.
  - **Mitigation:** This change covers both the spec delta and the implementation in a single atomic commit. The interim state is not observable by end users or by `openspec validate --strict`.
- **[Risk]** A future re-introduction of local-file reading would require re-implementing the FSA pipeline from scratch, since this change deletes it rather than archiving it.
  - **Mitigation:** Accepted. The git history retains the implementation; recovery is `git show 4f3f91fe^:reader-src/src/composables/useFileReader.ts`. The cost of re-implementing FSA later is small relative to the cost of carrying it now.
- **[Risk]** The HTTPS-required claim removal might mislead operators into deploying HTTP behind an untrusted network.
  - **Mitigation:** Documentation continues to recommend HTTPS as the default. The Helm chart defaults to TLS. Only the framing changes — from "required for FSA" to "recommended for security."

## Migration Plan

This change has **no runtime migration** for end users. Implementation follows a single commit per OpenSpec convention:

1. Update specs first (delete `file-reader/`, modify nine others) so `openspec validate --strict` reflects the target state.
2. Delete `useFileReader.ts` and its tests.
3. Remove `restoreHandle()` from `App.vue` and the FSA branch from `AppHeader.vue`.
4. Strip `mode` ref, `loadFromFSA`, `loadFSAChapter`, and FSA branches from `useChapterNav.ts`. Update its return type.
5. Remove FSA fields from plugin-hook context types in `reader-src/src/types/index.ts` and update `reader-src/src/lib/plugin-hooks.ts` dispatch sites.
6. Remove FSA mocks (`fake-indexeddb`, `showDirectoryPicker`) from test files. Update remaining `useChapterNav` tests to drop FSA-mode assertions.
7. Skip — `reader-src/` has no `package.json`; manual IndexedDB stubs were already removed in step 6.
8. Update `README.md`, `AGENTS.md`, `docs/helm-deployment.md` per the proposal's "Documentation updated" list.
9. Run `deno task test:frontend`, `deno task test:backend`, `deno task build:reader`, and `openspec validate remove-fsa-and-indexeddb --strict`.

**Rollback strategy:** Revert the implementation commit. Specs and code stay in lockstep because the change is atomic. No data, no schema, no backend artifact is touched, so revert is mechanically clean.

## Open Questions

- **Should the `mode` field in plugin-hook context types be removed entirely or kept as a literal `"backend"`?** The proposal recommends removal. If a downstream consumer (e.g., a future plugin) depends on a string-typed mode field for symmetry with other discriminators, we could keep it as `mode: "backend"`. Decision deferred to implementation: default to removal, switch to literal-string if the type-narrowing churn cascades unexpectedly.
- **Should we delete the legacy IndexedDB schema in a one-time boot-time cleanup?** The proposal says no. If a developer sees a frequent need to clean up local state during testing, a future maintenance change can add a one-time `indexedDB.deleteDatabase("storyReaderDB")` call. Not blocking.

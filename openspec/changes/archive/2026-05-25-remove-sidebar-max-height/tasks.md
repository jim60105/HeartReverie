## 1. Core CSS Change

- [x] 1.1 Edit `reader-src/src/components/Sidebar.vue` and remove only the default desktop `.sidebar` declaration `max-height: calc(100vh - var(--header-height) - 16px);`.
- [x] 1.2 Preserve `position: sticky`, `overflow-y: auto`, `scrollbar-width: none`, `.sidebar::-webkit-scrollbar`, `.sidebar:empty`, `.sidebar.sidebar--hidden-during-stream`, and the full `@media (max-width: 767px)` block.
- [x] 1.3 Inspect `reader-src/src/components/Sidebar.vue` and confirm the mobile override still explicitly declares `.sidebar { position: static; max-height: none; overflow-y: visible; }`.
- [x] 1.4 Search `reader-src/`, `plugins/`, and `openspec/specs/page-layout/spec.md` for the exact removed declaration and confirm no live runtime CSS still applies it to `.sidebar`.

## 2. Local Verification

- [x] 2.1 Run the focused frontend test suite that covers sidebar and content relocation: `deno task test:frontend -- reader-src/src/components/__tests__/Sidebar.test.ts reader-src/src/components/__tests__/ContentArea.test.ts`.
- [x] 2.2 Run `deno task build:reader` to confirm the Vue/Vite frontend build accepts the CSS change.
- [x] 2.3 Inspect the built/source CSS or a browser-computed style at a desktop viewport width (≥ 768px) and confirm the desktop `.sidebar` rule has no viewport-relative `max-height`, while a mobile viewport still computes `max-height: none`.

## 3. Container Integration Verification

- [x] 3.1 Build and run the container from the core project root with `scripts/podman-build-run.sh`.
- [x] 3.2 Check startup logs with `podman logs heartreverie 2>&1 | grep -i "error\\|warn"` and confirm there is no output; grep exit code `1` is acceptable when no matches are found.
- [x] 3.3 Trigger a representative API endpoint with `curl -H "X-Passphrase: $PASSPHRASE" http://localhost:8080/api/themes` and confirm it returns theme configuration JSON.
- [x] 3.4 Use the `agent-browser` frontend testing workflow against `http://localhost:8080/` at a desktop viewport width (≥ 768px) to verify the reader loads, plugin sidebar relocation still places `.plugin-sidebar` panels inside `aside.sidebar`, and `getComputedStyle(document.querySelector(".sidebar")).maxHeight` is not the removed viewport-relative cap.
- [x] 3.5 In the same browser session, trigger or simulate the loading state and verify `.sidebar--hidden-during-stream` still suppresses the sidebar while preserving restored visibility after loading.

## 4. Spec Hygiene

- [x] 4.1 Run `openspec status --change remove-sidebar-max-height` and confirm the change remains apply-ready.
- [x] 4.2 Run the repository formatter/linter commands if implementation touched files beyond the single CSS declaration.

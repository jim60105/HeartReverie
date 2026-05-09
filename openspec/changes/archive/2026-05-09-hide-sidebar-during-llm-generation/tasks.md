## 1. Sidebar.vue: bind hidden-during-stream class

- [x] 1.1 Import `useChatApi` in `HeartReverie/reader-src/src/components/Sidebar.vue` `<script setup>` and pull `isLoading`.
- [x] 1.2 Bind `:class="{ 'sidebar--hidden-during-stream': isLoading }"` on the `<aside class="sidebar">` element. Keep the existing `sidebar` class.
- [x] 1.3 Verify the `<script setup lang="ts">` block compiles with the import and that no unused-variable lint warnings are introduced.

## 2. Sidebar.vue: CSS rules for hidden state

- [x] 2.1 In `Sidebar.vue` `<style scoped>`, add a desktop rule `.sidebar.sidebar--hidden-during-stream { visibility: hidden; opacity: 0; pointer-events: none; }` placed after the existing `.sidebar` rules so specificity-tied properties stick.
- [x] 2.2 Inside the existing `@media (max-width: 767px)` block, add `.sidebar.sidebar--hidden-during-stream { display: none; }` so the empty vertical slot collapses on mobile.
- [x] 2.3 Confirm no `transition` on `visibility` / `opacity` is added — the toggle SHALL be immediate.
- [x] 2.4 Confirm `display` is NOT changed in the desktop rule (must remain whatever the layout chose) so the chapter column's width is preserved.

## 3. Verify no persistence is introduced

- [x] 3.1 Grep `Sidebar.vue` and any newly touched code for `localStorage`, `sessionStorage`, `IndexedDB`, `document.cookie`, and `window.location` to confirm the hidden state is not written anywhere.
- [x] 3.2 Confirm `useChatApi.ts` already initialises `isLoading = ref(false)` at module scope (existing behaviour) and SHALL NOT add any persistence wrapper around it.

## 4. Tests

- [x] 4.1 Create or extend `HeartReverie/reader-src/src/components/__tests__/Sidebar.test.ts` (mirroring the style of `ChatInput.test.ts` which already mocks `useChatApi` with a `streamingContentRef` / `isLoadingRef`).
- [x] 4.2 Test "hides while loading on desktop": with `isLoading = true`, mount `Sidebar.vue`, assert `<aside>` carries the `sidebar--hidden-during-stream` class.
- [x] 4.3 Test "shows when done": flip `isLoading` to `false`, await `nextTick`, assert the class is gone.
- [x] 4.4 Test "starts visible on fresh mount": with a freshly imported `useChatApi` and `isLoading` defaulting to `false`, assert no hidden class on `<aside>`.
- [x] 4.5 Test "DOM is not unmounted across class toggles": render `<Sidebar><div data-testid="child">x</div></Sidebar>`, capture the child node reference, toggle `isLoading` true→false→true→false, assert the same node reference persists each cycle. (NOTE: this only tests the class-toggle path. It does NOT prove relocated `.plugin-sidebar` nodes survive `ContentArea.vue` content mutations during streaming — that is intentionally out of scope per the design's "visual-only mitigation" framing.)
- [x] 4.6 Run `cd HeartReverie/reader-src && npm test -- Sidebar` and confirm all new and pre-existing Sidebar / ContentArea tests pass.

## 5. Container build + browser smoke test

- [x] 5.1 Run `HeartReverie/scripts/podman-build-run.sh` to build and start the container.
- [x] 5.2 Run `podman logs heartreverie 2>&1 | grep -iE "error|warn"` and confirm clean startup.
- [x] 5.3 Use the `agent-browser` skill against `http://localhost:8080/` to: open a story, send a chat message, observe that the sidebar disappears immediately when the streaming preview shows, observe that it reappears when streaming completes, and reload the page (verify sidebar starts visible regardless of any prior state).
- [x] 5.4 Capture before/after screenshots demonstrating no flicker on the right edge during streaming (e.g., `tmp/sidebar-during-stream.png`, `tmp/sidebar-after-stream.png`).

## 6. OpenSpec validation

- [x] 6.1 Run `cd HeartReverie && openspec validate hide-sidebar-during-llm-generation --strict` and confirm it passes.

## 7. Rubber-duck critique (single sync pass)

- [x] 7.1 After all artifacts above are complete (proposal, design, specs/page-layout/spec.md, tasks.md), invoke the rubber-duck agent ONCE in `mode: sync` with `model: gpt-5.5` to critique the full set. Address any high-signal findings (correctness, blind spots, missing scenarios). Do NOT call rubber-duck more than once.

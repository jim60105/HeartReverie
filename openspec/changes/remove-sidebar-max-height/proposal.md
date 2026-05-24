## Why

The reading sidebar currently keeps an internal viewport-relative height cap even after the previous change made it scroll with the chapter content instead of pinning to the viewport. That cap now creates an artificial nested scroll area inside a non-pinning sidebar, so tall plugin panels can feel clipped while the main page still has room to continue scrolling naturally.

Removing `max-height: calc(100vh - var(--header-height) - 16px);` from the host `.sidebar` aligns the implementation with the current non-pinning layout: the sidebar should participate in the page's normal reading flow on desktop and keep the existing mobile behavior.

## What Changes

- `reader-src/src/components/Sidebar.vue`: remove the default desktop `.sidebar` declaration `max-height: calc(100vh - var(--header-height) - 16px);`.
- Preserve `position: sticky`, `overflow-y: auto`, hidden scrollbar rules, `.sidebar:empty`, and `.sidebar--hidden-during-stream` behavior.
- Preserve the mobile breakpoint block, including `position: static`, `max-height: none`, `overflow-y: visible`, and mobile `display: none` while hidden during streaming.
- Update the `page-layout` specification so the reading sidebar no longer promises an internal max-height cap or an internal scrollbar for tall plugin sidebars.

No API, data, migration, or backward-compatibility work is required. The project is pre-release with zero users in the wild.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `page-layout`: revise the reading sidebar layout contract so the desktop `.sidebar` selector SHALL NOT declare the viewport-relative `max-height` cap, and tall sidebar content SHALL grow with the page rather than forcing an internal sidebar scroll container.

## Impact

- **Affected file**: `reader-src/src/components/Sidebar.vue` scoped styles.
- **Affected spec**: `openspec/specs/page-layout/spec.md` delta under this change.
- **Frontend behavior**: desktop sidebar panels can grow to their natural height and scroll with the document; the scrollbar hiding rule remains harmless if overflow is introduced by future styles.
- **Plugin contract**: `.plugin-sidebar` relocation is unchanged. Plugin panels remain responsible for their own internal scroll behavior where a panel needs a bounded subregion.
- **Verification**: run the container with `scripts/podman-build-run.sh`, check startup logs, open `http://localhost:8080/` with `agent-browser`, and verify the computed desktop `.sidebar` style no longer includes the removed max-height declaration while sidebar relocation, empty collapse, and hide-during-stream behavior remain intact.

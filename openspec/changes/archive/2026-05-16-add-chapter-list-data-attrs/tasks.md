## 1. Chapter List Data Attributes

- [x] 1.1 Wrap the chapter navigation controls in `AppHeader.vue` (`<template v-if="hasChapters">` block) with a `<nav data-chapter-list>` element
- [x] 1.2 Add `data-chapter-number` attributes to each of the 5 navigation elements (first, prev, progress, next, last), using computed 1-based chapter numbers (first=1, prev=currentIndex, progress=currentIndex+1, next=currentIndex+2, last=totalChapters)
- [x] 1.3 Add CSS for `[data-chapter-list]` to preserve header flex layout — use `display: contents` on the `<nav>` so the 5 children remain direct flex participants of `.header-row`

## 2. Plugin Panel Slot

- [x] 2.1 Add `<div id="plugin-panel-slot">` to `MainLayout.vue` as a direct child of `.main-layout`, after the `<main>` element
- [x] 2.2 Add CSS for `#plugin-panel-slot`: `position: fixed; inset: 0; z-index: 100; pointer-events: none` (scoped is fine for the container). For the child rule `> * { pointer-events: auto }`, use `:deep()` selector or an unscoped `<style>` block — plugin-appended DOM lacks Vue's scoped attribute so plain scoped selectors won't match

## 3. Tests

- [x] 3.1 Add/update Vitest tests in `AppHeader.test.ts` to verify `data-chapter-list` presence, `data-chapter-number` values at different chapter positions, and absence when no chapters exist
- [x] 3.2 Add/update Vitest tests in `MainLayout.test.ts` to verify `#plugin-panel-slot` is rendered in the DOM

## 4. Integration Verification

- [x] 4.1 Build the container with `scripts/podman-build-run.sh`, verify clean startup logs, and confirm the data attributes and plugin-panel-slot are present in the served HTML/rendered DOM

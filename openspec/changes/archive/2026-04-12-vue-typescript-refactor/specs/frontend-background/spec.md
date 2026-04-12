# Frontend Background (Delta)

Delta spec for the vue-typescript-refactor change.

## MODIFIED Requirements

### Requirement: Frontend config fetching

The frontend SHALL fetch `/api/config` on application mount via a `useBackground()` composable or within `App.vue`'s `<script setup>` block, and apply the `backgroundImage` value to `document.body.style.backgroundImage`. The fetch SHALL be non-blocking — if it fails, the page SHALL render normally with the fallback background colour. The composable SHALL use Vue's `onMounted()` lifecycle hook instead of an inline `<script>` tag in `index.html`.

#### Scenario: Background applied on application mount
- **WHEN** the Vue application mounts and `/api/config` returns successfully
- **THEN** the `useBackground()` composable (or `App.vue` setup) SHALL set `document.body.style.backgroundImage` to `url(<backgroundImage value>)`

#### Scenario: Graceful degradation on fetch failure
- **WHEN** the Vue application mounts and `/api/config` fails (network error, server down)
- **THEN** the page SHALL render normally with the `#0f0a0c` fallback background and no errors thrown to the console

#### Scenario: No inline script for background fetching
- **WHEN** the `index.html` file is inspected
- **THEN** it SHALL NOT contain any inline `<script>` block that fetches `/api/config` — the logic SHALL reside in a Vue composable or component setup function

### Requirement: Fixed viewport-covering background image

The `body` element SHALL display the configured background image as a fixed, viewport-covering background using `background: url(...) center/cover no-repeat fixed`. The existing `background-color: #0f0a0c` SHALL remain as a fallback beneath the image. The CSS rules for the body background and `body::before` overlay SHALL be defined in the shared theme CSS file or base styles, not in an inline `<style>` block in `index.html`.

#### Scenario: Background image covers viewport
- **WHEN** the page is rendered with a valid background image
- **THEN** the `body` element SHALL display the image covering the entire viewport without repeating, and the image SHALL remain fixed during scrolling

#### Scenario: Fallback when image fails to load
- **WHEN** the configured background image cannot be loaded
- **THEN** the `body` background-color `#0f0a0c` SHALL remain visible as the fallback

### Requirement: Semi-transparent overlay

A `body::before` pseudo-element SHALL render a semi-transparent black overlay (`rgba(0, 0, 0, 0.5)`) covering the entire viewport. The overlay SHALL be positioned fixed, span the full viewport, and sit below all page content (using `z-index: -1`). This ensures text remains legible against the background image.

#### Scenario: Overlay renders at 50% opacity
- **WHEN** the page is rendered with a background image
- **THEN** a `body::before` pseudo-element SHALL exist with `background: rgba(0, 0, 0, 0.5)`, `position: fixed`, and dimensions covering the full viewport

#### Scenario: Overlay does not block interaction
- **WHEN** the user interacts with page content (clicking buttons, selecting text)
- **THEN** the overlay SHALL NOT intercept pointer events (via `pointer-events: none` or equivalent `z-index` layering)

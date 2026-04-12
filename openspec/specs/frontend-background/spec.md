# Frontend Background

## Purpose

Provides a configurable background image for the web reader, served from a dedicated assets route, exposed via a public config endpoint, and rendered as a fixed viewport-covering image with a semi-transparent overlay.

## Requirements

### Requirement: BACKGROUND_IMAGE environment variable
The server SHALL read a `BACKGROUND_IMAGE` environment variable. If unset, the value SHALL default to `/assets/heart.webp`. The value SHALL be treated as a URL path and returned verbatim to the frontend.

#### Scenario: Default background path when env var is unset
- **WHEN** the server starts without `BACKGROUND_IMAGE` set
- **THEN** the config endpoint SHALL return `/assets/heart.webp` as the background image path

#### Scenario: Custom background path when env var is set
- **WHEN** the server starts with `BACKGROUND_IMAGE` set to `/assets/custom-bg.png`
- **THEN** the config endpoint SHALL return `/assets/custom-bg.png` as the background image path

### Requirement: Assets static route
The server SHALL serve files from the project-root `assets/` directory at the `/assets/` URL path. This route SHALL be mounted before the `READER_DIR` catch-all static route.

#### Scenario: Asset file is accessible
- **WHEN** a client requests `GET /assets/heart.webp`
- **THEN** the server SHALL respond with the file contents and appropriate content-type header

#### Scenario: Missing asset returns 404
- **WHEN** a client requests `GET /assets/nonexistent.png`
- **THEN** the server SHALL respond with a 404 status

### Requirement: Public config endpoint
The server SHALL expose a `GET /api/config` endpoint that returns a JSON object containing `{ "backgroundImage": "<BACKGROUND_IMAGE value>" }`. This endpoint SHALL NOT require authentication so the frontend can fetch configuration before the user enters a passphrase.

#### Scenario: Config endpoint returns background image path
- **WHEN** a client sends `GET /api/config`
- **THEN** the server SHALL respond with status 200 and a JSON body containing the `backgroundImage` field

#### Scenario: Config endpoint is accessible without authentication
- **WHEN** a client sends `GET /api/config` without an `X-Passphrase` header
- **THEN** the server SHALL respond with status 200 (not 401)

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

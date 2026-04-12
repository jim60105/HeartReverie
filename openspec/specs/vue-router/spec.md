# Vue Router

## Purpose

Manages client-side routing using Vue Router with HTML5 history mode, defining resource-oriented URL structure for story/chapter navigation.

## Requirements

### Requirement: Router instance and history mode

The application SHALL create a Vue Router instance using `createRouter()` with `createWebHistory()` for HTML5 history mode. The router SHALL be installed on the Vue app via `app.use(router)` in `main.ts`. The router instance SHALL be exported from a dedicated `router/index.ts` module for use by composables.

#### Scenario: Router installed on Vue app
- **WHEN** the Vue application is created in `main.ts`
- **THEN** a Vue Router instance with `createWebHistory()` SHALL be installed via `app.use(router)` before `app.mount()`

#### Scenario: Router module exports instance
- **WHEN** a composable or component imports from `@/router`
- **THEN** the default export SHALL be the configured Vue Router instance

### Requirement: Route definitions

The router SHALL define the following routes with resource-oriented paths:

1. `/` — Root route, renders the main reader view (story selector / FSA chooser)
2. `/:series/:story` — Story route, loads the specified story and navigates to chapter 1
3. `/:series/:story/chapter/:chapter` — Chapter route, loads the specified story and navigates to the specified chapter (1-indexed)

All three routes SHALL render the same root component (`MainLayout` or equivalent). Route params SHALL be typed as strings and parsed to appropriate types by consuming composables.

#### Scenario: Root route renders reader view
- **WHEN** the user navigates to `/`
- **THEN** the router SHALL render the main reader view with the story selector visible

#### Scenario: Story route loads story at chapter 1
- **WHEN** the user navigates to `/:series/:story` (e.g., `/my-series/my-story`)
- **THEN** the router SHALL resolve the route with `series` and `story` params, and the application SHALL load the story starting at chapter 1

#### Scenario: Chapter route loads specific chapter
- **WHEN** the user navigates to `/:series/:story/chapter/:chapter` (e.g., `/my-series/my-story/chapter/3`)
- **THEN** the router SHALL resolve the route with `series`, `story`, and `chapter` params, and the application SHALL navigate to chapter 3 (0-indexed: `currentIndex = 2`)

#### Scenario: Invalid chapter number defaults to last chapter
- **WHEN** the user navigates to a chapter route where `:chapter` exceeds the total number of chapters
- **THEN** the application SHALL clamp the chapter index to the last available chapter

### Requirement: No conflict with backend routes

Frontend route definitions SHALL NOT match paths beginning with `/api/`, `/plugins/`, `/assets/`, or `/js/`. These prefixes are reserved for backend API endpoints, plugin module serving, static assets, and legacy compatibility routes respectively.

#### Scenario: API path not matched by router
- **WHEN** the browser requests `/api/stories`
- **THEN** the Vue Router SHALL NOT intercept the request; it SHALL be handled by the backend

#### Scenario: Plugin path not matched by router
- **WHEN** the browser requests `/plugins/status/frontend.js`
- **THEN** the Vue Router SHALL NOT intercept the request; it SHALL be handled by the backend

### Requirement: Catch-all route for unmatched paths

The router SHALL define a catch-all route that matches any path not matched by the defined routes. This catch-all SHALL redirect to the root route `/` to prevent users from landing on a blank page.

#### Scenario: Unknown path redirects to root
- **WHEN** the user navigates to an undefined path (e.g., `/nonexistent/path`)
- **THEN** the router SHALL redirect to `/`

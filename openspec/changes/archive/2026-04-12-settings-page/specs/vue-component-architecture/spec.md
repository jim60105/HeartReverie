# Vue Component Architecture

## MODIFIED Requirements

### Requirement: Component hierarchy

The Vue application SHALL follow a single root hierarchy with two top-level routed layouts: `App.vue` → `PassphraseGate` → (router-view renders either `MainLayout` or `SettingsLayout` based on current route).

**MainLayout branch**: `MainLayout` → (`AppHeader`, `ContentArea`, `Sidebar`, `ChatInput`, `StorySelector`, `ChapterContent`, `VentoErrorCard`). `MainLayout` SHALL orchestrate the grid layout and conditionally render child components based on application state. The `AppHeader` within `MainLayout` SHALL replace the previous `⚙️ Prompt` button with a gear icon that navigates to the `/settings` route via `router.push('/settings')`. The `AppHeader` SHALL NOT contain `showEditor`, `showPreview` state, or `<Teleport>` directives for editor/preview overlays.

**SettingsLayout branch**: `SettingsLayout` → (sidebar with tab navigation, `<router-view />` content area rendering `PromptEditorPage`). `SettingsLayout` is a top-level routed component alongside `MainLayout`, not nested within it. `PromptEditorPage` wraps `PromptEditor` and inline `PromptPreview`.

The component hierarchy SHALL NOT include plugin-specific components such as `StatusBar`, `OptionsPanel`, or `VariableDisplay` — these are rendered as HTML strings by their respective plugins' `frontend.js` modules and injected via `v-html` in `html` tokens. `App.vue` SHALL be the mount point registered via `createApp()`. `PassphraseGate` SHALL gate all content behind authentication.

#### Scenario: App mounts root component
- **WHEN** the application entry point (`main.ts`) is executed
- **THEN** `createApp(App)` SHALL mount `App.vue` to the `#app` element in `index.html`

#### Scenario: PassphraseGate blocks unauthenticated access
- **WHEN** the user has not authenticated
- **THEN** `PassphraseGate` SHALL render the passphrase overlay and SHALL NOT render `MainLayout`, `SettingsLayout`, or any child components

#### Scenario: MainLayout renders after authentication on reader routes
- **WHEN** the user successfully authenticates and is on a reader route (`/`, `/:series/:story`, or `/:series/:story/chapter/:chapter`)
- **THEN** `MainLayout` SHALL render and display `AppHeader`, `ContentArea`, `Sidebar`, `ChatInput`, and other child components according to current application state

#### Scenario: SettingsLayout renders on settings routes
- **WHEN** the user navigates to `/settings/prompt-editor`
- **THEN** `SettingsLayout` SHALL render with a sidebar and content area, and the content area SHALL display `PromptEditorPage`

#### Scenario: AppHeader uses gear icon for settings navigation
- **WHEN** the `AppHeader` component is rendered within `MainLayout`
- **THEN** it SHALL display a gear icon button that calls `router.push('/settings')` when clicked, replacing the previous `⚙️ Prompt` button and removing any `showEditor`/`showPreview` state or `<Teleport>` overlay logic

#### Scenario: No plugin-specific Vue components in reader-src
- **WHEN** listing Vue component files in `reader-src/src/components/`
- **THEN** no `StatusBar.vue`, `OptionsPanel.vue`, or `VariableDisplay.vue` SHALL exist — plugin rendering is done by plugin `frontend.js` modules producing HTML strings

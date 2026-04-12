## MODIFIED Requirements

### Requirement: Component hierarchy

The Vue application SHALL follow a single root hierarchy: `App.vue` → `PassphraseGate` → `MainLayout` → (`AppHeader`, `ContentArea`, `Sidebar`, `ChatInput`, `PromptEditor`, `PromptPreview`, `StorySelector`, `ChapterContent`, `VentoErrorCard`). The component hierarchy SHALL NOT include plugin-specific components such as `StatusBar`, `OptionsPanel`, or `VariableDisplay` — these are rendered as HTML strings by their respective plugins' `frontend.js` modules and injected via `v-html` in `html` tokens. `App.vue` SHALL be the mount point registered via `createApp()`. `PassphraseGate` SHALL gate all content behind authentication. `MainLayout` SHALL orchestrate the grid layout and conditionally render child components based on application state.

#### Scenario: App mounts root component
- **WHEN** the application entry point (`main.ts`) is executed
- **THEN** `createApp(App)` SHALL mount `App.vue` to the `#app` element in `index.html`

#### Scenario: PassphraseGate blocks unauthenticated access
- **WHEN** the user has not authenticated
- **THEN** `PassphraseGate` SHALL render the passphrase overlay and SHALL NOT render `MainLayout` or any child components

#### Scenario: MainLayout renders after authentication
- **WHEN** the user successfully authenticates via `PassphraseGate`
- **THEN** `MainLayout` SHALL render and display `AppHeader`, `ContentArea`, `Sidebar`, `ChatInput`, and other child components according to current application state

#### Scenario: No plugin-specific Vue components in reader-src
- **WHEN** listing Vue component files in `reader-src/src/components/`
- **THEN** no `StatusBar.vue`, `OptionsPanel.vue`, or `VariableDisplay.vue` SHALL exist — plugin rendering is done by plugin `frontend.js` modules producing HTML strings

### Requirement: TypeScript strict mode with interface definitions

All frontend TypeScript code SHALL compile under `strict: true` with `noImplicitAny`, `strictNullChecks`, and `noUncheckedIndexedAccess` enabled. All component props SHALL be defined using `defineProps<T>()` with an explicit TypeScript interface. All component emits SHALL be defined using `defineEmits<T>()` with typed event signatures. All composable return types SHALL have explicit interface definitions exported from the composable file. The shared types module (`reader-src/src/types/index.ts`) SHALL NOT contain plugin-specific interfaces such as `StatusBarProps`, `CloseUpEntry`, `OptionItem`, `OptionsPanelProps`, `VariableDisplayProps`, or `OptionsPanelEmits` — these types belong within their respective plugins.

#### Scenario: Props defined with TypeScript interface
- **WHEN** a component accepts props (e.g., `ContentArea` receiving chapter content)
- **THEN** it SHALL use `defineProps<ContentAreaProps>()` where `ContentAreaProps` is an explicitly defined interface

#### Scenario: Emits defined with TypeScript interface
- **WHEN** a component emits events (e.g., `ChatInput` emitting a message submission)
- **THEN** it SHALL use `defineEmits<{ submit: [message: string] }>()` with typed event payloads

#### Scenario: No plugin-specific types in shared types module
- **WHEN** inspecting `reader-src/src/types/index.ts`
- **THEN** no plugin-specific interfaces (such as `StatusBarProps`, `OptionItem`, `VariableDisplayProps`) SHALL be defined — only core application types

#### Scenario: Strict compilation passes
- **WHEN** `deno task build:reader` is executed
- **THEN** the Vite/Vue TypeScript compilation SHALL succeed with zero type errors under strict mode

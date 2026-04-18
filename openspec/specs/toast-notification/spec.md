# Toast Notification

## Purpose

Unified notification system providing both in-app toast notifications and browser system notifications via a shared composable, with automatic channel selection and graceful fallback.

## Requirements

### Requirement: Notification composable API

The system SHALL provide a `useNotification()` composable that returns:
- `notify(options: NotifyOptions): string` — display a notification, returns a unique notification ID
- `dismiss(id: string): void` — programmatically dismiss a notification by ID
- `requestPermission(): Promise<NotificationPermission>` — request browser notification permission
- `permissionState: Ref<NotificationPermission | 'unsupported'>` — reactive permission state

The `NotifyOptions` interface SHALL have:
- `title: string` (required) — notification title text
- `body?: string` — optional body/description text
- `level?: 'info' | 'success' | 'warning' | 'error'` — defaults to `'info'`
- `position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center'` — defaults to `'top-right'`
- `channel?: 'in-app' | 'system' | 'auto'` — defaults to `'auto'`
  - `'in-app'`: always shows an in-app toast only
  - `'system'`: attempts browser Notification API only; if permission is denied/unsupported, the notification is silently dropped (no fallback)
  - `'auto'`: prefers system notification, falls back to in-app toast if permission denied, unsupported, or page is hidden with permission still `'default'`
- `duration?: number` — auto-dismiss duration in ms; defaults to 5000 for info/success, 8000 for warning/error; set to 0 for persistent

The returned notification ID SHALL apply only to in-app toasts. System notifications are fire-and-forget; `dismiss()` has no effect on system notifications.

#### Scenario: Display an info toast notification
- **WHEN** code calls `notify({ title: 'Hello' })`
- **THEN** an info-level toast SHALL appear in the top-right position and auto-dismiss after 5000ms

#### Scenario: Display an error toast with custom position
- **WHEN** code calls `notify({ title: 'Error', level: 'error', position: 'bottom-center' })`
- **THEN** an error-level toast SHALL appear at bottom-center and auto-dismiss after 8000ms

#### Scenario: System notification when permitted
- **WHEN** code calls `notify({ title: 'Done', channel: 'system' })` and Notification permission is 'granted'
- **THEN** a browser system notification SHALL be displayed with title 'Done'

#### Scenario: System channel silently drops when denied
- **WHEN** code calls `notify({ title: 'Done', channel: 'system' })` and Notification permission is 'denied'
- **THEN** no notification SHALL be displayed (no fallback to in-app)

#### Scenario: Auto channel falls back to in-app when system denied
- **WHEN** code calls `notify({ title: 'Done', channel: 'auto' })` and Notification permission is 'denied'
- **THEN** an in-app toast SHALL be displayed instead

#### Scenario: Auto channel falls back when Notification API unsupported
- **WHEN** code calls `notify({ title: 'Done', channel: 'auto' })` and the browser does not support the Notification API
- **THEN** an in-app toast SHALL be displayed instead and `permissionState` SHALL be `'unsupported'`

#### Scenario: Auto channel with default permission while page hidden
- **WHEN** code calls `notify({ title: 'Done', channel: 'auto' })` and permission is `'default'` and `document.visibilityState` is `'hidden'`
- **THEN** the system SHALL NOT prompt for permission and SHALL fall back to in-app toast

#### Scenario: Dismiss a notification by ID
- **WHEN** code calls `dismiss(id)` with a valid notification ID
- **THEN** the corresponding toast SHALL be removed from display immediately

#### Scenario: Persistent notification with duration 0
- **WHEN** code calls `notify({ title: 'Important', duration: 0 })`
- **THEN** the toast SHALL remain visible until explicitly dismissed by the user or programmatically

### Requirement: Toast container component

The system SHALL provide a `ToastContainer.vue` component that:
- Renders all active in-app toast notifications
- Groups toasts by position (6 position slots)
- Displays each toast with level-appropriate visual styling (color/icon)
- Provides a close button on each toast for manual dismissal
- Animates toast entry and exit (fade/slide)
- Caps maximum toasts per position at 5; when exceeded, the oldest toast in that position SHALL be dismissed

The component SHALL be mounted once in `App.vue` and SHALL NOT require props.

#### Scenario: Toast renders with correct level styling
- **WHEN** a success-level toast is active
- **THEN** the toast SHALL display with success-appropriate styling (green color scheme)

#### Scenario: Close button dismisses toast
- **WHEN** user clicks the close button on a toast
- **THEN** the toast SHALL be removed from display immediately

#### Scenario: Maximum toast cap enforcement
- **WHEN** 6 toasts are queued for the same position
- **THEN** the oldest toast SHALL be automatically dismissed, leaving at most 5 visible

#### Scenario: Multiple positions render independently
- **WHEN** toasts are active at top-right and bottom-left positions simultaneously
- **THEN** both position groups SHALL render without interfering with each other

### Requirement: Notification composable singleton state

The `useNotification()` composable SHALL use a **shared global store** (module-level reactive state) so that all callers share the same toast queue and permission state. Multiple calls to `useNotification()` across components and composables SHALL return references to the same underlying state. The `ToastContainer.vue` component reads from the same shared queue.

#### Scenario: Multiple callers share state
- **WHEN** component A calls `useNotification().notify(...)` and component B reads toast state from `useNotification()`
- **THEN** both SHALL observe the same toast in the queue

#### Scenario: ToastContainer reflects all notifications
- **WHEN** any caller triggers a toast via `notify()`
- **THEN** the single `ToastContainer` instance SHALL display it regardless of which component triggered it

### Requirement: Permission request flow

The system SHALL request browser Notification permission only when:
- `requestPermission()` is explicitly called, OR
- A notification with `channel: 'auto'` is triggered for the first time and permission state is `'default'` **and the page is visible** (`document.visibilityState === 'visible'`)

The system SHALL NOT request permission on page load, composable initialization, or when the page is hidden. When permission is `'default'` and the page is hidden, `auto` channel SHALL fall back to in-app toast without prompting.

#### Scenario: Permission requested on first auto notification
- **WHEN** the first notification with `channel: 'auto'` is triggered and permission is `'default'`
- **THEN** the system SHALL call `Notification.requestPermission()` and await the result before deciding delivery channel

#### Scenario: Permission not requested on initialization
- **WHEN** `useNotification()` is first called
- **THEN** no permission prompt SHALL appear; only `Notification.permission` is read passively

#### Scenario: Granted permission enables system notifications
- **WHEN** user grants notification permission
- **THEN** subsequent `channel: 'auto'` notifications SHALL use system delivery

#### Scenario: Denied permission uses in-app fallback
- **WHEN** user denies notification permission
- **THEN** subsequent `channel: 'auto'` notifications SHALL fall back to in-app toast; `channel: 'system'` notifications SHALL be silently dropped

## Why

The application currently has no unified notification mechanism for communicating state changes to users. When the LLM finishes generating a response (which may take 30+ seconds), the user has no feedback if the browser tab is in the background. A toast notification system provides both in-app visual cues and browser-level (system) notifications, enabling plugins to communicate events to users in a standardized way.

## What Changes

- Add a frontend notification composable (`useNotification`) providing a centralized API for displaying toast notifications with configurable level (info, success, warning, error), position (top-left, top-right, bottom-left, bottom-right, top-center, bottom-center), and delivery channel (in-app toast, system-level browser notification, or auto with fallback).
- Add a new frontend hook stage (`notification`) that plugins can dispatch to trigger notifications from their own frontend modules.
- Register system-level browser Notification API with permission request; automatically fall back to in-app toast when system notifications are denied or unavailable.
- Add a `ToastContainer.vue` component that renders stacked, auto-dismissing toast cards with level-based styling.
- Create a new core plugin `response-notify` under `plugins/` that listens to the `chat:done` WebSocket event and triggers a system notification (with in-app fallback) when LLM generation completes while the page is not visible.

## Capabilities

### New Capabilities
- `toast-notification`: Frontend notification composable, toast container component, and plugin notification hook providing level/position/channel-configurable notifications with system-level browser notification support and graceful fallback.
- `response-notify-plugin`: Core plugin that triggers a system notification on LLM response completion when the browser tab is not active.

### Modified Capabilities
- `plugin-hooks`: Add a new `notification` frontend hook stage that plugins can dispatch to trigger notifications.

## Impact

- **Frontend**: New composable (`useNotification.ts`), new component (`ToastContainer.vue`), new CSS styles, extended `plugin-hooks.ts` with `notification` stage, updated frontend types
- **Plugins**: New core plugin `plugins/response-notify/` with `plugin.json` and `frontend.js`
- **Dependencies**: None — uses the standard browser Notification API and existing Vue reactivity
- **APIs**: No backend API changes — notifications are purely frontend-driven; plugins use the frontend hook system

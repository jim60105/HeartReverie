## Context

HeartReverie is a developer-oriented AI interactive fiction engine. The frontend is a Vue 3 SPA communicating with a Hono/Deno backend via WebSocket. The plugin system provides a `frontend-render` hook stage for frontend modules and 5 backend hook stages. The WebSocket protocol dispatches `chat:done` when LLM generation completes.

Currently there is no notification system — the user receives no feedback when generation completes while the tab is backgrounded. Plugins also have no standardized way to communicate state to users outside of rendering custom tags in chapter content.

## Goals / Non-Goals

**Goals:**
- Provide a composable (`useNotification`) that any component or plugin can call to show notifications
- Support 4 severity levels: info, success, warning, error
- Support 6 position presets: top-left, top-right, bottom-left, bottom-right, top-center, bottom-center
- Support 3 delivery channels: `in-app` (toast only), `system` (browser Notification API only), `auto` (system preferred, fallback to in-app)
- Implement a `ToastContainer.vue` component for rendering in-app toasts
- Expose a `notification` frontend hook stage so plugins can emit notifications from their frontend modules
- Create a `response-notify` core plugin that fires a system notification on `chat:done` when page is hidden
- Gracefully handle permission denied / unsupported browser scenarios

**Non-Goals:**
- No backend involvement — all notifications are purely frontend
- No persistent notification history or notification center UI
- No sound/audio alerts
- No notification grouping or batching
- No customizable notification templates per plugin
- No backend hook stage changes — the `response-notify` plugin listens to WebSocket events on the frontend side

## Decisions

### 1. Notification API as a Vue composable (not a global event bus)

**Choice**: Implement `useNotification()` composable that returns `{ notify, requestPermission, permissionState }`.

**Rationale**: Consistent with the existing composable pattern (`useAuth`, `useChatApi`, `useWebSocket`). Composables are easily testable, type-safe, and tree-shakeable. A global event bus would be harder to type and test.

**Alternative considered**: Global `window.dispatchEvent` / `CustomEvent` — rejected because it bypasses Vue reactivity, is harder to type, and makes testing more complex.

### 2. Separate `notification` frontend hook stage (not overloading `frontend-render`)

**Choice**: Add a new `notification` frontend hook stage to the `FrontendHookDispatcher`.

**Rationale**: The `frontend-render` stage has a specific purpose (text transformation with placeholder maps). Notification dispatching is semantically different — it's an imperative action, not a text transformation. A dedicated stage keeps concerns separated and prevents accidental coupling.

**Alternative considered**: Having plugins directly import `useNotification` — rejected because plugins are vanilla JS modules loaded dynamically; they don't have access to Vue's composition context. The hook dispatcher is the bridge.

### 3. System notifications via standard Notification API with permission gating

**Choice**: Use the standard `Notification` API. Request permission lazily on first `auto` call when page is visible. Cache permission state in a reactive ref. Channel semantics:
- `system` = strict browser notification only; silently dropped if denied/unsupported (no fallback)
- `auto` = prefer system, fall back to in-app if denied/unsupported/page-hidden-with-default-permission
- `in-app` = always in-app toast

**Rationale**: The Notification API is supported in all modern browsers. Push notifications (Service Worker) would be overkill for a single-user local app. The strict `system` channel allows opt-in for "I only want OS-level" without unwanted toasts. Permission is NEVER requested when the page is hidden (browsers typically block this anyway).

**Alternative considered**: Service Worker push notifications — rejected as overly complex for a local-first application with no push server.

### 4. Toast positioning via CSS custom properties and fixed positioning

**Choice**: A single `ToastContainer.vue` component renders all toasts. Position is controlled via CSS classes (`toast-top-left`, etc.) on individual toast groups. Each position has its own stack.

**Rationale**: Simpler than mounting multiple containers. CSS handles positioning naturally. Toasts at different positions don't interfere visually.

**Alternative considered**: One container per position slot — rejected as unnecessarily complex DOM structure.

### 5. Auto-dismiss with configurable duration

**Choice**: Toasts auto-dismiss after a configurable duration (default: 5000ms for info/success, 8000ms for warning/error). Manual close button always available.

**Rationale**: Prevents toast pile-up. Longer duration for more important levels gives users time to read.

### 6. `response-notify` plugin always fires on completion

**Choice**: The plugin fires a notification on every `chat:done` event regardless of `document.visibilityState`. When the page is visible, it uses `channel: 'in-app'` (toast). When the page is hidden, it uses `channel: 'auto'` (system notification with in-app fallback).

**Rationale**: Users benefit from visual confirmation that generation is complete even when actively watching — the streaming content may end subtly. The channel distinction ensures hidden-tab users get OS notifications while foreground users get non-intrusive toasts.

## Risks / Trade-offs

- **[Risk] Browser blocks notification permission** → Mitigation: Fall back to in-app toast transparently. The `auto` channel handles this automatically.
- **[Risk] Toast pile-up during rapid events** → Mitigation: Cap maximum concurrent toasts per position (default 5), oldest removed when cap exceeded.
- **[Risk] Plugin hook dispatch timing** → Mitigation: The `notification` hook is dispatched synchronously in the same turn as the triggering event; no async gap where state could change.
- **[Trade-off] No notification persistence** → Acceptable for MVP; notifications are ephemeral feedback, not audit logs.
- **[Trade-off] Frontend-only architecture** → Means server-side events can only trigger notifications if the frontend is listening (which it is via WebSocket). If WebSocket disconnects, `response-notify` won't fire, but the user is already aware since they must reconnect.

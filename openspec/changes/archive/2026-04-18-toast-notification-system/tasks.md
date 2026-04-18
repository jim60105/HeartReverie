## 1. Frontend Types & Infrastructure

- [x] 1.1 Add notification-related types to `reader-src/src/types/index.ts`: `NotifyOptions`, `ToastNotification`, `NotificationPosition`, `NotificationLevel`, `NotificationChannel`, `UseNotificationReturn`
- [x] 1.2 Add `notification` to the `HookStage` type union and `VALID_STAGES` set in `reader-src/src/lib/plugin-hooks.ts`; add `NotificationContext` interface to frontend types

## 2. Notification Composable

- [x] 2.1 Create `reader-src/src/composables/useNotification.ts` implementing: reactive toast queue, `notify()`, `dismiss()`, `requestPermission()`, `permissionState` ref, auto-dismiss timers, max-5-per-position cap
- [x] 2.2 Implement system notification delivery: check `Notification` API support, lazy permission request on first auto/system call, create browser `Notification` instance, fallback to in-app on denied/unsupported

## 3. Toast Container Component

- [x] 3.1 Create `reader-src/src/components/ToastContainer.vue` with position-grouped toast rendering, level-based styling (info/success/warning/error colors), close button, entry/exit transitions
- [x] 3.2 Add toast CSS styles to a scoped style block or dedicated stylesheet: position classes (6 positions), level color schemes, animation keyframes
- [x] 3.3 Mount `ToastContainer` in `reader-src/src/App.vue`

## 4. Plugin Hook Integration

- [x] 4.1 Update `FrontendHookDispatcher` context type map to include `notification` stage with `NotificationContext` (`event`, `data`, `notify`)
- [x] 4.2 Add notification hook dispatch in `useChatApi.ts` for WebSocket `chat:done` and `chat:error` events, passing the notify function from `useNotification()`
- [x] 4.3 Add notification hook dispatch in `useChatApi.ts` for HTTP fallback path completion (success and error), with same context shape as WebSocket path

## 5. Response Notify Plugin

- [x] 5.1 Create `plugins/response-notify/plugin.json` manifest with name, description, type `frontend-only`, and frontendModule `./frontend.js`
- [x] 5.2 Create `plugins/response-notify/frontend.js` that registers a `notification` hook handler checking `document.visibilityState === 'hidden'` and calling `context.notify()` with `channel: 'auto'`, `level: 'success'`, title in Traditional Chinese

## 6. Tests

- [x] 6.1 Create unit tests for `useNotification` composable: notify creates toast, auto-dismiss timing, dismiss by ID (in-app only), max cap enforcement per position, singleton shared state across callers
- [x] 6.2 Create unit tests for system notification delivery: auto channel fallback on denied, system channel silent drop on denied, permission not prompted when page hidden, permission requested when page visible with default state, unsupported API detection
- [x] 6.3 Create unit tests for notification hook dispatch: verify context shape (`event`, `data`, `notify`), verify dispatch on WebSocket chat:done, verify dispatch on HTTP fallback completion, verify multiple handlers can emit independently
- [x] 6.4 Create unit tests for `response-notify` plugin frontend module: fires system notification (auto channel) when hidden, fires in-app toast when visible, uses correct level/title, handles missing context.notify gracefully

## 7. Documentation

- [x] 7.1 Update `docs/plugin-system.md` to document the new `notification` hook stage, its context shape, and usage example
- [x] 7.2 Update `AGENTS.md` plugin hook stage lists to include `notification`

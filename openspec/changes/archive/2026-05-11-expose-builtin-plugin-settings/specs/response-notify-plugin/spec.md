## ADDED Requirements

### Requirement: `response-notify` exposes five settings

`plugins/response-notify/plugin.json` SHALL declare a `settingsSchema` block exposing:

- `enabled` (boolean, default `true`).
- `notifyTitle` (string, default reproducing today's hard-coded zh-TW title).
- `notifyBody` (string, default reproducing today's hard-coded zh-TW body).
- `notifyWhenVisible` (boolean, default `false`) — when `false` (today's behaviour) the plugin only fires when the document is hidden.
- `notifyLevel` (enum `"info" | "success" | "warning"`, default `"success"` — preserves today's hard-coded toast level).

#### Scenario: Manifest renders five controls

- **WHEN** the user opens the plugin settings page
- **THEN** five form controls render with the documented defaults

### Requirement: Plugin registers on `notification` hook filtered by `chat:done`

The plugin SHALL register on the `notification` hook stage and gate its body on `context.event === "chat:done"`. The earlier proposal claim that the plugin uses a literal `chat:done` hook name was incorrect; this requirement codifies the correct hook stage + event combination.

#### Scenario: Notification fires after chat completion

- **WHEN** the user completes a chat turn with the tab hidden
- **AND** `enabled === true`
- **THEN** the plugin's `notification` callback runs with `context.event === "chat:done"`
- **AND** a system notification is shown using the templated `notifyTitle` / `notifyBody`

#### Scenario: Notification suppressed when tab is visible

- **WHEN** the user completes a chat turn with the tab visible
- **AND** `notifyWhenVisible === false`
- **THEN** no system notification fires

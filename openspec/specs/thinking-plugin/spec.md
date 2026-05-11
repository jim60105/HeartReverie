# Thinking Plugin

## Purpose

TBD — specifies the `thinking` built-in plugin's settings schema, dynamic variable injection, and frontend hook registration.

## Requirements

### Requirement: `thinking` exposes five settings

`plugins/thinking/plugin.json` SHALL declare a `settingsSchema` block exposing:

- `enabled` (boolean, default `true`).
- `injectInstruction` (boolean, default `true`) — controls whether the plugin's "think before replying" guidance is injected into the system prompt. Useful for reasoning models that already emit `<think>` blocks natively.
- `defaultCollapsed` (boolean, default `true`) — initial collapsed state of rendered `<think>` blocks.
- `completeSummaryLabel` (string, default reproducing today's `"思考過程"`).
- `streamingSummaryLabel` (string, default reproducing today's `"思考中..."`).

#### Scenario: Manifest renders five controls

- **WHEN** the user opens the plugin settings page for `thinking`
- **THEN** five form controls render with the documented defaults

### Requirement: `injectInstruction` is realised via dynamic variable

To make `injectInstruction` toggleable at runtime, the plugin's static `promptFragments[].file` entry SHALL be replaced by a backend `handler.ts` export named `getDynamicVariables()` that returns the fragment text only when both `enabled === true` and `injectInstruction === true`. The dynamic variable name SHALL match whatever variable name the static fragment resolved to (so consumers of the template variable continue to work).

#### Scenario: User disables `injectInstruction`

- **WHEN** the operator sets `injectInstruction` to `false`
- **AND** the engine assembles a system prompt
- **THEN** the prompt MUST NOT contain the "think before replying" guidance text

### Requirement: Plugin registers on `frontend-render`, not `render-think`

The plugin SHALL register on the `frontend-render` hook (not a fictional `render-think` hook). Inside the handler it SHALL read `defaultCollapsed`, `completeSummaryLabel`, and `streamingSummaryLabel` from `context.getSettings()` at each invocation.

#### Scenario: Label setting takes effect without reload

- **WHEN** the user sets `completeSummaryLabel` to `"思考過程"`
- **AND** the `plugin-settings:changed` event fires
- **AND** the chapter renderer re-dispatches `frontend-render`
- **THEN** rendered `<think>` summary headers show `"思考過程"`

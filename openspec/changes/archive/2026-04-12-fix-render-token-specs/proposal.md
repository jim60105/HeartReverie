## Why

The verification audit of 22 frontend specs against the Vue implementation revealed a fundamental design conflict: the **md-renderer** and **vue-component-architecture** specs define a 5-variant `RenderToken` discriminated union (`html`, `status`, `options`, `variable`, `vento-error`) where the main project code branches on plugin-specific token types and renders plugin-specific Vue components (`<StatusBar>`, `<OptionsPanel>`, `<VariableDisplay>`). This violates the plugin architecture principle that **plugin-specific logic belongs in plugins, not in the main project**. The implementation correctly delegates all plugin rendering to `frontend-render` hooks that produce HTML strings via `placeholderMap`, keeping the core renderer agnostic to plugin internals. The specs must be updated to match this intentional architecture.

## What Changes

- **Remove plugin-specific token types from `RenderToken`**: The discriminated union becomes `HtmlToken | VentoErrorToken` only. `status`, `options`, and `variable` token variants are removed — these are plugin concerns, not core renderer concerns.
- **Remove `ChapterContent` 5-way token branching**: The content component iterates only over `html` and `vento-error` tokens. Plugin-rendered HTML is embedded within `html` tokens after placeholder reinsertion.
- **Remove "Plugin tag handler registration API" from md-renderer**: The current implementation uses the `frontend-render` hook from `plugin-hooks` spec to register tag handlers. There is no separate "tag handler registration API" — plugins mutate `context.text` and `context.placeholderMap` directly during `frontend-render` dispatch.
- **Clarify plugin rendering contract**: Plugins produce **HTML strings** (not structured data objects) via `frontend-render` hooks. The rendered HTML is inserted at placeholder positions within `html` tokens. Vue components like `StatusBar.vue` and `OptionsPanel.vue` exist as plugin-internal implementation details, not as tokens the core renderer must know about.
- **Remove references to `ParsedStatus`, `OptionItem[]` as RenderToken data**: These types remain valid within their respective plugin code but are not part of the core `RenderToken` type system.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `md-renderer`: Remove 5-token model from "Tokenized rendering output" requirement — simplify to `html` + `vento-error` only. Remove "Plugin tag handler registration API" requirement — plugins use `frontend-render` hook from plugin-hooks spec. Update "Rendering output as RenderToken array" to reflect 2-token model.
- `vue-component-architecture`: Remove 5-variant `RenderToken` definition — simplify to `HtmlToken | VentoErrorToken`. Remove `ChapterContent` 5-way branching requirement — iterate only over `html` and `vento-error` tokens.

## Impact

- **Spec files only** — no code changes needed. The implementation already follows the correct architecture.
- **Affected specs**: `openspec/specs/md-renderer/spec.md`, `openspec/specs/vue-component-architecture/spec.md`
- **Not affected**: `status-bar`, `options-panel`, `variable-display`, `plugin-hooks` specs — these already describe plugin-internal behavior correctly (or with only minor naming issues unrelated to this change).

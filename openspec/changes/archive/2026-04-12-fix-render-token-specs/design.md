## Context

The Vue frontend refactor implemented a plugin-delegated rendering architecture where `frontend-render` hooks produce HTML strings placed into a `placeholderMap`. The core markdown renderer is plugin-agnostic — it only knows about `html` and `vento-error` tokens. However, the specs were written before this design decision and describe a 5-variant `RenderToken` union where the main project code must know about `status`, `options`, and `variable` token types and render corresponding Vue components. This creates a false dependency: the core renderer would need to import and branch on every plugin-specific component, defeating the plugin system's purpose.

The implementation is correct. The specs need to be aligned.

## Goals / Non-Goals

**Goals:**
- Align `md-renderer` and `vue-component-architecture` specs with the implemented plugin delegation architecture
- Ensure `RenderToken` is defined as `HtmlToken | VentoErrorToken` only
- Remove the fictional "Plugin tag handler registration API" from md-renderer (plugins use `frontend-render` hook from `plugin-hooks` spec)
- Remove ChapterContent 5-way branching requirement (it only branches on `html` and `vento-error`)

**Non-Goals:**
- Changing any code — the implementation is already correct
- Modifying plugin-internal specs (`status-bar`, `options-panel`, `variable-display`) — these correctly describe plugin-internal behavior
- Modifying `plugin-hooks` spec — it already correctly describes the `frontend-render` context shape (`text`, `placeholderMap`, `options`)
- Fixing other spec misalignments found in the verification audit (naming differences, missing features, CSP issues) — those are separate concerns

## Decisions

### Decision 1: Two-token RenderToken union

The `RenderToken` discriminated union SHALL be `HtmlToken | VentoErrorToken` only.

**Rationale**: Plugin-rendered content (status bars, options panels, variable displays) arrives as HTML strings via `placeholderMap` and is reinserted into prose content. After reinsertion, it becomes part of an `html` token's `content` string. The core renderer never needs to know what type of plugin produced the HTML. Only `vento-error` remains as a separate token type because it is a core concern (template engine errors), not a plugin concern.

**Alternative considered**: Keep 5 token types but make them optional/plugin-contributed. Rejected because it would require the core renderer to import plugin-specific Vue components and maintain a registry mapping token types to components — exactly the coupling the plugin system is designed to avoid.

### Decision 2: Remove "Plugin tag handler registration API" from md-renderer

The md-renderer spec currently defines a separate registration API for tag handlers. In reality, plugins register via the `frontend-render` hook from the `plugin-hooks` spec. There is no separate API — plugins directly mutate `context.text` and `context.placeholderMap` during `frontend-render` dispatch.

**Rationale**: The `plugin-hooks` spec already fully describes this mechanism. Having a duplicate/conflicting API definition in md-renderer creates confusion about which is the source of truth.

### Decision 3: Preserve XML extraction description in md-renderer

The md-renderer spec's "XML block extraction before text processing" requirement remains valid — the extraction still happens, driven by tag names from `frontend-render` handlers. The requirement just needs to clarify that extraction is performed by plugins during hook dispatch, not by a core registration API.

## Risks / Trade-offs

- **[Risk]** Plugin-rendered HTML is injected via `v-html`, losing Vue reactivity features (events, props) for plugin components → **Mitigation**: This is the intentional trade-off. Plugins that need interactivity (like options panel click-to-copy) use DOM events or `CustomEvent` bridges, which work correctly. The alternative (typed tokens requiring core renderer knowledge of every plugin) is worse.
- **[Risk]** Removing token types could confuse future contributors who expect typed rendering → **Mitigation**: The updated specs clearly explain the plugin delegation model and why HTML tokens carry plugin-rendered content.

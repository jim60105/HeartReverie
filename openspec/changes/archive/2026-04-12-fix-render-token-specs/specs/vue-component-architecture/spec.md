## MODIFIED Requirements

### Requirement: RenderToken type definition

The frontend type system SHALL define a discriminated union type `RenderToken` representing all possible rendering output segments from the markdown pipeline. The type SHALL be defined as:

```typescript
type RenderToken =
  | HtmlToken
  | VentoErrorToken;

interface HtmlToken {
  type: 'html';
  content: string;
}

interface VentoErrorToken {
  type: 'vento-error';
  data: VentoErrorData;
}
```

Where `VentoErrorData` contains the `message`, `source?`, `line?`, and `suggestion?` fields from the vento-error-handling spec. The `RenderToken` type SHALL NOT include plugin-specific variants (such as `status`, `options`, or `variable`) — plugin-rendered content is embedded as HTML strings within `html` tokens after `frontend-render` hook dispatch and placeholder reinsertion. The `RenderToken` type SHALL be exported from a shared types module (e.g., `reader-src/src/types/index.ts`) and used by the markdown renderer composable and the content display component.

#### Scenario: RenderToken discriminated union enables type narrowing
- **WHEN** a component iterates over a `RenderToken[]` array
- **THEN** TypeScript SHALL allow narrowing via `token.type` to access the correct data shape (`content: string` when `token.type === 'html'`, `data: VentoErrorData` when `token.type === 'vento-error'`)

#### Scenario: RenderToken type used by markdown renderer
- **WHEN** the `useMarkdownRenderer()` composable returns rendered output
- **THEN** the return type SHALL be `RenderToken[]` (or a `Ref<RenderToken[]>`), not a single HTML string

#### Scenario: No plugin-specific token types in RenderToken
- **WHEN** the `RenderToken` type definition is inspected
- **THEN** it SHALL contain only `html` and `vento-error` variants — no `status`, `options`, `variable`, or other plugin-specific types SHALL exist in the union

### Requirement: ChapterContent token-based rendering

The `ChapterContent.vue` component (or equivalent content display component within `ContentArea`) SHALL receive a `RenderToken[]` array from the `useMarkdownRenderer()` composable and render it using `v-for` iteration. For each token:
- `{ type: 'html' }` tokens SHALL be rendered as `<div v-html="token.content"></div>` — this includes plugin-rendered HTML (status bars, options panels, variable displays) that was embedded via placeholder reinsertion during `frontend-render` hook processing
- `{ type: 'vento-error' }` tokens SHALL be rendered as `<VentoErrorCard v-bind="token.data" />`

The component SHALL NOT import or branch on plugin-specific Vue components (such as `StatusBar`, `OptionsPanel`, `VariableDisplay`). Plugin rendering is fully delegated to `frontend-render` hooks that produce HTML strings, keeping the core content component plugin-agnostic.

#### Scenario: Mixed prose and plugin-rendered blocks render correctly
- **WHEN** the markdown renderer returns tokens containing prose HTML and plugin-rendered HTML (from `frontend-render` hooks that extracted and rendered `<status>` and `<options>` blocks)
- **THEN** `ChapterContent.vue` SHALL render all content in document order using `v-html` for `html` tokens, with plugin-rendered HTML appearing at the correct positions within the prose

#### Scenario: Only two token type branches exist
- **WHEN** inspecting the `ChapterContent.vue` template
- **THEN** the `v-for` loop SHALL branch on exactly two token types: `html` (rendered via `v-html`) and `vento-error` (rendered as `<VentoErrorCard>`)

#### Scenario: Empty token array renders nothing
- **WHEN** the markdown renderer returns an empty `RenderToken[]` array
- **THEN** `ChapterContent.vue` SHALL render no content blocks without errors

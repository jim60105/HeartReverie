## Why

A verification audit found that plugin-specific code leaked into the main project (`reader-src/`): 3 dead Vue components, 3 dead TypeScript parsers, 6 dead type interfaces, plugin-coupled DOM logic, and associated tests. These were created based on the false 5-variant `RenderToken` spec design but were **never wired into the rendering pipeline**. The actual rendering is done by each plugin's `frontend.js` which produces HTML strings via `frontend-render` hooks. The dead code increases maintenance burden, causes spec confusion, and violates the principle that plugin-specific logic belongs in plugins.

## What Changes

- **Remove dead Vue components** from `reader-src/src/components/`: `StatusBar.vue`, `OptionsPanel.vue`, `VariableDisplay.vue` — these are never rendered (ChapterContent only branches on `html` and `vento-error` tokens)
- **Remove dead TypeScript parsers** from `reader-src/src/lib/parsers/`: `status-parser.ts`, `options-parser.ts`, `variable-parser.ts` — the identical logic already lives in each plugin's `frontend.js`
- **Remove dead type interfaces** from `reader-src/src/types/index.ts`: `StatusBarProps`, `CloseUpEntry`, `OptionItem`, `OptionsPanelProps`, `VariableDisplayProps`, `OptionsPanelEmits` — unused by any live code path
- **Remove dead tests** that test the dead code: `leaf-components.test.ts`, parser test files
- **Fix plugin-coupled DOM logic**: `ContentArea.vue` hardcodes `.status-float` (a class from the status plugin's HTML output) for sidebar relocation. Replace with a generic `.plugin-sidebar` class that any plugin can use to opt into sidebar placement
- **Update status plugin** `frontend.js` to output `.plugin-sidebar` instead of `.status-float`
- **Keep CSS in `base.css`** — the plugin-rendered HTML needs global CSS for styling since plugins can't bundle their own CSS via dynamic `import()`. Add comments documenting that these styles serve plugin output.
- **Update specs** to remove references to Vue components that don't exist and clarify that plugins own all rendering logic

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `status-bar`: Remove requirements referencing `StatusBar.vue` as a main project component — the plugin's `frontend.js` handles all parsing and rendering. Update sidebar placement to use generic `.plugin-sidebar` class instead of `<Teleport>` (which only works for Vue components, not plugin-rendered HTML). Keep plugin registration and behavior requirements.
- `options-panel`: Remove requirements referencing `OptionsPanel.vue` as a main project component with `defineEmits<{ optionSelected }>()` — the plugin's `frontend.js` handles rendering and uses DOM event delegation via `data-option-text` buttons. Keep parser and plugin registration requirements.
- `variable-display`: Remove requirements referencing `VariableDisplay.vue` as a main project component — the plugin's `frontend.js` handles extraction and rendering. Keep plugin behavior requirements.
- `vue-component-architecture`: Remove `StatusBar`, `OptionsPanel`, `VariableDisplay` from the component hierarchy requirement. Remove dead type interfaces from the type system requirement.
- `page-layout`: Update sidebar placement mechanism — use generic `.plugin-sidebar` class with `watchPostEffect` DOM relocation (appropriate for plugin-rendered HTML via `v-html`), replacing the hardcoded `.status-float` query.

## Impact

- **Code deletions in `reader-src/`**: ~400 lines of dead components/parsers/types, plus associated test files
- **Plugin change**: `plugins/status/frontend.js` — rename CSS class `.status-float` → `.plugin-sidebar`
- **Main project change**: `ContentArea.vue` — change querySelector from `.status-float` to `.plugin-sidebar`
- **CSS change**: `reader-src/src/styles/base.css` — rename `.status-float` selector, add documentation comments
- **Spec updates**: 5 existing specs modified (no new specs)
- **No API or behavior changes** — the rendering pipeline is unchanged since the dead code was never in the pipeline

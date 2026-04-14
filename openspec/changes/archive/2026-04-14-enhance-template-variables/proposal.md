## Why

The Vento prompt template system has several gaps: `series_name` and `story_name` are referenced in `system.md` but never injected into the template context, lore codex `.md` files cannot use Vento syntax to reference other lore variables (e.g., `{{ lore_character }}` inside `scenario.md`), the removed `scenario` variable still appears in the prompt editor's variable pills, and lore codex variables (`lore_all`, `lore_<tag>`, `lore_tags`) are not discoverable in the pills UI despite being valid template variables.

## What Changes

- **Add `series_name` and `story_name` as core template variables**: Inject the current series and story names into the Vento template context so `system.md` and lore passages can reference them.
- **Enable Vento rendering in lore codex passages**: Process lore passage content through the Vento template engine so passages can reference other lore variables (e.g., a scenario passage using `{{ lore_character }}` to inline character lore).
- **Remove stale `scenario` from variable pills**: The `scenario` variable was replaced by the lore codex system but is still listed as a core parameter in `getParameters()` and `errors.ts`. Remove it.
- **Add lore codex variable type to pills UI**: Introduce a new `"lore"` variable type alongside `"core"` and `"plugin"` so lore variables are listed in the prompt editor with distinct styling. This requires dynamically discovering lore variables from the current story context.

## Capabilities

### New Capabilities
- `lore-vento-rendering`: Enable Vento template syntax rendering within lore codex passage content, allowing passages to reference other lore variables and core variables like `series_name`.

### Modified Capabilities
- `vento-prompt-template`: Add `series_name` and `story_name` to the core template variable set injected into the Vento rendering context.
- `lore-prompt-injection`: Lore passage content is now rendered through the Vento engine before being concatenated into `lore_all` / `lore_<tag>` variables. Requires careful ordering to handle inter-lore references.
- `prompt-editor`: Remove stale `scenario` from core variable pills. Add a new `"lore"` pill type for dynamically-discovered lore codex variables. Update styling to include a third color for lore pills.

## Impact

- **Backend** (`writer/lib/template.ts`): Pass `series_name` and `story_name` into the Vento context object.
- **Backend** (`writer/lib/lore.ts`): Add a Vento rendering pass on passage content during variable generation, with dependency resolution for inter-lore references.
- **Backend** (`writer/lib/plugin-manager.ts`): Remove `scenario` from `getParameters()` core list. Add lore variable discovery to `getParameters()` or a new endpoint.
- **Backend** (`writer/lib/errors.ts`): Remove `scenario` from the known-variables list.
- **Backend** (`writer/routes/prompt.ts` or `writer/routes/plugins.ts`): Expose lore variables for the current story context to the frontend.
- **Frontend** (`reader-src/src/components/PromptEditor.vue`): Add `"lore"` pill type with distinct styling. Fetch and display lore variables dynamically.
- **Frontend** (`reader-src/src/composables/usePromptEditor.ts`): Handle the new lore variable type.
- **Docs** (`docs/prompt-template.md`): Document `series_name`, `story_name`, and lore Vento rendering capability.

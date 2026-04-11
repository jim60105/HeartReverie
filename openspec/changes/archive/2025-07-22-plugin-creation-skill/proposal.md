## Why

Currently, creating a new plugin for this project requires reading through `docs/plugin-system.md` (390 lines) and studying existing plugin implementations to understand manifest structure, hook registration, prompt fragment injection, tag stripping patterns, and frontend module conventions. A Copilot CLI skill that encodes this knowledge would let AI agents scaffold correct, complete plugins with minimal back-and-forth, reducing plugin authoring friction significantly.

## What Changes

- Add a new Copilot CLI skill at `skills/heartreverie-create-plugin/SKILL.md` that guides AI agents through plugin creation
- The skill will provide:
  - Plugin type selection (prompt-only, full-stack)
  - Manifest (`plugin.json`) scaffolding with all supported fields
  - Prompt fragment file creation with correct variable naming and priority
  - Backend hook module scaffolding (TypeScript, correct hook stages)
  - Frontend module scaffolding (vanilla ES module, correct export signatures)
  - Tag declaration and strip pattern configuration (plain tags and regex patterns)
  - `displayStripTags` configuration for frontend-only tag removal
  - README.md generation in Traditional Chinese following existing plugin README style
- Include a reference file with the plugin manifest schema and hook API details

## Capabilities

### New Capabilities
- `plugin-creation-skill`: A Copilot CLI skill that scaffolds new plugins with correct manifest, modules, prompt fragments, and documentation

### Modified Capabilities
_(none — this change only adds a new skill file and does not modify any existing specs or code)_

## Impact

- New files only: `skills/heartreverie-create-plugin/SKILL.md` and optional reference files
- No changes to existing code, APIs, or dependencies
- No effect on runtime behavior — the skill is consumed only by AI agents during development

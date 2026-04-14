## Why

The `docs/plugin-system.md` documentation has 13 misalignments with the current codebase and OpenSpec specifications, including wrong file extensions (`.js` → `.ts`), wrong plugin count (10 → 11), incorrect hook context shapes, missing core variables, and incorrect security information (claims `include` is allowed when code explicitly disallows it). These inaccuracies mislead anyone developing plugins or maintaining the system.

Additionally, `system.md` contains 3 hardcoded prose sections that are conceptually optional, creative-direction-specific features. These sections (content-freedom instructions, think-before-reply instructions, and first-round start hints) follow the exact same pattern as existing plugins like `de-robotization` and `writestyle` — they're prompt fragments that users should be able to toggle or customize independently. Extracting them into plugins makes the system more modular and enables different authorial styles without editing the core template.

4 other hardcoded sections (formatting rules, language instructions, game instructions, writing guidelines) are **core** to the system's identity as a Traditional Chinese interactive fiction engine and SHALL remain in `system.md` so the system produces meaningful output even with no plugins loaded.

No backward compatibility concerns — the project has 0 users in the wild.

## What Changes

### Part 1: Fix `docs/plugin-system.md` Documentation

Fix all 13 misalignments between the documentation and current codebase:

1. File extensions: `.js` → `.ts` in architecture tree
2. Plugin count: "共 10 個 plugin" → "共 11 個 plugin" (add `thinking`)
3. Variable table: add missing `context_compaction` (priority 800) and `state` (priority 100)
4. Plugin list table: add `thinking` plugin; fix `threshold-lord` type from `full-stack` to `prompt-only`
5. `prompt-assembly` hook context: `{ prompt, variables }` → `{ previousContext, rawChapters, storyDir, series, name }`
6. `frontend-render` hook context: `{ text, element }` → `{ text, placeholderMap, options }`
7. Document `_shared/` serving route (`/plugins/_shared/:path`)
8. Fix `lore_all` example source: `"core"` → `"lore"`
9. Remove `include` from allowed SSTI syntax (code explicitly disallows it)
10. Core variables: "四個" → "七個", add `series_name`, `story_name`, `plugin_fragments`
11. Note undocumented hook stages (`response-stream`, `strip-tags` — defined but never dispatched)
12. Minor: note `mod.default` export fallback for backend modules
13. Manifest required fields: doc says `version`, `description`, `type` are required; code only enforces `name` — fix to match code

### Part 2: Extract Optional Prompt Sections into Plugins

#### Core sections retained in `system.md` (NOT extracted):

These sections define the system's identity as a Traditional Chinese interactive fiction engine. Without them, the LLM would not know what language to use, how to format output, or that it's an interactive fiction game:

- **Formatting rules** (lines 16-20): Output format definition (dialogue, thoughts, narration, emphasis)
- **Language instructions** (lines 22-24): Traditional Chinese locale and punctuation rules
- **Game instructions** (line 41): Interactive fiction mode definition and behavior rules
- **Writing guidelines** (lines 48-56): Minimum fiction quality standard (literary style, scene flow, show-don't-tell)

#### New plugin (1):

- **`start-hints`** (prompt-only): First-round opening instructions (`<start_hints>` block, lines 66-77 of `system.md`). Provides `start_hints` variable. Includes `promptStripTags` and `displayStripTags` for `start_hints` tag.

#### Enhanced existing plugins (2):

- **`thinking`**: Add `promptFragments` with "Think before reply" instruction (lines 43-44). Changes type from `frontend-only` to `full-stack`.
- **`threshold-lord`**: Add `content_freedom` prompt fragment (lines 3-14). Keeps existing `threshold_lord_start` and `threshold_lord_end` fragments.

#### Template update:

- Update `system.md` to replace 3 optional sections with `{{ variable }}` references
- 4 core sections remain hardcoded
- All existing plugin variable references remain unchanged

## Capabilities

### New Capabilities

- `start-hints-plugin`: Plugin definition, prompt fragment, and template integration for first-round start hints

### Modified Capabilities

- `plugin-core`: Update for new plugin in the plugin name identity list and discovery
- `plugin-hooks`: Update `prompt-assembly` and `frontend-render` hook context documentation to match actual implementation
- `vento-prompt-template`: Update `system.md` template to use new plugin variables for 3 optional sections; 4 core sections remain hardcoded

## Impact

- **`docs/plugin-system.md`**: Comprehensive update — 13 fixes across file extensions, tables, hook contexts, security section, manifest fields, and core variables
- **`system.md`**: Replace 3 optional sections with `{{ variable }}` references; 4 core sections remain hardcoded; template structure preserved
- **`plugins/`**: 1 new plugin directory created; 2 existing plugins enhanced with additional `promptFragments`
- **OpenSpec specs**: Delta specs for `plugin-core`, `plugin-hooks`, `vento-prompt-template`
- **No code changes needed**: All extractions use existing `promptFragments` mechanism — no changes to plugin-manager.ts, hooks.ts, or template.ts

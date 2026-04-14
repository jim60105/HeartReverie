## Context

## Context

`system.md` is the main Vento prompt template. It currently mixes structural template logic (chapter iteration, variable placement) with hardcoded prose sections. Some are optional/creative-direction content (content-freedom, think-before-reply, start-hints) while others are **core** to the system's function as a Traditional Chinese interactive fiction engine (formatting, language, game mode, writing quality). The existing plugin system already supports `promptFragments` for injecting Markdown content as template variables — 8 of 11 plugins already use this mechanism.

The `docs/plugin-system.md` documentation was last comprehensively updated before the TypeScript migration and several plugin additions, leaving 13 factual inaccuracies.

## Goals / Non-Goals

**Goals:**
- Fix all 13 documentation misalignments in `docs/plugin-system.md`
- Extract 3 optional/creative-direction prompt sections from `system.md` into plugins
- Keep 4 core sections in `system.md` so the system functions without any plugins
- Maintain identical LLM prompt output (same content, same ordering) when all plugins are enabled

**Non-Goals:**
- Changing the plugin system architecture (no new hooks, no new APIs)
- Changing any backend TypeScript code (all extractions use existing `promptFragments`)
- Rewriting `system.md` structure or reordering content
- Adding new OpenSpec specs for `docs/plugin-system.md` itself (it's a user-facing doc, not a capability spec)

## Decisions

### Decision 1: Core vs optional — keep core sections in `system.md`

The system must produce meaningful output even with NO plugins loaded (e.g., `plugins/` directory missing). This requires the core storytelling instructions to remain hardcoded in `system.md`:
- **Formatting rules** (lines 16-20): Without these, the LLM doesn't know how to distinguish dialogue/thoughts/narration
- **Language instructions** (lines 22-24): Without these, the LLM defaults to English — the system IS a Traditional Chinese fiction engine
- **Game instructions** (line 41): Without this, the system is a generic chatbot, not an interactive fiction engine
- **Writing guidelines** (lines 48-56): Without these, output quality degrades below the minimum standard for literary fiction

Only 3 sections are truly optional/creative-direction: content-freedom (NSFW toggle), think-before-reply (prompting technique), start-hints (first-round guidance).

### Decision 2: Merge content-freedom into `threshold-lord`

The content-freedom prose (lines 3-14) sits between `{{ threshold_lord_start }}` and the rest of the template. Threshold-lord conceptually owns the content boundary/freedom layer. Adding a third fragment `content_freedom` (priority 15, after `threshold_lord_start` at 10, before other content at 100) keeps the feature cohesive.

Alternative rejected: standalone `content-freedom` plugin — would split a conceptually unified feature across two plugins.

### Decision 3: Enhance `thinking` with prompt fragment

The "Think before reply" instruction (lines 43-44) is the prompt-side half of the thinking feature. The `thinking` plugin already handles the frontend rendering of `<thinking>` tags. Combining both halves in one plugin means disabling the plugin removes both the instruction and the rendering. Type changes from `frontend-only` to `full-stack`.

### Decision 4: New standalone plugin for start-hints only

Only `start-hints` needs a new standalone plugin. It has no natural home in existing plugins — it's first-round-only conditional content with tag stripping needs. Follows the proven `prompt-only` pattern (same as `de-robotization`).

Formatting-rules, language, and game-instructions are kept in `system.md` per Decision 1 (core functionality).

### Decision 5: Preserve `system.md` structure

After extraction, `system.md` keeps the same ordering and structural elements (section headings, `[Details of the fictional world...]` wrapper, `{{ if isFirstRound }}` conditional, `<inputs>`, `<status_current_variable>`). Only 3 optional prose sections are replaced with `{{ variable }}` references. The 4 core sections remain as hardcoded prose. This ensures identical prompt output when all plugins are enabled, and a functional base prompt when no plugins are loaded.

### Decision 6: Doc update follows codebase, not specs

Where OpenSpec specs and the current codebase disagree (e.g., spec says `hooks.on()` but code uses `hookDispatcher.register()`), the doc follows the **codebase** since it documents what currently works. Spec discrepancies are noted as future work.

## Risks / Trade-offs

### Risk: Template readability decrease

Replacing readable prose with `{{ variable }}` references makes `system.md` less self-documenting. Mitigated by: each variable name is descriptive (`content_freedom`, `game_instructions`, etc.), and the template already uses 13 plugin variables.

### Risk: Plugin ordering sensitivity

The prompt fragment `priority` field controls insertion order. Fragments in `plugin_fragments` array are sorted by priority. Named variables (with `variable` field) are placed explicitly in `system.md`. The ordering of extracted sections is preserved by explicit template placement, not by priority values, so priority only matters for the `plugin_fragments` loop.

### Trade-off: More plugins to manage

Going from 11 to 12 plugins increases the plugin count by 1. However, the new plugin is minimal (2 files), and the benefit of independent toggling of start-hints outweighs the management overhead.

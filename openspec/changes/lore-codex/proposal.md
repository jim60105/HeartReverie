## Why

The project currently has a single `scenario.md` file per series for injecting world-building context into the LLM prompt. This is inflexible — there's no way to organize lore by topic, scope entries to individual stories, share character definitions across series, or selectively include relevant passages based on tags. SillyTavern's "World Info / Lorebook" system solves this with keyword-triggered dynamic injection, but its JSON-based design doesn't align with our file-first, Markdown-native philosophy. We need a structured, file-based knowledge system that lets authors organize world-building information into scoped, tagged Markdown passages and selectively inject them into prompts via the Vento template engine.

## What Changes

- Introduce **Lore Codex** (典籍) — a file-based knowledge management system where each piece of information is a **Passage** (篇章): a Markdown file with YAML frontmatter for metadata (tags, priority, enabled)
- Add a hierarchical scope system with explicit scope directories: `global/` (always available), `series/<series>/` (series-scoped), `story/<series>/<story>/` (story-scoped)
- Support organization via directory-as-tag (directory names become implicit tags) and explicit frontmatter tags
- Add a core **Lore Codex** subsystem that:
  - Scans passage files at prompt render time, resolving scope based on the active series/story
  - Provides Vento template variables (e.g., `{{ lore_all }}`, `{{ lore_character }}`) for selective passage injection
  - Exposes backend API routes for listing, reading, creating, updating, and deleting passages
- Add frontend UI for browsing, filtering, and managing lore passages with tag-based navigation
- **Migrate** `scenario.md` to a series-scoped passage (no backward compatibility needed)
- Add a new documentation page at `docs/lore-codex.md` describing the system

## Capabilities

### New Capabilities
- `lore-storage`: File-based storage structure — scoped directories under `playground/lore/` with explicit scope prefixes (`global/`, `series/`, `story/`), Markdown files with YAML frontmatter schema (tags, priority, enabled), directory-as-tag convention
- `lore-retrieval`: Tag-based and scope-based passage retrieval engine — resolves active scope from series/story context, collects matching passages by tag intersection, sorts by priority
- `lore-prompt-injection`: Vento template integration — provides template variables (`lore_all`, `lore_<tag>`) for selective passage injection, replaces the current `{{ scenario }}` variable
- `lore-api`: Backend REST API routes — CRUD operations on passages (list with tag/scope filters, read, create, update, delete), served as core routes under `/api/lore/`
- `lore-editor-ui`: Frontend Vue components — passage browser with tag filtering, passage editor with frontmatter/content editing, integrated as core Vue Router route

### Modified Capabilities
- `vento-prompt-template`: Template must support lore template variables; remove hardcoded `{{ scenario }}` variable in favor of lore passage retrieval
- `writer-backend`: Register lore API routes as core routes; integrate lore retrieval engine into prompt variable collection

## Impact

- **Prompt template** (`system.md`): Replace `{{ scenario }}` with lore template variables
- **Backend** (`writer/lib/template.ts`): Remove scenario-specific loading logic; core lore retrieval engine handles passage loading and variable generation
- **Backend** (`writer/lib/lore.ts`): New core module for lore storage, retrieval, and frontmatter parsing
- **Backend** (`writer/routes/lore.ts`): New core route module for lore CRUD API
- **Frontend** (`reader-src/`): New Vue components for lore management, new core route in Vue Router
- **Story data** (`playground/`): New `lore/` directory structure; migrate existing `scenario.md` files
- **Documentation** (`docs/`): New `lore-codex.md` documentation page

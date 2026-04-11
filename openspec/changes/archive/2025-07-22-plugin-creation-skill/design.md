## Context

The project has a manifest-driven plugin system (10 built-in plugins) documented in `docs/plugin-system.md` (390 lines). Creating a new plugin currently requires reading that document end-to-end plus studying existing plugin source code. There is no automated scaffolding or AI-assisted guidance—agents and developers must manually assemble `plugin.json`, prompt fragment files, backend hooks, frontend modules, and tag strip declarations by piecing together patterns from the docs.

Project-level Copilot CLI skills live in `.github/skills/` (currently all openspec-related). The skill-creator skill (at `~/.agents/skills/skill-creator/`) defines the standard for authoring skills: a `SKILL.md` with YAML frontmatter (`name`, `description`) and a markdown body, plus optional `references/` files for progressive disclosure.

## Goals / Non-Goals

**Goals:**
- Create a single Copilot CLI skill at `skills/heartreverie-create-plugin/` that guides an AI agent through scaffolding a new plugin from scratch
- Support all plugin types: `prompt-only`, `full-stack`, `hook-only`, `frontend-only`
- Generate correct `plugin.json` manifests with all applicable fields
- Scaffold prompt fragment Markdown files, backend hook modules (JS/TS), and frontend modules (JS)
- Configure `promptStripTags`, `displayStripTags`, and `tags` declarations (plain text and regex)
- Generate a README.md in Traditional Chinese following existing plugin README conventions
- Keep SKILL.md under 500 lines; put the manifest schema reference and hook API details in `references/`

**Non-Goals:**
- Do not modify any existing plugin code or the plugin-manager/hooks runtime
- Do not create CLI tooling or shell scripts for scaffolding—the skill operates purely through AI agent guidance
- Do not add tests for the skill itself (it's documentation, not executable code)
- Do not integrate with the openspec workflow (the skill is independent)

## Decisions

### 1. Skill location: `skills/heartreverie-create-plugin/`

Place the skill alongside existing project skills in `.github/skills/`. This keeps project-specific skills together and ensures the skill is version-controlled with the repo.

**Alternative considered:** User-level skill at `~/.agents/skills/`. Rejected because this skill is project-specific (references this project's hook stages, manifest schema, security constraints).

### 2. Progressive disclosure with reference files

SKILL.md will contain the high-level workflow (type selection → manifest → fragments → hooks → tags → README). Detailed reference material goes in `references/`:

- `references/manifest-schema.md` — Full `plugin.json` field definitions and valid values
- `references/hook-api.md` — Backend/frontend hook stages, context parameters, registration patterns

This keeps SKILL.md lean (~200-300 lines) while the agent can load references on demand.

**Alternative considered:** Everything in SKILL.md. Rejected because the combined content would exceed 500 lines and waste context on information irrelevant to simpler plugin types.

### 3. Workflow: interactive guided creation

The skill will use an interactive ask-then-scaffold flow:
1. Ask what the plugin does (description)
2. Determine plugin type from the description (or ask)
3. Generate manifest, then files appropriate to the type
4. Validate directory name matches manifest name

**Alternative considered:** Template-based scaffolding with `init_skill.py`-style script. Rejected because the project has no Node/Deno scaffolding tooling; an AI-guided approach is more flexible and matches how plugins are actually authored in this project.

### 4. README generation in Traditional Chinese

Following the convention established in the recent README effort (commit `24a759c`), the skill will generate READMEs in zh-TW with full-width punctuation, space between Chinese and alphanumeric characters, and structured sections matching existing plugin READMEs.

## Risks / Trade-offs

- **[Staleness]** → The skill references manifest fields and hook stages that may evolve. Mitigation: reference files explicitly note the source of truth (`docs/plugin-system.md`) so agents can cross-check.
- **[Over-guidance]** → Too-detailed templates may produce cookie-cutter plugins. Mitigation: the skill asks what the plugin does first, then tailors output to the specific type—it doesn't generate unused boilerplate.
- **[Context cost]** → Loading references adds tokens. Mitigation: progressive disclosure means simple `prompt-only` plugins never load `hook-api.md`.

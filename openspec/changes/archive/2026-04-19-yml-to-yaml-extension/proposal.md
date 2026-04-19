## Why

The project currently mixes `.yml` and `.yaml` file extensions inconsistently. The official YAML specification recommends `.yaml` as the canonical extension, and standardizing on a single extension reduces ambiguity in documentation, tooling, and gitignore patterns. Since the project has no external users yet, this is the ideal time to unify on `.yaml` without backward-compatibility baggage.

## What Changes

- **BREAKING** Rename all `.yml` files to `.yaml` across the repository (workflow files, status files, per-story compaction configs).
- Update all code that reads or writes these files to use the `.yaml` extension in string literals.
- Update the root `.gitignore` pattern `**/current-status.yml` → `**/current-status.yaml`.
- Update documentation (`docs/prompt-template.md`, plugin READMEs, `AGENTS.md` if needed) to reflect the new extension.
- Update OpenSpec active specs that reference the old extensions.

No new runtime behavior, no new capabilities, no backward-compatibility shim. This is a mechanical rename.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `context-compaction`: The per-story/per-series configuration filename changes from `compaction-config.yml` to `compaction-config.yaml`.
- `vento-prompt-template`: The state data filenames referenced in scenarios change from `current-status.yml` / `init-status.yml` to `current-status.yaml` / `init-status.yaml`.
- `gitignore-config`: The root gitignore pattern changes from `**/current-status.yml` to `**/current-status.yaml`.

## Impact

- **Workflow files**: `.github/workflows/*.yml` (4 files) renamed to `.yaml`.
- **Playground data**: `init-status.yml` and any `current-status.yml` files renamed to `.yaml`.
- **Backend code**: `writer/routes/ws.ts`, `writer/routes/chapters.ts`, `writer/routes/branch.ts` (comment), `plugins/context-compaction/config.ts` string literals updated.
- **Tests**: `tests/plugins/context-compaction/config_test.ts`, `tests/plugins/context-compaction/handler_test.ts` fixtures and assertions updated.
- **Documentation**: `docs/prompt-template.md`, `plugins/context-compaction/README.md`, `AGENTS.md`.
- **Specs**: `openspec/specs/context-compaction/spec.md`, `openspec/specs/vento-prompt-template/spec.md`, `openspec/specs/gitignore-config/spec.md`.
- **No impact** on LLM API, frontend rendering, plugin system architecture, or user-visible behavior (beyond the extension itself).
- **Archived OpenSpec changes** are NOT modified (they are historical records).

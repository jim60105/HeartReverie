## Context

The HeartReverie backend's prompt template system has a two-tier fallback:

1. **Custom file** — `PROMPT_FILE` (defaults to `playground/_prompts/system.md`). The prompt editor saves here; the reset button deletes this file.
2. **Default file** — `ROOT_DIR/system.md` (the project-root `system.md`). Used when the custom file does not exist.

The `HeartReverie_Plugins` Containerfile currently sets `ENV PROMPT_FILE=/app/external-plugins/system.md`, which points the custom file path at the plugins' `system.md`. This causes the plugins' prompt to be treated as a user edit rather than the default, so clicking "reset" deletes it and falls back to the base HeartReverie prompt — losing all plugin template variables.

The target repository is `HeartReverie_Plugins` (separate from HeartReverie). No HeartReverie backend code changes are needed.

## Goals / Non-Goals

**Goals:**

- After reset, the prompt editor falls back to the plugins' `system.md` (not the base HeartReverie one)
- The custom file mechanism (`PROMPT_FILE`) continues to work unchanged for user edits

**Non-Goals:**

- Modifying the HeartReverie backend `readTemplate()` logic
- Changing how `PROMPT_FILE` is resolved or defaulted
- Adding new environment variables

## Decisions

### D1: Overwrite the project-root `system.md` at build time

**Decision**: COPY the plugins' `system.md` to `/app/system.md` in the Containerfile, overwriting the base HeartReverie default.

**Rationale**: This is the simplest approach — the backend's existing fallback chain (`PROMPT_FILE` → `ROOT_DIR/system.md`) works correctly without modification. The plugins' prompt becomes the new default, and `PROMPT_FILE` retains its original semantic as the custom-edit location.

**Alternative considered**: Adding a new `DEFAULT_PROMPT_FILE` env var to HeartReverie — rejected because it adds complexity to the backend for a problem solvable purely at the container layer.

### D2: Remove `ENV PROMPT_FILE` from Plugins Containerfile

**Decision**: Remove `ENV PROMPT_FILE=/app/external-plugins/system.md` so the default `PROMPT_FILE` path (`playground/_prompts/system.md`) is used for custom edits.

**Rationale**: With D1 in place, the plugins' prompt is already the default. Setting `PROMPT_FILE` to the plugins directory would make user edits overwrite the plugins' `system.md` source file, which is incorrect.

## Risks / Trade-offs

- **[Risk]** The COPY overwrites the base `system.md` permanently in the image layer → **Mitigation**: This is intentional. The plugins image is meant to fully replace the base prompt. The original `system.md` remains in the base image layer and can be recovered by rebuilding without the plugins.

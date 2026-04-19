## Why

The `HeartReverie_Plugins` Containerfile sets `ENV PROMPT_FILE=/app/external-plugins/system.md`, misusing the `PROMPT_FILE` semantic. `PROMPT_FILE` defines where the **custom** (user-edited) prompt is stored, not the default prompt location. When the user clicks "reset" in the prompt editor, the backend deletes `PROMPT_FILE` and falls back to `ROOT_DIR/system.md` — the original project default. This means the plugins' `system.md` is lost on reset, reverting to the base HeartReverie prompt instead of the plugins version.

## What Changes

- Remove `ENV PROMPT_FILE=/app/external-plugins/system.md` from `HeartReverie_Plugins/Containerfile`
- Add a `COPY` instruction to overwrite the project's default `system.md` at `/app/system.md` with the plugins' version, so the fallback on reset is the plugins' prompt
- Update `HeartReverie_Plugins/README.md`: fix container deployment section (remove `PROMPT_FILE` reference), add a note about the reset limitation in clone-based local dev setup
- Update `HeartReverie/docs/plugin-system.md`: add a warning about the reset limitation when using `PROMPT_FILE` for external plugins in local dev

## Capabilities

### New Capabilities

- `plugins-prompt-override`: Defines how the HeartReverie_Plugins Containerfile overrides the default system prompt by copying `system.md` to the project root location instead of using `ENV PROMPT_FILE`

### Modified Capabilities

(none)

## Impact

- **HeartReverie_Plugins/Containerfile**: Two lines changed (remove `ENV PROMPT_FILE`, add `COPY system.md`)
- **HeartReverie_Plugins/README.md**: Update container deployment section and add reset limitation note for local dev
- **HeartReverie/docs/plugin-system.md**: Add warning about reset behavior when using `PROMPT_FILE` for external plugins
- **No HeartReverie backend code changes**: The backend `readTemplate()` fallback logic is correct by design and unchanged
- **No backward compatibility concerns**: Project is pre-release with 0 users

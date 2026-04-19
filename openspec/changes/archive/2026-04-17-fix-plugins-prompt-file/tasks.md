## 1. Containerfile Changes

- [x] 1.1 Remove `ENV PROMPT_FILE=/app/external-plugins/system.md` from `HeartReverie_Plugins/Containerfile`
- [x] 1.2 Add `COPY --link --chown=$UID:0 --chmod=664 system.md /app/system.md` after the existing COPY instruction to overwrite the project default prompt

## 2. Documentation

- [x] 2.1 Update `HeartReverie_Plugins/README.md` container deployment section: remove mention of `PROMPT_FILE` being auto-set, explain that the plugins image overwrites the default `system.md`
- [x] 2.2 Update `HeartReverie_Plugins/README.md` local dev setup section: add a note about the reset limitation when using `PROMPT_FILE` (reset deletes the custom file and falls back to the base HeartReverie prompt)
- [x] 2.3 Update `HeartReverie_Plugins/README.md` system.md section: clarify the container vs local dev behavior difference
- [x] 2.4 Update `HeartReverie/docs/plugin-system.md`: add a warning about the prompt editor reset limitation when setting `PROMPT_FILE` to an external plugin's `system.md`

## 3. Verification

- [x] 3.1 Verify the Containerfile no longer contains `ENV PROMPT_FILE`
- [x] 3.2 Verify the Containerfile contains the `COPY system.md /app/system.md` instruction with correct ownership and mode

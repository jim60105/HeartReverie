## 1. Edit `HeartReverie/system.md`

- [x] 1.1 Open `HeartReverie/system.md` and locate the `# Formatting:` block (lines 4–8 of the current file). Insert a `<formatting>` line immediately above `# Formatting:` and a `</formatting>` line immediately after the `The narration has no styling.` line. Do not modify the four content lines.
- [x] 1.2 Locate the `# Language:` block (lines 10–12). Insert `<language>` immediately above `# Language:` and `</language>` immediately after the punctuation-width line. Do not modify the body.
- [x] 1.3 Locate the `[GAME INSTRUCTIONS: ...]` line (line 23). Replace the literal opening `[GAME INSTRUCTIONS: ` with `<game_instructions>\n` (newline-terminated) and replace the trailing `]` with `\n</game_instructions>`. Preserve every other character of the prose verbatim.
- [x] 1.4 Locate the `# Writing guidelines:` block (lines 25–33). Insert `<writing_guidelines>` immediately above `# Writing guidelines:` and `</writing_guidelines>` immediately after the last bullet (`- Do not use numbers to describe the status.`). Do not modify any bullet.
- [x] 1.5 Confirm by inspection: `grep -c '<formatting>' system.md` returns `1`; same for the close tag and the other three pairs. `# STORY SERIES`, `{{ series_name }}`, and the existing `<scenario>` wrapper are unchanged.

## 2. Update tests for `vento-prompt-template`

- [x] 2.1 Locate the existing test(s) under `HeartReverie/` that assert against the rendered output of `system.md` (likely under a `tests/` directory or co-located). Find any that contain the literal strings `# Formatting`, `# Language`, `[GAME INSTRUCTIONS`, or `# Writing guidelines` in their expected-output fixtures.
- [x] 2.2 Update each such fixture to include the new wrapping tags exactly as introduced in tasks 1.1–1.4.
- [x] 2.3 Run `deno task test` (or the project's standard test command) at HR repo root; all tests SHALL pass.

## 3. Container build + integration smoke test (BLOCKING per AGENTS.md)

- [x] 3.1 `bash HeartReverie/scripts/podman-build-run.sh` to build the combined image and run the container.
- [x] 3.2 `podman logs heartreverie 2>&1 | grep -i "error\|warn"` — must be clean.
- [x] 3.3 Use `agent-browser` to log in to `http://localhost:8080/`, open the prompt-preview UI (per the `prompt-preview` capability) for any story, and visually confirm the rendered system prompt now contains the literal substrings `<formatting>`, `</formatting>`, `<language>`, `</language>`, `<game_instructions>`, `</game_instructions>`, `<writing_guidelines>`, `</writing_guidelines>` exactly once each, in the listed order.
- [x] 3.4 Generate one chapter through the writer UI and visually confirm the model's response continues to honour the rules (≥20 lines, Traditional Chinese, no euphemism, dialogue-driven, etc.) — i.e. the model still understood the wrapped instructions.
- [x] 3.5 If 3.3 or 3.4 fails (tags missing in rendered prompt, model regression in style/length/language), iterate on `system.md` inside this change. Do NOT archive until both pass.

## 4. Validate and finalise

- [x] 4.1 `cd HeartReverie && openspec validate name-system-prompt-blocks --strict` — must pass.
- [x] 4.2 Mark all tasks `[x]` and commit on a feature branch with conventional `refactor(prompt):` subject and Co-authored-by trailer.

## ADDED Requirements

### Requirement: readTemplate prompt-file helper canonical home is a library module

The `readTemplate` helper — which reads the custom prompt file at `PROMPT_FILE` and falls back to `system.md` under `ROOT_DIR` when the custom file does not exist (returning `{ content, source: "custom" | "default" }`) — SHALL reside canonically in the library module `writer/lib/prompt-file.ts`. Its signature and read-with-fallback behavior SHALL be unchanged from the prior implementation: it SHALL read `config.PROMPT_FILE`; on `Deno.errors.NotFound` it SHALL read `system.md` under `config.ROOT_DIR` and report `source: "default"`; any other error SHALL be rethrown.

A re-export `export { readTemplate } from "../lib/prompt-file.ts";` SHALL be retained from `writer/routes/prompt.ts` so existing importers (including the prompt GET/PUT route handlers) continue to resolve `readTemplate` without call-site changes.

#### Scenario: Custom prompt file is read when present

- **WHEN** `readTemplate` is called and a file exists at `config.PROMPT_FILE`
- **THEN** it SHALL return `{ content: <file content>, source: "custom" }`

#### Scenario: Fallback to system.md when custom file missing

- **WHEN** `readTemplate` is called and no file exists at `config.PROMPT_FILE` (`Deno.errors.NotFound`)
- **THEN** it SHALL read `system.md` under `config.ROOT_DIR` and return `{ content: <system.md content>, source: "default" }`

#### Scenario: Non-NotFound errors propagate

- **WHEN** reading `config.PROMPT_FILE` throws an error other than `Deno.errors.NotFound`
- **THEN** `readTemplate` SHALL rethrow that error and SHALL NOT fall back to `system.md`

#### Scenario: Re-export keeps the routes path working

- **WHEN** a module imports `readTemplate` from `writer/routes/prompt.ts`
- **THEN** the import SHALL resolve via the re-export to the implementation in `writer/lib/prompt-file.ts`, and the prompt GET/PUT route handlers SHALL continue to call `readTemplate` unchanged

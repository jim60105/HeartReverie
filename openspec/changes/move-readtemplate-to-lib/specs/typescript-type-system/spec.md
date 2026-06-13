## ADDED Requirements

### Requirement: readTemplate signature and import convention preserved across the move

The moved `readTemplate` function in `writer/lib/prompt-file.ts` SHALL retain its exact signature `(config: { PROMPT_FILE: string; ROOT_DIR: string }) => Promise<{ content: string; source: "custom" | "default" }>`, including its explicit return type annotation and JSDoc. The new module SHALL use the project's internal import convention (`.ts`-suffixed local import specifiers) for its `@std/path` `join` dependency, and SHALL carry the AGPL-3.0-or-later header required of every source file.

#### Scenario: Explicit return type retained

- **WHEN** `writer/lib/prompt-file.ts` is inspected
- **THEN** the exported `readTemplate` function SHALL declare the explicit return type `Promise<{ content: string; source: "custom" | "default" }>`

#### Scenario: Type check passes for the new module

- **WHEN** `deno check writer/server.ts` is run after the move
- **THEN** it SHALL exit 0 with no type errors introduced by `writer/lib/prompt-file.ts` or the updated import in `writer/lib/chat-shared.ts`

#### Scenario: New library file carries the license header

- **WHEN** `writer/lib/prompt-file.ts` is created
- **THEN** it SHALL begin with the AGPL-3.0-or-later license header used across the backend source tree

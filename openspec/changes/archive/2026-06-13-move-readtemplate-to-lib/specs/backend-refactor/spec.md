## ADDED Requirements

### Requirement: Library modules SHALL NOT import from route modules

Modules under `writer/lib/` SHALL NOT import from `writer/routes/`. The dependency direction SHALL be unidirectional: route modules depend on library modules, never the reverse. Specifically, the `readTemplate` prompt-file read-with-fallback helper consumed by `writer/lib/chat-shared.ts` SHALL reside in a library module and be imported from `writer/lib/`, not from `writer/routes/prompt.ts`.

#### Scenario: No lib-to-routes imports remain

- **WHEN** the codebase is searched with `grep -rn 'from "../routes/' writer/lib/`
- **THEN** zero matches SHALL be returned

#### Scenario: chat-shared imports readTemplate from lib

- **WHEN** `writer/lib/chat-shared.ts` is inspected for its `readTemplate` import
- **THEN** it SHALL import `readTemplate` from `./prompt-file.ts` (a `writer/lib/` module) and SHALL NOT import it from `../routes/prompt.ts`

#### Scenario: Core chat unit tests do not transitively pull a route module

- **WHEN** a unit test exercises the chat core via `writer/lib/chat-shared.ts`
- **THEN** the module graph it imports SHALL NOT include `writer/routes/prompt.ts` solely to obtain `readTemplate`

# writer-backend

## MODIFIED Requirements

### Requirement: Server initialization

The writer backend SHALL be a Deno application using Hono framework with TypeScript ESM modules. Route handlers SHALL be organized into separate module files under `writer/routes/`. Middleware functions SHALL be extracted into `writer/lib/middleware.ts`. Configuration SHALL be centralized in `writer/lib/config.ts`. Error response construction SHALL use a shared `problemJson()` helper from `writer/lib/errors.ts`.

#### Scenario: Server starts and serves static frontend
- **WHEN** the server process is started with valid TLS certificates via `deno run`
- **THEN** the server SHALL listen on HTTPS and serve files from the `reader/` directory at the root path `/`

#### Scenario: API routes are mounted
- **WHEN** the server starts
- **THEN** all `/api/` routes SHALL be available as Hono route handlers, each imported from its respective route module

#### Scenario: Modular route structure
- **WHEN** a developer inspects the `writer/routes/` directory
- **THEN** each file contains handlers for a single API domain (auth, stories, chapters, chat, plugins, prompt)

#### Scenario: TypeScript type checking passes
- **WHEN** a developer runs `deno check` on the writer backend entry point
- **THEN** all TypeScript files under `writer/` SHALL pass type checking without errors

### Requirement: Type-safe dependency injection

The dependency bag passed to `createApp()` and route registrars SHALL conform to the `AppDeps` interface defined in `writer/types.ts`. Route registrar functions SHALL receive typed dependency parameters rather than untyped objects.

#### Scenario: createApp receives typed dependencies
- **WHEN** `createApp()` is called with a dependency object
- **THEN** the parameter SHALL be typed as `AppDeps` and the TypeScript compiler SHALL reject any call that does not satisfy the interface

#### Scenario: Route registrar receives typed deps
- **WHEN** a route registrar function (e.g., `registerChatRoutes`) receives the deps parameter
- **THEN** the parameter SHALL be typed as the appropriate subset interface of `AppDeps`, and accessing properties not defined in the interface SHALL produce a compile-time error

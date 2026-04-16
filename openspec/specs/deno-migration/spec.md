# Deno Migration

## Purpose

Migration of the writer backend from Node.js to Deno 2.x runtime with Hono framework, Deno native APIs, and standard library modules.

## Requirements

### Requirement: Deno runtime
The writer backend SHALL run on Deno 2.x with explicit permission flags (`--allow-net`, `--allow-read`, `--allow-write`, `--allow-env`).

#### Scenario: Server startup on Deno
- **WHEN** the developer runs `deno run` with appropriate permissions
- **THEN** the server starts and accepts HTTPS connections

### Requirement: Deno dependency management
All dependencies SHALL be managed via `deno.json` import map using `jsr:` or `npm:` specifiers. No `package.json` or `node_modules` directory.

#### Scenario: Clean dependency resolution
- **WHEN** the developer clones the repository and runs `deno run`
- **THEN** dependencies are resolved automatically without a separate install step

### Requirement: Hono web framework
The HTTP framework SHALL be Hono (`jsr:@hono/hono`) with middleware for security headers, rate limiting, JSON body parsing, and static file serving.

#### Scenario: Route registration
- **WHEN** the Hono app is created
- **THEN** all existing API endpoints are registered with identical paths, methods, and response contracts

### Requirement: Deno file system APIs
All file system operations SHALL use Deno native APIs (`Deno.readTextFile`, `Deno.writeTextFile`, `Deno.readDir`, `Deno.mkdir`, `Deno.remove`, `Deno.open`).

#### Scenario: Read directory
- **WHEN** listing story directories
- **THEN** the code uses `Deno.readDir()` async iterator (not Node.js `fs.readdir`)

### Requirement: Deno path utilities
Path manipulation SHALL use `@std/path` (`join`, `resolve`, `basename`, `relative`, `SEPARATOR`, `isAbsolute`).

#### Scenario: Path operations
- **WHEN** constructing file paths
- **THEN** the code imports from `@std/path` (not `node:path`)

### Requirement: Deno environment and crypto
Environment variables SHALL be accessed via `Deno.env.get()`. Timing-safe comparison SHALL use `@std/crypto/timing-safe-equal` or equivalent.

#### Scenario: Environment variable access
- **WHEN** reading configuration from environment
- **THEN** the code uses `Deno.env.get("VAR_NAME")` (not `process.env.VAR_NAME`)

### Requirement: Deno TLS server
The HTTPS server SHALL use Deno's native TLS support via `Deno.serve()` with `cert` and `key` options.

#### Scenario: TLS server startup
- **WHEN** the server starts with cert and key file paths
- **THEN** it listens on HTTPS using Deno's built-in TLS (not Node.js `https.createServer`)

### Requirement: Vento template engine compatibility
The Vento template engine SHALL be imported as `npm:ventojs` and function identically to the Node.js version.

#### Scenario: Template rendering
- **WHEN** `renderSystemPrompt()` renders a template with plugin variables
- **THEN** the output is identical to the Node.js version

### Requirement: Deno test migration
All tests SHALL be migrated to Deno's built-in test runner using `Deno.test()` and `@std/assert`.

#### Scenario: Test execution
- **WHEN** the developer runs `deno test`
- **THEN** all backend and frontend tests execute and pass

### Requirement: serve.sh update
The `serve.sh` script SHALL invoke `deno` instead of `node`, with appropriate permission flags.

#### Scenario: Script invocation
- **WHEN** the developer runs `./serve.sh`
- **THEN** the script checks for `deno` (not `node`), and execs `deno run` with `--allow-net --allow-read --allow-write --allow-env`

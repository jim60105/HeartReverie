# Delta Spec: vue-frontend-tests

## MODIFIED Requirements

### Requirement: Test framework migration to Vitest

All frontend tests SHALL use Vitest as the test runner and assertion library, replacing `Deno.test` and `@std/assert`. Vue component tests SHALL use `@vue/test-utils` for mounting and interacting with components. The test command `deno task test:frontend` SHALL invoke Vitest via `deno run -A npm:vitest@^3.1.2 run` (NOT `npx vitest run`). The root `deno task test` command SHALL also use the same Deno-based vitest invocation for its frontend test step. Vitest configuration SHALL reside in `reader-src/vite.config.ts` (or a dedicated `reader-src/vitest.config.ts`) with `jsdom` or `happy-dom` as the test environment. The `"types": ["vitest/globals"]` in `reader-src/tsconfig.json` MAY be adjusted for Deno compatibility if the type resolution path changes due to the removal of `node_modules`.

#### Scenario: Tests run via deno task
- **WHEN** `deno task test:frontend` is executed
- **THEN** Vitest SHALL be invoked via `deno run -A npm:vitest@^3.1.2 run` and SHALL run all frontend test files, reporting results with pass/fail counts

#### Scenario: Vitest environment configured
- **WHEN** the Vitest configuration is loaded
- **THEN** it SHALL specify a DOM environment (`jsdom` or `happy-dom`) for browser API simulation

#### Scenario: No Deno.test references remain
- **WHEN** the frontend test directory is searched for `Deno.test` or `@std/assert` imports
- **THEN** zero matches SHALL be found — all tests SHALL use Vitest `describe`/`it`/`expect` patterns

#### Scenario: No npx invocations in test command
- **WHEN** the `test:frontend` task definition in `deno.json` is examined
- **THEN** it SHALL use `deno run -A npm:vitest@^3.1.2 run` and SHALL NOT contain `npx`

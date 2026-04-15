# Spec: deno-frontend-toolchain

> Defines requirements for managing frontend dependencies and build tooling entirely through Deno, eliminating the need for Node.js, npm, and `node_modules` in the frontend workflow.

## Purpose

This specification covers the migration of the frontend (`reader-src/`) dependency management and build pipeline from npm/Node.js to Deno. All frontend npm packages are declared in the root `deno.json` using `npm:` specifiers, task commands use `deno run` instead of `npx`, and the `node_modules` directory is eliminated in favor of Deno's global cache.

## ADDED Requirements

### Requirement: Deno-managed frontend dependencies

All frontend npm packages SHALL be declared in the root `deno.json` imports using `npm:` specifiers. The following packages MUST be present in the `deno.json` imports map: `npm:vue`, `npm:vue-router`, `npm:marked`, `npm:dompurify`, `npm:@types/dompurify`, `npm:vite`, `npm:vitest`, `npm:vue-tsc`, `npm:@vitejs/plugin-vue`, `npm:@vue/test-utils`, `npm:autoprefixer`, `npm:postcss`, `npm:tailwindcss`, `npm:happy-dom`, `npm:typescript`. The `reader-src/package.json` and `reader-src/package-lock.json` files SHALL be deleted and MUST NOT exist in the repository.

#### Scenario: All frontend packages declared in deno.json
- **WHEN** the root `deno.json` imports map is examined
- **THEN** it SHALL contain entries for `npm:vue`, `npm:vue-router`, `npm:marked`, `npm:dompurify`, `npm:@types/dompurify`, `npm:vite`, `npm:vitest`, `npm:vue-tsc`, `npm:@vitejs/plugin-vue`, `npm:@vue/test-utils`, `npm:autoprefixer`, `npm:postcss`, `npm:tailwindcss`, `npm:happy-dom`, and `npm:typescript`

#### Scenario: package.json and package-lock.json removed
- **WHEN** the `reader-src/` directory is examined
- **THEN** neither `package.json` nor `package-lock.json` SHALL exist

### Requirement: Deno task commands

The `deno.json` tasks SHALL replace `npx` invocations with version-pinned `deno run` commands. CLI invocations MUST include explicit version ranges because `deno run npm:<pkg>` resolves independently from `deno.json` imports. The `dev:reader` task SHALL execute `deno run -A npm:vite@^6.3.2` in the `reader-src/` directory. The `build:reader` task SHALL execute `deno run -A npm:vue-tsc@^2.2.8 --noEmit && deno run -A npm:vite@^6.3.2 build --outDir ../reader-dist` in the `reader-src/` directory. The `test:frontend` task SHALL execute `deno run -A npm:vitest@^3.1.2 run` in the `reader-src/` directory. The root `test` task SHALL also be updated to use `deno run -A npm:vitest@^3.1.2 run` instead of `npx vitest run`.

#### Scenario: dev:reader task uses deno run
- **WHEN** `deno task dev:reader` is executed
- **THEN** it SHALL invoke `deno run -A npm:vite@^6.3.2` (NOT `npx vite`) in the `reader-src/` directory to start the Vite dev server

#### Scenario: build:reader task uses deno run for type check and build
- **WHEN** `deno task build:reader` is executed
- **THEN** it SHALL first run `deno run -A npm:vue-tsc@^2.2.8 --noEmit` for type checking, then run `deno run -A npm:vite@^6.3.2 build --outDir ../reader-dist` for the production build, both in the `reader-src/` directory

#### Scenario: test:frontend task uses deno run
- **WHEN** `deno task test:frontend` is executed
- **THEN** it SHALL invoke `deno run -A npm:vitest@^3.1.2 run` (NOT `npx vitest run`) in the `reader-src/` directory

#### Scenario: root test task updated
- **WHEN** `deno task test` is executed
- **THEN** it SHALL chain backend Deno tests with `deno run -A npm:vitest@^3.1.2 run` for frontend tests (NOT `npx vitest run`)

### Requirement: Vite configuration compatibility

The `reader-src/vite.config.ts` SHALL use `import.meta.dirname` instead of `__dirname` for path resolution, as Deno does not provide `__dirname` in ESM context. All other Vite configuration — including plugins (`@vitejs/plugin-vue`), dev server proxy settings, and test environment configuration — SHALL remain unchanged.

#### Scenario: Path resolution uses import.meta.dirname
- **WHEN** `reader-src/vite.config.ts` resolves paths (e.g., for `resolve.alias`)
- **THEN** it SHALL use `import.meta.dirname` instead of `__dirname`

#### Scenario: Vite plugins and proxy remain unchanged
- **WHEN** the Vite configuration is loaded
- **THEN** the `@vitejs/plugin-vue` plugin, dev server proxy, and test environment settings SHALL be identical to the pre-migration configuration

### Requirement: TypeScript configuration update

The `reader-src/tsconfig.json` SHALL remove `node_modules` from the `exclude` array, as `node_modules` no longer exists in the project. All TypeScript compiler options (strict mode, target, module resolution, paths) SHALL remain unchanged.

#### Scenario: node_modules removed from tsconfig exclude
- **WHEN** `reader-src/tsconfig.json` is examined
- **THEN** the `exclude` array SHALL NOT contain `node_modules`

#### Scenario: Compiler options unchanged
- **WHEN** `reader-src/tsconfig.json` compiler options are compared to the pre-migration configuration
- **THEN** all compiler options (e.g., `strict`, `target`, `module`, `moduleResolution`, `paths`) SHALL be identical

### Requirement: Lock file consolidation

The `deno.lock` file SHALL contain all dependency versions for both backend JSR packages and frontend npm packages, serving as the single lock file for the entire project. The `reader-src/package-lock.json` file SHALL be deleted and MUST NOT exist in the repository.

#### Scenario: deno.lock covers frontend dependencies
- **WHEN** `deno.lock` is examined after running `deno cache` or any `deno task` command
- **THEN** it SHALL contain locked versions for frontend npm packages (e.g., `vue`, `vite`, `vitest`) alongside backend JSR packages

#### Scenario: No separate package-lock.json
- **WHEN** the repository file tree is examined
- **THEN** no `package-lock.json` file SHALL exist anywhere in the repository

### Requirement: Deno-managed node_modules

The `reader-src/node_modules/` directory SHALL NOT exist as a standalone npm artifact. The root `deno.json` SHALL set `"nodeModulesDir": "auto"` which causes Deno to auto-create a root `node_modules/` directory with symlinks into the Deno cache. This is required because `vue-tsc` (TypeScript's type checker) uses standard TypeScript module resolution to find type definitions like `vitest/globals`, which expects a `node_modules/` directory. The root `node_modules/` is Deno-managed, gitignored, and requires no `npm install` step. No `npm install` step SHALL be required to resolve frontend dependencies.

#### Scenario: reader-src/node_modules absent
- **WHEN** the `reader-src/` directory is examined
- **THEN** no `node_modules/` directory SHALL exist inside `reader-src/`

#### Scenario: Root node_modules is Deno-managed
- **WHEN** the root directory is examined after running any `deno task` command
- **THEN** a `node_modules/` directory MAY exist, auto-created by Deno's `nodeModulesDir: "auto"` setting, containing symlinks to the Deno cache

#### Scenario: Root node_modules is gitignored
- **WHEN** `.gitignore` is examined
- **THEN** `node_modules/` SHALL be listed to prevent Deno-managed artifacts from being committed

#### Scenario: Dependencies resolve without npm install
- **WHEN** a developer clones the repository and runs `deno task build:reader`
- **THEN** Deno SHALL automatically download and cache all required npm packages without a prior `npm install` step

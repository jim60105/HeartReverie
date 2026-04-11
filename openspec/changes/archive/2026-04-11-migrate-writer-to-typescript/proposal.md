## Why

The writer backend (`writer/`) is currently plain JavaScript with no static type checking. This means type errors are only caught at runtime, IDE support is limited to inference heuristics, and the codebase relies heavily on untyped "deps bag" patterns and duck-typed plugin interfaces. Migrating to TypeScript will catch entire categories of bugs at compile time, provide self-documenting interfaces for the plugin system and route handlers, and improve maintainability as the project grows. Additionally, Deno has first-class TypeScript support with zero configuration, making the migration path straightforward.

## What Changes

- **Rename all `.js` source files** in `writer/` to `.ts` (including `server.js`, `app.js`, all `lib/*.js`, and all `routes/*.js`)
- **Rename all `_test.js` files** to `_test.ts` with typed mocks and assertions
- **Define TypeScript interfaces** for all key data structures:
  - `AppDeps` interface for the dependency injection bag passed to `createApp()` and route registrars
  - `PluginManifest` interface for parsed `plugin.json` shapes
  - `PluginModule` interface for dynamically imported backend modules
  - `HookContext` interfaces for each lifecycle stage (`prompt-assembly`, `response-stream`, `post-response`, `strip-tags`)
  - `StoryEngine` return type for `createStoryEngine()` factory
  - `TemplateEngine` return type for `createTemplateEngine()` factory
  - `OpenRouterResponse` / `StreamChunk` types for the SSE chat streaming pipeline
- **Enable strict TypeScript** via `compilerOptions` in `deno.json` (`strict: true`, `noImplicitAny: true`, `strictNullChecks: true`)
- **Update all internal import paths** from `.js` to `.ts` extensions
- **Add explicit return types** to all exported functions
- **Apply Hono's generic type parameters** to `Context`, route definitions, and middleware signatures
- **Refactor bitwise boolean comparison** in `middleware.ts` (timing-safe passphrase check) to use proper TypeScript-safe pattern
- **Apply TypeScript security best practices**: strict null checks, no `any` escape hatches (prefer `unknown`), readonly where appropriate, exhaustive switch/union handling, and input validation typing

## Capabilities

### New Capabilities
- `typescript-type-system`: TypeScript compiler configuration, shared interfaces and type definitions for the writer backend's dependency injection, plugin manifest schema, hook contexts, API response shapes, and factory return types
- `typescript-security`: Security-focused TypeScript coding guidelines including strict mode enforcement, `unknown` over `any`, readonly immutability, exhaustive pattern matching, and secure input validation typing

### Modified Capabilities
- `writer-backend`: Language requirement changes from JavaScript to TypeScript; all source files become `.ts`; strict type checking is enforced
- `backend-tests`: Test files change from `_test.js` to `_test.ts`; mock objects must satisfy TypeScript interfaces
- `test-infrastructure`: Test execution command updates for `.ts` file extensions; type checking integrated into test validation

## Impact

- **Code**: All 14 source files + 15 test files in `writer/` renamed and converted
- **Dependencies**: No new runtime dependencies; TypeScript is built into Deno. May add `@types` packages if `ventojs` lacks bundled types
- **Configuration**: `deno.json` gains `compilerOptions` for strict TypeScript
- **Build/CI**: `deno check writer/` added as a type-checking step; existing `deno test` command continues to work with `.ts` files
- **Plugins**: Plugin API contract unchanged — plugins remain JavaScript; only the host (writer) becomes TypeScript
- **Breaking changes**: None for external consumers — all API endpoints, request/response formats, and plugin interfaces remain identical

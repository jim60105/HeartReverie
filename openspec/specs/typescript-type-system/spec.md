# TypeScript Type System

## Purpose

TypeScript compiler configuration and shared type definitions for the writer backend, ensuring type safety across all modules.

## Requirements

### Requirement: TypeScript compiler configuration

The project SHALL enable strict mode in `deno.json` compilerOptions with `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`, `noUncheckedIndexedAccess: true`, `noUnusedLocals: true`, `noUnusedParameters: true`. These settings SHALL apply to all TypeScript files under `writer/`.

#### Scenario: Strict compiler options are enforced
- **WHEN** a developer runs `deno check` on any file under `writer/`
- **THEN** the TypeScript compiler SHALL use the strict settings defined in `deno.json` compilerOptions, and any violation of strict rules SHALL produce a compile-time error

#### Scenario: Unused variables are rejected
- **WHEN** a TypeScript file under `writer/` contains an unused local variable or unused parameter
- **THEN** `deno check` SHALL report a compile-time error for the unused binding

#### Scenario: Unchecked indexed access prevented
- **WHEN** code indexes an array or object without a subsequent null/undefined guard
- **THEN** `deno check` SHALL report a type error because `noUncheckedIndexedAccess` causes indexed access to return `T | undefined`

### Requirement: Shared type definitions

A `writer/types.ts` file SHALL contain all shared interfaces and types used across the writer backend. This file SHALL be the single source of truth for cross-module type contracts.

The following interfaces and types SHALL be defined:

- `AppConfig` interface for readonly configuration from environment variables
- `AppDeps` interface for the dependency injection bag, including properties: `config`, `safePath`, `pluginManager`, `hookDispatcher`, `buildPromptFromStory`, `verifyPassphrase`
- `SafePathFn` type alias for the safe path resolution function
- `PluginManifest` interface for plugin.json schema, including properties: `name`, `version`, `description`, `type`, `tags`, `backendModule`, `frontendModule`, `promptStripTags`, `displayStripTags`, `promptFragments`, `parameters`
- `PluginParameter` interface for parameter entries in plugin manifests
- `PromptFragment` interface for prompt fragment entries in plugin manifests
- `PluginModule` interface for dynamically imported backend modules, with optional members: `register?: function`, `default?: function`
- `HookHandler` type: `(context: Record<string, unknown>) => Promise<void>`
- `HookStage` union type: `"prompt-assembly" | "response-stream" | "post-response" | "strip-tags"`
- `HookContext` union of stage-specific context interfaces for each lifecycle stage
- `StoryEngine` interface for `createStoryEngine` return type, with members: `stripPromptTags`, `loadStatus`, `buildPromptFromStory`
- `TemplateEngine` interface for `createTemplateEngine` return type, with members: `renderSystemPrompt`, `validateTemplate`, `ventoEnv`
- `BuildPromptResult` interface for `buildPromptFromStory` return, with members: `prompt`, `previousContext`, `statusContent`, `isFirstRound`, `ventoError`, `chapterFiles`, `chapters`
- `BuildPromptFn` type alias for the `buildPromptFromStory` function signature
- `RenderResult` discriminated union for `renderSystemPrompt` return: `{ content: string; error: null } | { content: null; error: object }`
- `OpenRouterStreamChunk` interface for SSE streaming response shapes
- `ProblemDetail` interface for RFC 9457 error response shape
- `VentoError` interface for template rendering error shape

#### Scenario: AppDeps interface is importable
- **WHEN** a route module imports `AppDeps` from `writer/types.ts`
- **THEN** the imported interface SHALL provide type information for all dependency injection properties and `deno check` SHALL pass

#### Scenario: HookStage restricts to valid stages
- **WHEN** a developer attempts to use a string not in the `HookStage` union as a hook stage parameter
- **THEN** the TypeScript compiler SHALL report a type error at compile time

#### Scenario: RenderResult discriminated union
- **WHEN** code checks `result.error === null` on a `RenderResult` value
- **THEN** TypeScript SHALL narrow the type so that `result.content` is known to be `string` within that branch

#### Scenario: PluginManifest covers plugin.json schema
- **WHEN** a plugin.json file is loaded and typed as `PluginManifest`
- **THEN** all declared properties (`name`, `version`, `description`, `type`, `tags`, `backendModule`, `frontendModule`, `promptStripTags`, `displayStripTags`, `promptFragments`, `parameters`) SHALL be accessible with their correct types

### Requirement: Explicit return types

All exported functions SHALL have explicit return type annotations. Functions SHALL NOT rely on TypeScript return type inference for their public API surface.

#### Scenario: Exported function has explicit return type
- **WHEN** a developer inspects any exported function in the `writer/` directory
- **THEN** the function declaration SHALL include an explicit return type annotation after the parameter list

#### Scenario: deno check validates return types
- **WHEN** `deno check` is run on the writer backend
- **THEN** it SHALL verify that all exported functions have return types consistent with their implementations

### Requirement: Import path convention

All internal imports within the `writer/` directory SHALL use `.ts` file extensions in their import specifiers. Bare specifiers without extensions SHALL NOT be used for local module imports.

#### Scenario: Internal imports use .ts extension
- **WHEN** a TypeScript file under `writer/` imports another local module
- **THEN** the import path SHALL end with `.ts` (e.g., `import { safePath } from "./lib/utils.ts"`)

#### Scenario: Deno resolves .ts imports
- **WHEN** the Deno runtime loads a module with a `.ts` import specifier
- **THEN** the module SHALL resolve and load without errors

### Requirement: No implicit any

No `any` type SHALL appear in production source code under `writer/`. The `unknown` type SHALL be used for values whose type is genuinely not known at compile time, with explicit type narrowing before use.

#### Scenario: Source code contains no any type
- **WHEN** a developer searches for the `any` type annotation in production files under `writer/` (excluding test files)
- **THEN** no occurrences SHALL be found

#### Scenario: Unknown values are narrowed before use
- **WHEN** a value is typed as `unknown`
- **THEN** the code SHALL narrow its type via type guards, `instanceof` checks, or conditional checks before accessing properties or methods on it

# Tasks — migrate-writer-to-typescript

## 1. Configuration & Setup

- [x] 1.1 Add `compilerOptions` to root `deno.json` — set `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`, `noUncheckedIndexedAccess: true`, `noUnusedLocals: true`, `noUnusedParameters: true`
- [x] 1.2 Create ambient declaration file `writer/vendor/ventojs.d.ts` — declare module `"ventojs"` with `VentoEnvironment` interface (`run`, `runString`, `load` methods) and default export factory function; add comment referencing pinned ventojs version
- [x] 1.3 Update any `deno.json` task definitions that reference `.js` entry points to use `.ts` extensions (e.g., `server.js` → `server.ts`)

## 2. Type Definitions

- [x] 2.1 Create `writer/types.ts` with all shared interfaces and types:
  - `AppConfig` (readonly configuration from env vars)
  - `AppDeps` (DI bag: `config`, `safePath`, `pluginManager`, `hookDispatcher`, `buildPromptFromStory`, `verifyPassphrase`)
  - `SafePathFn` type alias
  - `PluginManifest` (full `plugin.json` schema: `name`, `version`, `description`, `type`, `tags`, `backendModule`, `frontendModule`, `stripTags`, `promptFragments`, `parameters`)
  - `PluginParameter` (parameter entry in manifest)
  - `PromptFragment` (prompt fragment entry in manifest)
  - `PluginModule` (dynamic import contract: optional `register`, optional `default`)
  - `HookStage` union type (`"prompt-assembly" | "response-stream" | "post-response" | "strip-tags"`)
  - `HookHandler` type (`(context: Record<string, unknown>) => Promise<void>`)
  - `HookContext` union of stage-specific context interfaces
  - `StoryEngine` interface (`stripPromptTags`, `loadStatus`, `buildPromptFromStory`)
  - `TemplateEngine` interface (`renderSystemPrompt`, `validateTemplate`, `ventoEnv`)
  - `BuildPromptResult` interface (`prompt`, `previousContext`, `statusContent`, `isFirstRound`, `ventoError`, `chapterFiles`, `chapters`)
  - `RenderResult` discriminated union (`{ content: string; error: null } | { content: null; error: object }`)
  - `BuildPromptFn` type alias
  - `OpenRouterStreamChunk` interface
  - `ProblemDetail` interface (RFC 9457 shape)
  - `VentoError` interface
- [x] 2.2 Verify `writer/types.ts` passes `deno check writer/types.ts` in isolation

## 3. Core Library Migration

Rename each `writer/lib/*.js` → `.ts`, add type annotations, update all internal import paths to `.ts`. Order by dependency — config has no local deps; others depend on config and/or types.

- [x] 3.1 Migrate `writer/lib/config.js` → `config.ts` — type return value as `Readonly<AppConfig>`, add explicit return type annotations to all exports
- [x] 3.2 Migrate `writer/lib/errors.js` → `errors.ts` — type `problemJson()` return as `ProblemDetail`, add explicit return types
- [x] 3.3 Migrate `writer/lib/hooks.js` → `hooks.ts` — type `HookDispatcher` class methods with `HookStage`, `HookHandler`, stage-specific `HookContext` types; add exhaustive `never` check on stage switches; use `readonly` for internal handler arrays
- [x] 3.4 Migrate `writer/lib/middleware.js` → `middleware.ts` — fix bitwise AND pattern with `Number()` coercion (`(Number(lengthMatch) & Number(equal)) === 1`); type passphrase verifier as `MiddlewareHandler`; apply Hono `Context` generics
- [x] 3.5 Migrate `writer/lib/plugin-manager.js` → `plugin-manager.ts` — type `PluginManager` class with `PluginManifest`, `PluginModule`; use `unknown` + runtime `typeof` guard for dynamic `import()` boundary; co-locate private `PluginEntry` type; use `readonly` for plugin list
- [x] 3.6 Migrate `writer/lib/story.js` → `story.ts` — type `createStoryEngine()` return as `StoryEngine`; type `buildPromptFromStory` return as `BuildPromptResult`; add null guards for `noUncheckedIndexedAccess` array accesses
- [x] 3.7 Migrate `writer/lib/template.js` → `template.ts` — type `createTemplateEngine()` return as `TemplateEngine`; type `renderSystemPrompt` return as `RenderResult` discriminated union; co-locate `TemplateValidationResult` type

## 4. Route Migration

Rename each `writer/routes/*.js` → `.ts`, type deps parameter with `Pick<AppDeps, ...>`, add explicit return types, type request bodies as `unknown` with validation.

- [x] 4.1 Migrate `writer/routes/auth.js` → `auth.ts` — type deps with `Pick<AppDeps, "verifyPassphrase">`, add return type annotations
- [x] 4.2 Migrate `writer/routes/stories.js` → `stories.ts` — type deps with appropriate `Pick<AppDeps, ...>` subset, type request body as `unknown` with validation before use
- [x] 4.3 Migrate `writer/routes/chapters.js` → `chapters.ts` — type deps, add null guards for chapter array indexing
- [x] 4.4 Migrate `writer/routes/plugins.js` → `plugins.ts` — type deps including `pluginManager`, apply `PluginManifest` types to response shapes
- [x] 4.5 Migrate `writer/routes/prompt.js` → `prompt.ts` — type deps, type template rendering pipeline
- [x] 4.6 Migrate `writer/routes/chat.js` → `chat.ts` — type deps, type SSE streaming with `OpenRouterStreamChunk`, type request body validation, type error catch blocks as `unknown` with narrowing

## 5. Entry Point Migration

Depends on all libs and routes being `.ts` already.

- [x] 5.1 Migrate `writer/app.js` → `app.ts` — type `createApp(deps: AppDeps)` parameter and return as `Hono`; co-locate `RateLimiterOptions` type; update all route/lib imports to `.ts`
- [x] 5.2 Migrate `writer/server.js` → `server.ts` — type top-level dependency construction to satisfy `AppDeps` interface; update entry-point imports to `.ts`
- [x] 5.3 Run `deno check writer/server.ts` — verify full dependency graph type-checks with zero errors

## 6. Test Migration

Rename all `_test.js` → `_test.ts` in one pass. Use `Partial<AppDeps>` cast as `AppDeps` for test mocks. No `as any` on mock objects.

- [x] 6.1 Migrate lib test files (9 files):
  - `writer/lib/errors_test.js` → `errors_test.ts`
  - `writer/lib/hooks_test.js` → `hooks_test.ts`
  - `writer/lib/middleware_test.js` → `middleware_test.ts`
  - `writer/lib/plugin-manager_test.js` → `plugin-manager_test.ts`
  - `writer/lib/rate-limit_test.js` → `rate-limit_test.ts`
  - `writer/lib/smoke_test.js` → `smoke_test.ts`
  - `writer/lib/string-utils_test.js` → `string-utils_test.ts`
  - `writer/lib/template_test.js` → `template_test.ts`
  - `writer/lib/validation_test.js` → `validation_test.ts`
- [x] 6.2 Migrate route test files (6 files):
  - `writer/routes/auth_test.js` → `auth_test.ts`
  - `writer/routes/chapters_test.js` → `chapters_test.ts`
  - `writer/routes/chat_test.js` → `chat_test.ts`
  - `writer/routes/plugins_test.js` → `plugins_test.ts`
  - `writer/routes/prompt_test.js` → `prompt_test.ts`
  - `writer/routes/stories_test.js` → `stories_test.ts`
- [x] 6.3 Update all test import paths from `.js` to `.ts`; type mock objects with `Partial<AppDeps> as AppDeps` pattern; ensure mock stubs gain type safety from typed source functions
- [x] 6.4 Run `deno check` on all test files — verify zero type errors in `_test.ts` files

## 7. Security Review

Walk through `typescript-security` spec requirements across all migrated files.

- [x] 7.1 Audit strict null safety — confirm all nullable values use explicit union types (`T | null`), optional chaining (`?.`), and nullish coalescing (`??`); no loose truthy checks on nullable objects
- [x] 7.2 Audit no-any compliance — confirm zero `any` in production code under `writer/` (excluding `vendor/ventojs.d.ts`); all `unknown` values narrowed before property access
- [x] 7.3 Audit readonly immutability — confirm `AppConfig` uses `Readonly<T>`, hook stage arrays use `readonly`, constant arrays use `readonly T[]`
- [x] 7.4 Audit exhaustive pattern matching — confirm all switch statements on `HookStage` (and any other union types) include `never` default case
- [x] 7.5 Audit input validation typing — confirm `c.req.json()` results typed as `unknown` with validation before use; no `as KnownType` on external data without prior checks
- [x] 7.6 Audit secure error handling — confirm all catch blocks type error as `unknown`, narrow via `instanceof Error` before accessing `.message`/`.stack`

## 8. Verification

- [x] 8.1 Run `deno check writer/` — full type-check of all source and test files passes with zero errors
- [x] 8.2 Run `deno test --allow-read --allow-write --allow-env --allow-net writer/` — all existing tests pass, no regressions
- [x] 8.3 Verify no `.js` source or test files remain under `writer/` (only `.ts` files)
- [x] 8.4 Verify reader tests still pass: `deno test --allow-read --allow-write --allow-env --allow-net reader/js/`
- [x] 8.5 Spot-check that `writer/types.ts` exports match the spec: `AppConfig`, `AppDeps`, `SafePathFn`, `PluginManifest`, `PluginParameter`, `PromptFragment`, `PluginModule`, `HookStage`, `HookHandler`, `HookContext`, `StoryEngine`, `TemplateEngine`, `BuildPromptResult`, `BuildPromptFn`, `RenderResult`, `OpenRouterStreamChunk`, `ProblemDetail`, `VentoError`
- [x] 8.6 Commit all changes atomically with message `feat(writer): migrate backend to TypeScript`

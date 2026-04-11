## Context

The writer backend (`writer/`) is 14 source files + 15 co-located test files of plain JavaScript running on Deno with Hono v4. The codebase relies on an untyped "deps bag" pattern — a single object passed from `server.js` through `createApp()` into every route registrar — and duck-typed plugin interfaces via dynamic `import()`. Deno supports TypeScript natively with zero build configuration, making migration purely a code-level concern.

Current state:
- No `compilerOptions` in `deno.json`; all config is in the root file (no `writer/deno.json`)
- Factory functions (`createStoryEngine`, `createTemplateEngine`, `createSafePath`) return anonymous object bags
- `PluginManager` validates manifests at runtime with no static schema
- `HookDispatcher` accepts arbitrary context objects per stage
- `middleware.js` uses `lengthMatch & equal` (bitwise AND on booleans) for constant-time passphrase comparison
- `ventojs` is imported from npm — type availability is uncertain

## Goals / Non-Goals

**Goals:**
- Catch type errors at compile time instead of runtime, especially around the deps bag and hook contexts
- Provide self-documenting interfaces for the plugin host contract (`PluginManifest`, `PluginModule`, `HookContext`)
- Enable strict mode (`strict: true`) from day one — no gradual loosening
- Keep the migration atomic and non-breaking: identical API surface, identical plugin contract
- Ensure `deno check writer/` passes cleanly as a CI gate

**Non-Goals:**
- Migrating plugins to TypeScript — plugins remain JavaScript; only the host is converted
- Introducing a build step or bundler — Deno runs `.ts` directly
- Refactoring business logic — this is a type-layer migration, not a rewrite
- Adding a separate `writer/deno.json` — configuration stays in the root `deno.json`
- Achieving zero `any` usage — `ventojs` internals and a few Deno APIs may require targeted `any` or `unknown` casts

## Decisions

### 1. TypeScript Compiler Configuration

Add `compilerOptions` to the root `deno.json`:

```jsonc
"compilerOptions": {
  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true,
  "noUncheckedIndexedAccess": true
}
```

**Rationale:** `strict: true` bundles `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, and `noImplicitThis`. Adding `noImplicitAny` explicitly documents the intent even though `strict` includes it. `noUncheckedIndexedAccess` is added because the codebase indexes arrays (chapter lists) and objects (config values) frequently — catching `undefined` at access sites prevents the class of bugs this migration targets.

**Alternative considered:** Per-file `// @ts-check` or a separate `writer/tsconfig.json`. Rejected because Deno uses root `deno.json` as the canonical config and a separate file adds unnecessary indirection.

### 2. Interface Design — Single `AppDeps` vs. Per-Route Sub-Interfaces

Define a single `AppDeps` interface and use `Pick<>` for route-specific subsets:

```typescript
export interface AppDeps {
  config: AppConfig;
  safePath: SafePathFn;
  pluginManager: PluginManager;
  hookDispatcher: HookDispatcher;
  buildPromptFromStory: BuildPromptFn;
  verifyPassphrase: MiddlewareHandler;
}

// Route registrars type only what they destructure:
export function registerChatRoutes(
  app: Hono,
  deps: Pick<AppDeps, "safePath" | "hookDispatcher" | "buildPromptFromStory" | "config">
): void { ... }
```

**Rationale:** A single source-of-truth interface prevents drift between `server.ts` (construction site) and routes (consumption sites). `Pick<>` narrows each route's view without duplicating definitions and makes dependency requirements explicit in the function signature.

**Alternative considered:** Fully separate per-route interfaces (`ChatDeps`, `StoriesDeps`). Rejected because it duplicates field definitions and requires manual synchronization when deps change.

### 3. Type Definition Locations

Create a single `writer/types.ts` file for shared interfaces. Module-private types stay in their defining file.

**Shared (in `types.ts`):** `AppDeps`, `AppConfig`, `PluginManifest`, `PromptFragment`, `PluginParameter`, `PluginModule`, `HookStage`, `HookHandler`, `HookContext` union, stage-specific context interfaces, `StoryEngine`, `TemplateEngine`, `BuildPromptResult`, `OpenRouterStreamChunk`, `SafePathFn`, `ProblemDetail`, `VentoError`.

**Co-located (in defining module):** `RateLimiterOptions` in `app.ts`, internal `PluginEntry` in `plugin-manager.ts`, `TemplateValidationResult` in `template.ts`.

**Rationale:** Shared types are imported by 5+ files — scattering them creates circular import risk and makes the type vocabulary hard to discover. A single `types.ts` is the idiomatic Deno/TS pattern for this scale. Co-located types keep implementation details private.

**Alternative considered:** Barrel re-exports from each module. Rejected because it adds indirection without benefit at this codebase size.

### 4. Migration Order — Atomic (All-at-Once)

Rename and convert all 29 files in a single commit (or tightly sequenced PR).

**Rationale:** The codebase is small (14 source + 15 test files) and every file imports from every other file via `.js` extensions. An incremental approach would require maintaining mixed `.js`/`.ts` imports during the transition, which Deno handles poorly — mixed extension imports create confusing resolution behavior. A single atomic rename eliminates this entirely.

**Execution sequence within the commit:**
1. Add `compilerOptions` to `deno.json`, update task paths to `.ts`
2. Create `writer/types.ts` with all shared interfaces
3. Rename all `.js` → `.ts` files (source + tests)
4. Update all internal import paths (`.js` → `.ts`)
5. Add type annotations to all exports, apply `Pick<AppDeps, ...>` to route registrars
6. Fix the bitwise AND pattern in `middleware.ts`
7. Run `deno check writer/` and `deno test` to verify

**Alternative considered:** File-by-file migration using Deno's JS/TS interop. Rejected due to the tight coupling between all modules via the deps bag — touching one file effectively requires touching all callers.

### 5. Dynamic Plugin Imports — Typed Module Interface

Define a `PluginModule` interface and assert it at the dynamic import boundary:

```typescript
export interface PluginModule {
  register?: (hookDispatcher: HookDispatcher) => void | Promise<void>;
  default?: (hookDispatcher: HookDispatcher) => void | Promise<void>;
}

// In plugin-manager.ts:
const mod: unknown = await import("file://" + modulePath);
const pluginMod = mod as PluginModule;
const registerFn = pluginMod.register ?? pluginMod.default;
if (typeof registerFn !== "function") {
  throw new Error(`Plugin "${name}" module has no register or default export`);
}
```

**Rationale:** Dynamic `import()` returns `Promise<any>` in Deno — there is no way to statically verify a plugin's shape. The assertion + runtime guard pattern is the standard approach: the type assertion satisfies the compiler, the `typeof` check provides runtime safety. This matches the existing duck-typing logic but makes the expected contract explicit.

**Alternative considered:** Generic type parameter on `import()`. Not supported by TypeScript — `import()` always returns `any`. Also considered a validation library (e.g., Zod) but rejected as overkill for a two-field interface.

### 6. Ventojs Types

Use a manual ambient declaration file (`writer/vendor/ventojs.d.ts`) with targeted type definitions.

```typescript
declare module "ventojs" {
  export interface VentoEnvironment {
    run(template: string, data: Record<string, unknown>): Promise<{ content: string }>;
    runString(template: string, data: Record<string, unknown>): Promise<{ content: string }>;
    load(path: string): Promise<{ source: string }>;
  }
  export default function vento(options?: Record<string, unknown>): VentoEnvironment;
}
```

**Rationale:** `ventojs` is an npm package without bundled TypeScript types and no `@types/ventojs` exists on DefinitelyTyped. A manual declaration file scoped to the methods actually used (3 methods) is minimal and maintainable. The declaration file is placed under `writer/vendor/` to signal it is a local shim, not upstream.

**Alternative considered:** Using `// @ts-ignore` or `as any` at every ventojs call site. Rejected because it defeats the purpose of the migration. Also considered contributing types upstream — worthwhile long-term but blocks the migration on an external dependency.

### 7. Bitwise AND Pattern in Timing-Safe Comparison

Replace the bitwise AND on booleans with `Number()` coercion for explicit intent:

```typescript
const lengthMatch = expectedBuf.length === providedBuf.length;
const safeBuf = lengthMatch ? providedBuf : new Uint8Array(expectedBuf.length);
const equal = timingSafeEqual(expectedBuf, safeBuf);

// Explicit numeric coercion — both operands always evaluated
const match = (Number(lengthMatch) & Number(equal)) === 1;
```

**Rationale:** TypeScript's strict mode flags `boolean & boolean` as a type error because bitwise AND expects `number` operands. The `Number()` coercion preserves the constant-time property (no short-circuit) while making the intent explicit and satisfying the type checker. The `=== 1` comparison produces a proper `boolean`.

**Alternative considered:** `lengthMatch && equal` (logical AND). Rejected because `&&` short-circuits — if `lengthMatch` is `false`, `equal` is never evaluated, leaking timing information about whether the lengths matched. The whole point of the bitwise pattern is to avoid this.

### 8. Test Migration Strategy

Tests are renamed alongside their source files (`.js` → `.ts`) in the same commit. Key typing considerations:

- **Mock objects** must satisfy the interfaces they stand in for. Use `Partial<AppDeps>` with `as AppDeps` for test-specific subsets where not all fields are needed.
- **Hono test requests** (`app.fetch(new Request(...))`) continue to work identically — `Request`/`Response` are standard Web API types already typed.
- **Stubs** from `@std/testing/mock` are generic and work with typed functions. The `stub()` call gains type safety automatically when the target method is typed.
- **No new test dependencies** — `@std/assert` and `@std/testing` are already TypeScript-native.

The `deno.json` test tasks update from `writer/` (which finds `_test.js`) to the same `writer/` path (which will find `_test.ts`). No glob changes needed — Deno discovers `_test.ts` files automatically.

## Risks / Trade-offs

**[Risk] Ventojs types drift from actual API** → The ambient declaration covers only 3 methods. Pin `ventojs` version in `deno.json` (already `^2.3.1`) and add a comment in the declaration file referencing the version. Update declarations when upgrading ventojs.

**[Risk] `any` leakage through plugin dynamic imports** → The `import()` boundary is inherently `any`. Mitigated by the runtime `typeof` guard and explicit `PluginModule` assertion. Enforce a lint rule (`no-explicit-any`) with an allow-list limited to the single import site in `plugin-manager.ts`.

**[Risk] Atomic migration creates a large diff** → ~29 file renames + type annotations in a single PR. Mitigated by the fact that renames are mechanical (tool-assisted) and type annotations are additive. Review can focus on `types.ts` and the handful of behavioral changes (bitwise fix, import paths). The diff is large but low-risk per line.

**[Risk] `noUncheckedIndexedAccess` causes excessive null checks** → Array/object indexing returns `T | undefined`, requiring guards at every access. This is intentional — the codebase already has several unguarded array accesses (chapter loading, config lookups) that silently produce `undefined`. If the noise becomes excessive in specific hot paths, targeted `!` assertions with explanatory comments are acceptable.

**[Trade-off] Single `types.ts` vs. distributed types** → Centralizing types in one file trades locality for discoverability. At 14 source files this is a net win, but may need splitting if the codebase grows significantly (e.g., 30+ source files).

**[Trade-off] `Pick<AppDeps, ...>` verbosity** → Route signatures become longer but self-documenting. The alternative (accepting full `AppDeps` everywhere) hides actual dependencies and makes testing harder. The verbosity is acceptable.

# TypeScript Security

## Purpose

Type-level security patterns for the writer backend, leveraging TypeScript's type system to prevent common security vulnerabilities at compile time.

## Requirements

### Requirement: Strict null safety

All nullable values SHALL be explicitly typed with union types (e.g., `string | null`). Optional chaining (`?.`) and nullish coalescing (`??`) SHALL be preferred over loose truthy checks for handling nullable values. The `strictNullChecks` compiler option SHALL be enabled to enforce null safety at compile time.

#### Scenario: Nullable return type is explicit
- **WHEN** a function may return `null` or `undefined`
- **THEN** its return type annotation SHALL explicitly include the nullable variant (e.g., `string | null`)

#### Scenario: Optional chaining replaces truthy checks
- **WHEN** code accesses a property on a potentially nullable object
- **THEN** the code SHALL use optional chaining (`obj?.prop`) or nullish coalescing (`value ?? default`) instead of loose truthy checks (`if (obj)`)

#### Scenario: Null check prevents runtime error
- **WHEN** a function receives a parameter typed as `T | null`
- **THEN** the TypeScript compiler SHALL require a null check before the value is used as `T`

### Requirement: No any escape hatches

The `any` type SHALL NOT be used in production code under `writer/`. The `unknown` type SHALL be used for values of unknown type, with type narrowing via type guards before use. Type assertions to `any` (e.g., `value as any`) SHALL NOT appear in production code.

#### Scenario: Production code has no any type
- **WHEN** `deno check` is run with `noImplicitAny: true`
- **THEN** no implicit or explicit `any` types SHALL exist in production files under `writer/`

#### Scenario: Unknown values require narrowing
- **WHEN** a value typed as `unknown` is used
- **THEN** a type guard or `instanceof` check SHALL precede any property access or method call on that value

### Requirement: Readonly immutability

Configuration objects and constants SHALL use `readonly` modifiers or `Readonly<T>` utility type to prevent accidental mutation. Arrays that should not be mutated SHALL use `readonly T[]` or `ReadonlyArray<T>`.

#### Scenario: Configuration object is readonly
- **WHEN** the application configuration object is created (e.g., from environment variables)
- **THEN** its type SHALL use `Readonly<T>` or `readonly` property modifiers so that properties cannot be reassigned after initialization

#### Scenario: Immutable arrays prevent mutation
- **WHEN** an array is declared as a constant that should not change (e.g., a list of valid hook stages)
- **THEN** its type SHALL be `readonly string[]` or `ReadonlyArray<string>` so that `.push()`, `.pop()`, and index assignment produce compile-time errors

### Requirement: Exhaustive pattern matching

Switch statements on union types SHALL include exhaustive checks using the `never` type in the default case to catch missing variants at compile time. This ensures that adding a new variant to a union type forces updates at all switch sites.

#### Scenario: Switch on HookStage is exhaustive
- **WHEN** a switch statement handles all cases of the `HookStage` union type
- **THEN** the default case SHALL assign the switch value to a variable typed as `never`, ensuring a compile-time error if a new stage is added without updating the switch

#### Scenario: Missing case produces compile error
- **WHEN** a new variant is added to a union type and an existing switch statement does not handle it
- **THEN** the `never` assignment in the default case SHALL produce a TypeScript compile-time error indicating the unhandled variant

### Requirement: Input validation typing

Request body types SHALL NOT be trusted from `c.req.json()`. External input SHALL be validated and narrowed to known types before use. Type assertion (`as`) SHALL NOT be used on external data without prior validation.

#### Scenario: Request body is validated before use
- **WHEN** a route handler calls `c.req.json()` to obtain the request body
- **THEN** the result SHALL be typed as `unknown` and validated through explicit property checks or a validation function before being used as a known type

#### Scenario: Type assertion is not used on external data
- **WHEN** data originates from an external source (HTTP request, file read, environment variable)
- **THEN** the code SHALL NOT use `as KnownType` to assert its type without first validating the data structure

### Requirement: Secure error handling

Error objects caught in catch blocks SHALL be typed as `unknown` and narrowed via `instanceof` checks before property access. Direct property access on caught errors without type narrowing SHALL NOT occur.

#### Scenario: Catch block types error as unknown
- **WHEN** a try/catch block catches an error
- **THEN** the caught value SHALL be typed as `unknown` (TypeScript default) and SHALL NOT be typed as `Error` or `any` in the catch clause

#### Scenario: Error properties accessed after narrowing
- **WHEN** code needs to access `.message` or `.stack` on a caught error
- **THEN** the code SHALL first check `instanceof Error` (or an equivalent type guard) before accessing those properties

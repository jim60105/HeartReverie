## ADDED Requirements

### Requirement: Single frontend ApiError structured error for problem details

The frontend SHALL define a single structured error class `ApiError extends Error` (in `reader-src/src/lib/api.ts`, or `reader-src/src/lib/errors.ts` if that is the better home) representing an RFC 9457 Problem Details response. `ApiError` SHALL carry:

- `message: string` — the human-readable string, computed **detail-first** and byte-identical to the prior `apiFetch` throw logic (`detail ?? errorMessage ?? (res.statusText || \`Request failed: ${url}\`)`).
- `status: number` — the HTTP status code.
- `type?: string` — the problem `type` slug, when present in the body.
- `title?: string` — the problem `title`, when present in the body.
- `body?: unknown` — the raw parsed JSON body, when the response body parsed as JSON.

The shared `apiFetch` SHALL throw `ApiError` on non-2xx responses when `throwOnError` is enabled (its default), parsing `type` / `title` / `status` / `body` alongside `detail`. The `message` value SHALL be unchanged from the prior implementation so existing consumers that match on `err.message` continue to work without edits.

#### Scenario: Problem body yields a populated ApiError

- **WHEN** `apiFetch` receives a non-2xx response whose JSON body is `{ type, title, detail }`
- **THEN** it SHALL throw an `ApiError` whose `status` equals the response status, `type` equals the body `type`, `title` equals the body `title`, and `message` equals the body `detail`

#### Scenario: Non-JSON body yields a fallback-message ApiError

- **WHEN** `apiFetch` receives a non-2xx response whose body is not valid JSON
- **THEN** it SHALL throw an `ApiError` whose `message` is the existing fallback string and whose `type` is `undefined`

#### Scenario: message byte-compatibility preserved

- **WHEN** any non-2xx response is thrown as an `ApiError`
- **THEN** `ApiError.message` SHALL equal the exact human string the prior `apiFetch` would have thrown, so message-matching catch sites elsewhere keep working without edits

### Requirement: Redundant frontend problem-details parsers are eliminated

The frontend SHALL have exactly one problem-details parser — the `ApiError` construction inside `apiFetch`. The previously-duplicated parsers SHALL be removed: `template-api.ts`'s `parseError` helper SHALL be deleted, and `useChatApi.runPluginPrompt`'s inline `!res.ok` body parser (the `problemType` block) SHALL be removed. No frontend code SHALL hand-parse an RFC 9457 response body outside `apiFetch`.

#### Scenario: parseError is gone

- **WHEN** `reader-src/src/lib/` is searched for `parseError`
- **THEN** no matches SHALL be returned

#### Scenario: runPluginPrompt no longer hand-parses problem bodies

- **WHEN** `reader-src/src/composables/useChatApi.ts` is searched for `problemType`
- **THEN** no matches SHALL be returned

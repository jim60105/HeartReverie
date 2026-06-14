## ADDED Requirements

### Requirement: runPluginPrompt derives its error code from ApiError.type

`reader-src/src/composables/useChatApi.ts::runPluginPrompt`'s HTTP fallback SHALL NOT hand-parse RFC 9457 problem-details response bodies with a bespoke `!res.ok` block. It SHALL use the default-throwing `apiFetch`/`apiFetchJson` and, in its catch, derive the rethrown error's `code` property from `ApiError.type`. The rethrown shape SHALL remain `Error & { code?: string }` so cross-repo plugin handlers that branch on `err.code` continue to work unchanged. On catching an `ApiError`, the function SHALL set the reactive `errorMessage` to the **same human string the prior hand-parser produced** — `detail ?? title ?? \`HTTP <status>\``, where `detail`/`title` are read from `ApiError.body` / `ApiError.title`. This is byte-identical to the previous behavior (which fell back to `HTTP <status>` rather than `res.statusText` when the body carried no human-readable detail), so the displayed message does not change.

#### Scenario: code slug sourced from ApiError.type

- **WHEN** `runPluginPrompt`'s HTTP fallback catches an `ApiError` carrying a `type` slug
- **THEN** it SHALL rethrow an `Error & { code }` whose `code` equals `ApiError.type`, preserving the cross-repo plugin error contract

#### Scenario: errorMessage preserves the prior detail-first wording

- **WHEN** `runPluginPrompt`'s HTTP fallback catches an `ApiError`
- **THEN** it SHALL set the reactive `errorMessage` to `detail ?? title ?? \`HTTP <status>\`` (read from `ApiError.body`/`ApiError.title`/`ApiError.status`) before rethrowing — byte-identical to the prior hand-parser's displayed message

#### Scenario: Error-and-code rethrow contract preserved

- **WHEN** a plugin handler awaits `runPluginPrompt` and the request fails with a known problem `type`
- **THEN** the rejected error SHALL still expose that slug on its `code` property, unchanged from before this refactor

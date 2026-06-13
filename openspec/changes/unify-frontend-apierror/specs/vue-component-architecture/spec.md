## ADDED Requirements

### Requirement: runPluginPrompt derives its error code from ApiError.type

`reader-src/src/composables/useChatApi.ts::runPluginPrompt`'s HTTP fallback SHALL NOT hand-parse RFC 9457 problem-details response bodies. It SHALL use the default-throwing `apiFetch` and, in its catch, derive the rethrown error's `code` property from `ApiError.type`. The rethrown shape SHALL remain `Error & { code?: string }` so cross-repo plugin handlers that branch on `err.code` continue to work unchanged. On catching an `ApiError`, the function SHALL also set the reactive `errorMessage` to `ApiError.message`, matching the prior behavior.

#### Scenario: code slug sourced from ApiError.type

- **WHEN** `runPluginPrompt`'s HTTP fallback catches an `ApiError` carrying a `type` slug
- **THEN** it SHALL rethrow an `Error & { code }` whose `code` equals `ApiError.type`, preserving the cross-repo plugin error contract

#### Scenario: errorMessage set from ApiError.message

- **WHEN** `runPluginPrompt`'s HTTP fallback catches an `ApiError`
- **THEN** it SHALL set the reactive `errorMessage` to `ApiError.message` before rethrowing

#### Scenario: Error-and-code rethrow contract preserved

- **WHEN** a plugin handler awaits `runPluginPrompt` and the request fails with a known problem `type`
- **THEN** the rejected error SHALL still expose that slug on its `code` property, unchanged from before this refactor

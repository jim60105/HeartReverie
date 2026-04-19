## ADDED Requirements

### Requirement: Frontend test expansion SHALL target uncovered reader flows
Frontend test work for this change SHALL add or extend tests in `reader-src/src/**/__tests__/` to cover under-tested component, composable, and parser flows that contribute to line-coverage gaps.

#### Scenario: New frontend test file added for uncovered flow
- **WHEN** a reader component/composable behavior required by existing OpenSpec capabilities has no direct tests
- **THEN** a new `.test.ts` file SHALL be added in the relevant `__tests__/` directory

#### Scenario: Existing frontend test covers branch behavior
- **WHEN** a frontend function has untested branch logic (e.g., fallback, validation, empty-state handling)
- **THEN** tests SHALL add branch-specific assertions that verify the expected output or emitted state

### Requirement: Frontend coverage tests SHALL be spec-scenario driven
New frontend test cases SHALL be designed from OpenSpec scenario expectations for UI behavior, data handling, and integration boundaries.

#### Scenario: Frontend test traces to OpenSpec scenario
- **WHEN** a frontend test is added for coverage improvement
- **THEN** its setup and assertions SHALL correspond to a relevant OpenSpec `WHEN/THEN` scenario

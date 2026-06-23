## ADDED Requirements

### Requirement: Plugin run-prompt insert write mode

The `POST /api/plugins/:pluginName/run-prompt` route SHALL support a fourth write mode selected by an optional boolean request field `insert` (default `false`), in addition to the existing `append` / `replace` / `discard` modes. The full normative behaviour of the insert mode — request contract, mutual-exclusion rules, JSON insertion-envelope parsing, paragraph-addressed atomic splice, `post-response` dispatch, result fields, generation-lock handling, and error slugs (`plugin-action:invalid-insert-combo`, `plugin-action:invalid-insert-payload`, `plugin-action:insert-paragraph-out-of-range`, reused `plugin-action:no-chapter` and `plugin-action:concurrent-generation`) — is defined in capability `chapter-paragraph-insertion`.

The route SHALL compute the discriminated `writeMode` as `{ kind: "insert-into-chapter", pluginName }` when `insert: true`, and SHALL pass it to the shared `streamLlmAndPersist` helper. The `WriteMode` type SHALL gain the `"insert-into-chapter"` discriminant.

The route SHALL inject the reserved `numbered_paragraphs` Vento variable (capability `numbered-paragraph-variable`) when, and only when, `insert: true`; it SHALL be the empty string otherwise. `numbered_paragraphs` SHALL be added to the reserved variable-name set so an `extraVariables.numbered_paragraphs` is rejected with `plugin-action:extra-variables-collision`.

The `plugin-action:done` WebSocket envelope and the HTTP JSON response body SHALL be extended with `chapterInserted: boolean` and `insertedCount: number` fields, populated per capability `chapter-paragraph-insertion`. These fields SHALL be present (with `false` / `0`) for non-insert modes so the envelope shape is uniform.

#### Scenario: insert request drives the insert write mode

- **WHEN** the action bar dispatches a run-prompt request with `insert: true` for a plugin against a story whose latest chapter has numbered paragraphs, and the LLM returns a valid insertion envelope
- **THEN** the route SHALL build `writeMode = { kind: "insert-into-chapter", pluginName }`, render the prompt with a populated `numbered_paragraphs`, stream the response, splice the insertions atomically, dispatch `post-response` with the full post-insert chapter, and return `{ content, usage, chapterUpdated: true, chapterReplaced: false, chapterInserted: true, insertedCount: <n>, appendedTag: null }`

#### Scenario: non-insert modes carry the new fields as defaults

- **WHEN** an `append`, `replace`, or `discard` run completes
- **THEN** the result envelope SHALL include `chapterInserted: false` and `insertedCount: 0` alongside the previously specified fields

#### Scenario: numbered_paragraphs injected only for insert

- **WHEN** an `insert: true` run renders its prompt
- **THEN** `numbered_paragraphs` SHALL be a non-empty string for a chapter with at least one paragraph
- **AND** for an `append`/`replace`/`discard` run `numbered_paragraphs` SHALL be the empty string

### Requirement: Frontend runPluginPrompt insert option

The frontend `runPluginPrompt(pluginName, promptFile, opts?)` helper SHALL accept an optional `opts.insert` boolean (default `false`). When `insert: true` the helper SHALL forward `insert: true` on both the WebSocket `plugin-action:run` envelope and the HTTP request body, and SHALL preserve structural typing so plugin authors get autocomplete on `insert` alongside `append` / `appendTag` / `replace` / `extraVariables`. `insert` SHALL be mutually exclusive with `append` and `replace` in the typed options; the helper SHALL forward the flags as supplied and rely on the backend to reject invalid combinations (surfacing `plugin-action:invalid-insert-combo` via `errorMessage` and a rejected promise without mutating local chapter state).

The helper's resolved result SHALL include the `chapterInserted` boolean and `insertedCount` returned by the server. When a `runPluginPrompt(..., { insert: true })` call resolves with `chapterInserted: true`, callers (e.g. `usePluginActions` / the action-button click context) SHALL be able to trigger a chapter reload via the existing chapter-fetch pathway so the rendered DOM picks up the spliced content. The helper SHALL surface `plugin-action:invalid-insert-payload` and `plugin-action:insert-paragraph-out-of-range` errors via `errorMessage` and a rejected promise.

#### Scenario: insert option forwarded over WebSocket

- **WHEN** `runPluginPrompt("image-design.md", { insert: true })` is called with an active WebSocket
- **THEN** the `plugin-action:run` envelope SHALL include `insert: true` and SHALL NOT include `append`, `replace`, or `appendTag`

#### Scenario: insert option forwarded over HTTP fallback

- **WHEN** `runPluginPrompt("image-design.md", { insert: true })` is called with no active WebSocket
- **THEN** the HTTP `POST /api/plugins/:pluginName/run-prompt` body SHALL include `insert: true` and SHALL NOT include `append`, `replace`, or `appendTag`

#### Scenario: insert result exposes chapterInserted

- **WHEN** an insert run resolves successfully with two insertions
- **THEN** the helper's resolved value SHALL include `chapterInserted: true` and `insertedCount: 2`

#### Scenario: invalid insert payload surfaces an error

- **WHEN** the backend rejects the run with `plugin-action:invalid-insert-payload`
- **THEN** the helper SHALL reject its promise and set `errorMessage` without mutating any local chapter state

## MODIFIED Requirements

### Requirement: Dynamic template variable collection from plugins

The `PluginManager` SHALL support collecting dynamic template variables from plugin backend modules. Plugin modules MAY export a `getDynamicVariables(context)` function. During template rendering, the `PluginManager` SHALL call each module's `getDynamicVariables` with a `DynamicVariableContext` object and merge the returned `Record<string, unknown>` into the Vento template context.

The `DynamicVariableContext` SHALL include the following read-only fields, all derived from data already materialized by `buildPromptFromStory()` in `writer/lib/story.ts`:

- `series: string` — the series identifier for the current request.
- `name: string` — the story identifier for the current request.
- `storyDir: string` — the absolute path to the story directory on disk.
- `userInput: string` — the raw user message that triggered this prompt build (the `message` argument of `buildPromptFromStory`); the empty string when the caller is the preview route and no message was supplied.
- `chapterNumber: number` — the 1-based number of the chapter that a subsequent write would target, computed by the shared `resolveTargetChapterNumber()` helper using the "reuse the last empty chapter file, otherwise use max(existing) + 1" rule; `1` when the story directory has no chapter files.
- `previousContent: string` — the unstripped content of the chapter immediately preceding `chapterNumber`; the empty string when no such chapter exists.
- `isFirstRound: boolean` — `true` when every existing chapter on disk is blank (matches the existing `isFirstRound` value already computed in `buildPromptFromStory`).
- `chapterCount: number` — the total number of `NNN.md` chapter files on disk, including any empty trailing file.

The context SHALL be a plain serializable object: it SHALL NOT contain functions, file handles, streams, API keys, or `AppConfig`.

The collision policy is unchanged: variables whose names collide with `#CORE_TEMPLATE_VARS` (`previous_context`, `user_input`, `isFirstRound`, `series_name`, `story_name`, `plugin_fragments`) are rejected with a warning, and for inter-plugin collisions the first-loaded plugin's value wins.

#### Scenario: Plugin provides dynamic variables with rich context
- **WHEN** a plugin backend module exports `getDynamicVariables`
- **AND** `renderSystemPrompt()` is called for series "fantasy" and story "quest" with user input "enter the cave" during a turn where three chapters already exist (the third being empty)
- **THEN** `PluginManager.getDynamicVariables()` SHALL invoke the module with `{ series: "fantasy", name: "quest", storyDir, userInput: "enter the cave", chapterNumber: 3, previousContent: <content of chapter 2>, isFirstRound: false, chapterCount: 3 }`
- **AND** the returned variables SHALL be merged into the Vento template context

#### Scenario: First-round request with no chapters on disk
- **WHEN** a plugin's `getDynamicVariables` is invoked for a brand-new story whose directory contains no `NNN.md` files
- **THEN** the context SHALL be `{ ..., chapterNumber: 1, previousContent: "", isFirstRound: true, chapterCount: 0 }`

#### Scenario: Request targeting a new chapter after completed ones
- **WHEN** a plugin's `getDynamicVariables` is invoked and the story directory contains `001.md` and `002.md`, both non-empty
- **THEN** the context SHALL include `chapterNumber: 3`, `previousContent` equal to the full content of `002.md`, and `chapterCount: 2`

#### Scenario: Request reusing a trailing empty chapter file
- **WHEN** a plugin's `getDynamicVariables` is invoked and the story directory contains `001.md` (non-empty) and `002.md` (empty)
- **THEN** the context SHALL include `chapterNumber: 2`, `previousContent` equal to the content of `001.md`, and `chapterCount: 2`

#### Scenario: Plugin getDynamicVariables throws
- **WHEN** a plugin's `getDynamicVariables` throws an error
- **THEN** `PluginManager` SHALL log a warning and skip that plugin's variables without aborting the render

#### Scenario: No plugins export getDynamicVariables
- **WHEN** no loaded plugins export `getDynamicVariables`
- **THEN** `PluginManager.getDynamicVariables()` SHALL return an empty object and template rendering SHALL proceed normally

#### Scenario: Multiple plugins provide dynamic variables
- **WHEN** two or more plugins export `getDynamicVariables` returning overlapping variable names
- **THEN** the first-loaded plugin's value SHALL be kept for the conflicting key
- **AND** a warning SHALL be logged for the conflict

#### Scenario: Context excludes infrastructure objects
- **WHEN** a plugin's `getDynamicVariables` is invoked
- **THEN** the context object SHALL contain only the eight documented string/number/boolean fields
- **AND** it SHALL NOT expose `AppConfig`, environment variables, `AbortSignal`, the Hono `Context`, file handles, or any function reference

### Requirement: PluginModule interface update

The `PluginModule` interface in `writer/types.ts` SHALL declare `getDynamicVariables` using the widened `DynamicVariableContext`.

#### Scenario: PluginModule with getDynamicVariables uses rich context
- **WHEN** `writer/types.ts` is examined
- **THEN** `PluginModule` SHALL include `getDynamicVariables?: (context: DynamicVariableContext) => Promise<Record<string, unknown>> | Record<string, unknown>`
- **AND** `DynamicVariableContext` SHALL include the fields `series`, `name`, `storyDir`, `userInput`, `chapterNumber`, `previousContent`, `isFirstRound`, and `chapterCount`

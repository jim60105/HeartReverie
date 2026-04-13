# Design: Prompt Template Variables

## Context

The writer-backend (`writer/server.js`) currently constructs the LLM messages array through a mix of hardcoded JavaScript logic and Vento-rendered templates. The system prompt is rendered via `renderSystemPrompt()` using a single `scenario` variable, but the remaining prompt structure — `<previous_context>` chapter wrapping, `<inputs>` user message wrapping, `<start_hints>` conditional insertion, `<status_current_variable>` status injection, and the `after_user_message.md` append — is all assembled in imperative code within the chat endpoint handler.

This scatters prompt authoring across two template files and ~30 lines of JavaScript. Prompt engineers must modify server code to change the layout, ordering, or XML tag structure of the prompt. The `after_user_message.md` template is rendered separately and appended as its own system message, further fragmenting control.

**Stakeholders**: Prompt engineers who iterate on prompt structure; the developer maintaining `server.js`.

**Constraints**:
- The REST API contract (`POST /api/stories/:series/:name/chat`) must remain unchanged from the client's perspective (same request/response shape).
- The Vento template engine (`ventojs`) is already a dependency and handles template rendering.
- The `stripPromptTags()` function must continue to strip `<options>`, `<disclaimer>`, and `<user_message>` tags before chapter content is exposed.
- Sub-templates (`Threshold-Lord_start.md`, `de-robotization.md`, `writestyle.md`, `status.md`, `options.md`, etc.) remain as Vento includes managed within the prompt templates.

## Goals / Non-Goals

### Goals

1. **All prompt-structural elements as template variables** — `previous_context`, `user_input`, `status`, and `isFirstRound` become first-class Vento variables alongside `scenario`, giving the template full control over XML tag wrapping, ordering, and conditional rendering.
2. **Single template surface** — Merge `after_user_message.md` content into `system.md` so prompt engineers have one file that defines the entire system prompt.
3. **Simplified messages array** — Reduce the server-side messages construction to `[system, user]`, removing all prompt-layout logic from JavaScript.
4. **Documentation** — Create `docs/` documentation in Traditional Chinese (正體中文) describing the template system, available variables, and the prompt construction pipeline.

### Non-Goals

- Changing OpenRouter API parameters (temperature, penalties, etc.) — out of scope.
- Adding new prompt variables beyond the ones listed (e.g., model name, chapter count) — defer to future work.
- Changing the REST API request/response contract — clients are unaffected.
- Refactoring sub-template organization (the `Threshold-Lord_start.md`, `status.md`, etc. include structure stays as-is).
- Supporting per-series or per-story template overrides — the single `playground/prompts/system.md` template continues to serve all series.

## Decisions

### Decision 1: Collapse the messages array to `[system, user]`

**Choice**: The rendered system prompt template contains everything — system instructions, previous context chapters, status, after-user-message directives. The messages array becomes:

```js
const messages = [
  { role: "system", content: renderedSystemPrompt },
  { role: "user", content: message },
];
```

**Rationale**: The user's explicit request is to make `previous_context`, `status`, etc. into template variables "just like the `scenario` variable." This means the template controls the full layout. Embedding chapter content and status within the system prompt gives the template author complete control over ordering, tag structure, and conditional logic.

**Alternative considered — Keep multi-message structure, template per role**: We could keep assistant messages for chapters and separate system messages for status/after-user-message, while still using templates for each. This preserves the LLM's role-based message semantics but defeats the purpose: the template author would still not control the overall prompt layout, and chapter ordering/wrapping would remain in JavaScript. The user explicitly wants a single template surface.

**Alternative considered — Hybrid approach with `previous_context` as assistant messages**: We could pass all other variables to the template but keep chapters as separate assistant messages. This preserves the conversational turn structure that some models benefit from. However, this contradicts the user's design intent and still requires JavaScript to build the assistant message list. The template cannot control chapter presentation format.

**Why this is acceptable**: Modern LLMs (particularly DeepSeek, the default model) handle long system prompts well. The `<previous_context>` XML tags already provide clear structural delineation within the prompt. Moving chapters from assistant-role messages into the system prompt changes the semantic framing but does not degrade quality — the XML tags serve the same structural purpose as role boundaries.

### Decision 2: Pass `previous_context` as a pre-processed array of strings

**Choice**: The `previous_context` variable is an array of strings where each element is a chapter's content already processed through `stripPromptTags()`. The template iterates over this array using Vento's `{{ for }}` syntax.

```
{{ for chapter of previous_context }}
<previous_context>{{ chapter }}</previous_context>
{{ /for }}
```

**Rationale**: Passing an array (rather than a pre-concatenated string) gives the template author control over per-chapter wrapping, separators, and formatting. The `stripPromptTags()` processing happens server-side before the variable is passed, maintaining the separation between security-relevant tag stripping (code concern) and prompt layout (template concern).

**Alternative considered — Pass raw chapter objects**: We could pass `{ number, content }` objects and let the template call `stripPromptTags`. However, `stripPromptTags` is a security-adjacent function (it removes injected content) and should remain in server code, not be exposed as a template filter.

**Alternative considered — Pass a single concatenated string**: This would simplify the template but remove per-chapter formatting control, which the current design provides via individual `<previous_context>` blocks.

### Decision 3: Move `START_HINTS` into the template via `isFirstRound`

**Choice**: The `START_HINTS` constant content moves from `server.js` into `system.md`. The template receives `isFirstRound` (boolean) and uses Vento conditional rendering:

```
{{ if isFirstRound }}
<start_hints>
...hint content...
</start_hints>
{{ /if }}
```

**Rationale**: Start hints are prompt content, not application logic. Moving them into the template consolidates all prompt text in one place. The `isFirstRound` boolean is a clean, minimal signal — the template decides what to do with it.

**Alternative considered — Keep `START_HINTS` as a variable**: We could pass the hints string as a `start_hints` variable and let the template conditionally render it. This keeps the hint text in JavaScript, which contradicts the goal of consolidating prompt content into templates. Moving the text into `system.md` is preferred.

### Decision 4: Absorb `after_user_message.md` into `system.md`

**Choice**: The content currently in `after_user_message.md` (including its Vento `set`/`include` directives for `Threshold-Lord_end`, `status`, and `options` sub-templates) is appended to the end of `system.md`. The `after_user_message.md` file is removed. The server no longer loads or processes `after_user_message.md` separately.

**Rationale**: With all variables available in `system.md`, there is no reason to maintain a separate template. A single file is easier to reason about and eliminates the implicit ordering dependency (after-user-message content must come after the user message in the old architecture, but in the new architecture the template controls everything).

**Alternative considered — Keep `after_user_message.md` as a Vento include**: We could keep the file and `{{ include }}` it from `system.md`. This preserves modularity but adds indirection. Since the file is small and tightly coupled to the prompt layout, inlining is cleaner. However, the template author can always re-extract it into a sub-template via Vento `include` if desired.

### Decision 5: Expand `renderSystemPrompt()` to accept all variables

**Choice**: The function signature changes from accepting `series` alone to accepting all data needed for template rendering:

```js
async function renderSystemPrompt(series, { previousContext, userInput, status, isFirstRound }) {
  // ... load scenario as before ...
  const result = await ventoEnv.runString(systemTemplate, {
    scenario: scenarioContent,
    previous_context: previousContext,
    user_input: userInput,
    status,
    isFirstRound,
  });
  return result.content;
}
```

**Rationale**: Keeps the rendering logic centralized in one function. The caller (chat endpoint) prepares the data and passes it in. Variable names use `snake_case` to match the existing `scenario` convention used in templates and to be XML-tag-friendly (matching `<previous_context>`, `<status_current_variable>` naming patterns). `isFirstRound` uses camelCase as it is a boolean flag, not a content variable that maps to an XML tag.

## Risks / Trade-offs

**[Risk] Loss of assistant-role semantics for chapter context** → The current architecture uses `role: "assistant"` for chapter messages, which signals to the LLM that these are its own prior outputs. Moving them into the system prompt changes this framing. **Mitigation**: The `<previous_context>` XML tags provide equivalent structural cues. The system prompt can explicitly instruct the LLM that these are prior story segments. Monitor output quality after migration; if degradation is observed, the template can be adjusted without code changes — that is the whole point of this change.

**[Risk] Larger system prompt token count** → Consolidating everything into one system message increases the system prompt size, especially with many chapters. **Mitigation**: The existing 200-chapter cap remains in effect. In practice, the total token count is unchanged — the same content is sent to the LLM, just structured differently within the messages array.

**[Risk] Template errors break the entire prompt** → With more variables and logic in the template, a Vento syntax error could produce a broken or empty system prompt. **Mitigation**: Vento throws on syntax errors, which the existing `try/catch` in the chat endpoint will catch and return as HTTP 500. Template changes can be tested by inspecting the rendered output before deploying.

**[Risk] Breaking change for existing `after_user_message.md` customizations** → Any user who has customized `after_user_message.md` will lose their changes. **Mitigation**: This is a single-user project. The migration plan below covers merging content.

**[Trade-off] Template complexity increases** — `system.md` grows from a simple layout file to a template with iteration (`for`), conditionals (`if`), and multiple variables. This is an acceptable trade-off for the gained flexibility.

## Migration Plan

### Step 1: Update `renderSystemPrompt()` in `server.js`

Expand the function to accept and pass `previous_context`, `user_input`, `status`, and `isFirstRound` as template variables alongside `scenario`.

### Step 2: Update `system.md` template

Append the content of `after_user_message.md` to the end of `system.md`. Add Vento template logic to render the new variables:
- Iterate over `previous_context` array, wrapping each chapter in `<previous_context>` tags
- Render `user_input` wrapped in `<inputs>` tags
- Conditionally render `<start_hints>` block when `isFirstRound` is true (move `START_HINTS` text from `server.js` into the template)
- Render `status` wrapped in `<status_current_variable>` tags
- Preserve all existing sub-template includes and their relative ordering

### Step 3: Simplify chat endpoint in `server.js`

- Remove `after_user_message.md` file loading
- Remove `START_HINTS` constant
- Remove hardcoded `userContent` construction (the `<inputs>`, `<start_hints>` wrapping)
- Remove the multi-message assembly; call `renderSystemPrompt()` with all variables and build `[{ role: "system", content: rendered }, { role: "user", content: message }]`
- Keep `stripPromptTags()` call when preparing the `previous_context` array

### Step 4: Remove `after_user_message.md`

Delete `playground/prompts/after_user_message.md` after its content has been merged into `system.md`.

### Step 5: Update spec

Update `openspec/specs/writer-backend/spec.md` "Prompt construction pipeline" requirement to reflect the new template-driven architecture and simplified messages array.

### Step 6: Create documentation

Add `docs/prompt-template.md` (or similar) in Traditional Chinese explaining:
- The Vento template system and syntax basics
- All available template variables and their types/contents
- The prompt construction pipeline (how `server.js` prepares data → renders template → sends to LLM)
- How to modify prompt structure by editing `system.md`

### Rollback strategy

Since this is a single-file server with git version control:
1. `git revert` the commit to restore the previous `server.js`, `system.md`, and `after_user_message.md`.
2. No database migrations or external state changes are involved.

## Open Questions

1. **Should `user_input` be rendered inside the system prompt or kept as a separate user message?** — The current design passes `user_input` as a template variable but also sends a `{ role: "user", content: message }` message. **Resolution**: The user explicitly requested `<inputs>` wrapping as a template variable. The template renders `<inputs>{{ user_input }}</inputs>` within the system prompt, while the raw message is also sent as `{ role: "user", content: message }`. This duplication is intentional — the system prompt `<inputs>` block provides contextual framing alongside other prompt elements, and the user-role message provides the standard LLM message role. The template author controls both the presence and formatting of `user_input` in the system prompt.

2. **Should `start_hints` text live in `system.md` directly or in a separate includable sub-template?** — The hints are ~8 lines of Chinese text. Inlining in `system.md` is simplest; extracting to `start_hints.md` and using `{{ include }}` is more modular. **Resolution direction**: Inline in `system.md` initially. The template author can extract it later if desired — this is a template-level decision, not a code-level one.

3. **Should the `status` variable replace the existing `status.md` sub-template include?** — Currently `after_user_message.md` includes `status.md` (which defines the status bar format instructions). The new `status` variable contains the actual story status data from YAML files. These are different: one is the format specification, the other is the data. Both should coexist — the `status.md` include provides format instructions, the `status` variable provides the current data. **Resolution direction**: Both coexist. The `status.md` sub-template include remains for format instructions. The `status` template variable provides the runtime data wrapped in `<status_current_variable>` tags by the template.

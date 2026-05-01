## Context

`writer/lib/template.ts::renderSystemPrompt()` currently uses Vento (`ventojs`) to render `playground/_prompts/system.md` into a single string. The user's live input is passed into that render as the Vento variable `{{ user_input }}` and ends up interpolated INTO the system message body (the default template wraps it as `<inputs>{{ user_input }}</inputs>`). Then `writer/lib/chat-shared.ts` constructs a hard-coded two-element `messages` array — one `system` from the rendered template AND one `user` whose content is a copy of the same `message` argument — so the user's input is duplicated across two channels and the template author has no control over its role assignment. The Vento environment also receives plugin variables and lore variables. The template is plain Vento (variables, `{{ for }}`, `{{ if }}`, pipes); user-supplied templates from the Prompt Editor pass through `validateTemplate()`'s SSTI whitelist before render.

Constraints:
- Vento plugin pattern: `env.tags.push(tagFn)`. Tags are JS-emitting functions; `env.compileTokens(tokens, target, "/closer")` compiles inner content into JS that appends to `target`. The bundled `layout`/`slot` tags (`node_modules/ventojs/plugins/layout.js`) demonstrate the canonical pattern of capturing inner content into a local string, then pushing it elsewhere.
- The OpenAI-compatible Chat Completions contract requires `messages: Array<{role: "system"|"user"|"assistant"|..., content: string}>` with at least one element. Conventions favour ending on a `user` turn for a request that is asking for an assistant response.
- AGPL-3.0 license header on every new source file; project follows the code-style rules in `AGENTS.md` (TypeScript strict, double quotes, `async/await`, `#` private fields, JSDoc on functions).
- No backward compatibility / migration is required (zero users, early-stage).
- `validateTemplate()` is the SSTI guardrail for *user-uploaded* templates. The repo-managed default `system.md` is implicitly trusted but should still parse cleanly through whatever Vento accepts.

Stakeholders: prompt engineers (the user), plugin authors, future contributors who read `system.md`, the Prompt Editor UI in `reader-src/`.

## Goals / Non-Goals

**Goals:**
- Let the rendered template control the entire upstream `messages` array (any number of `system`/`user`/`assistant` turns in any order).
- Keep the existing Vento mental model: the `message` tag is a normal Vento block tag, composes with `{{ if }}` / `{{ for }}` / variable interpolation / plugin fragments / lore variables.
- Preserve plugin compatibility — existing `prompt-assembly` fragments and `frontendStyles`/`displayStripTags` semantics are untouched. Plugins gain optional ability to wrap their fragment in `{{ message "<role>" }}` if they want a specific role.
- Preserve `validateTemplate()`'s SSTI guarantees for user-uploaded prompt overrides.
- Provide a clear, deterministic ordering rule that makes "what message ends up where" obvious from the template source.
- Surface assembly errors (invalid role, nested message, no user turn) as 422 Vento Problem-Details errors that the existing Prompt Editor error UI already handles.

**Non-Goals:**
- Renaming or removing existing template variables.
- A migration tool or shim for old single-message templates.
- A new plugin lifecycle hook for "emit a message" — plugins keep using the existing `prompt-assembly` hook and rely on the template author to wrap fragments.
- Streaming in *multiple* assistant messages from the upstream LLM (this change is about request shaping; the response remains a single streamed assistant message written into the next chapter file, unchanged).
- Function/tool calling, vision content parts, or other multi-modal `messages[]` extensions — out of scope.

## Decisions

### D1. Custom Vento tag, not template-string post-processing

We register a Vento plugin that pushes a `message` tag and a `/message` closer to `env.tags`. The tag's compiler captures inner content into a local string via `env.compileTokens(tokens, "__msg_content", "/message")`, validates the role at *render time*, pushes `{ role, content }` onto a side-channel array that lives on the data object passed to `runString`, AND emits a unique sentinel into the parent output stream so the lexical position of the block can be reconstructed.

**Why this over alternatives:**
- A regex split of the rendered string on a marker like `<role:user>` is tempting but fragile: any user content (chapters, user_input, lore passages) could contain those characters, and Vento doesn't escape them because the template is plain text.
- A two-pass parse of `system.md` (split before Vento sees it) would lose the ability to use `{{ if }}` / `{{ for }}` to *generate* messages — e.g. a few-shot loop that emits one user/assistant pair per example.
- The custom-tag approach reuses Vento's tokenizer, lets the inner content render normally with full variable access, and matches the canonical extension pattern (`layout`/`slot` ship the same way in core).

### D2. Sentinel-based ordering using `crypto.randomUUID()`

The tag emits `\u0000MSG_<nonce>_<index>\u0000` into the parent output (`output += "...";`) where `<nonce>` is a per-render UUID generated in `template.ts` and passed into the data context, `<index>` is the position in the side-channel buffer. After `runString()` returns, we split the rendered string by `/\u0000MSG_<nonce>_(\d+)\u0000/`, walking segments and matches in order. Each text segment becomes a system-role message (or coalesces with an adjacent system message); each match resolves to its captured `{role, content}` from the side-channel buffer.

**Why a nonce:** user content (chapter text, lore, the live `user_input`, plugin fragments) is interpolated as raw strings. A constant marker like `\u0000MSG_42\u0000` could in principle appear in user-typed content. UUID-per-render makes that astronomically unlikely. The NUL byte is a defensive belt-and-suspenders choice (almost never appears in legitimate prose).

**Why side-channel buffer instead of stuffing the JSON-stringified message into the rendered output:** keeps user-controlled content out of any parser path. The renderer only sees opaque sentinels; the decoded buffer is built by Vento-emitted JS from already-rendered segments.

### D3. `__messages` lives on the data object

The Vento data context (`runString`'s second argument) is what the compiled function reads via the `dataVarname` (default `it` — but in our case it's the spread root, accessed via the standard scope variable). We pass `__messages: []` and `__msgNonce: "<uuid>"` into that context; the tag's emitted JS does `${dataVarname}.__messages.push({role, content: __msg_content})` and reads the nonce the same way.

**Alternative considered:** stash the buffer on `env.utils` (a singleton on the Environment instance). Rejected because the Environment is shared across concurrent renders within the same process — concurrency would corrupt the buffer. The data object is per-render.

### D4. Role validation at render time

Inside the tag's emitted JS, after pushing, we validate `role` is one of `system`, `user`, `assistant`. If not, we `throw new Error(\`Invalid message role: \${role}\`)` so it surfaces through the existing `buildVentoError()` path with `multi-message:invalid-role`. This catches both string-literal typos (`{{ message "sytsem" }}`) and dynamic identifier roles that resolve to garbage at runtime.

### D5. Top-level content becomes one or more system messages

After splitting, contiguous text segments are coalesced into single system-role messages. A typical template that uses `{{ message }}` blocks for everything will produce no system fallback; a template that uses `{{ message "user" }}{{ user_input }}{{ /message }}` at the very end and leaves all the persona/lore at the top level will produce exactly two messages: one big `system` followed by one `user`. This makes the simplest template ergonomic AND lets advanced templates emit complex turn structures.

**Coalescing rule:** any sequence of adjacent `system` messages (after assembly) is concatenated into a single `system` message with `\n` joining. Adjacent same-role non-system messages are NOT coalesced — a template that emits `{{ message "user" }}A{{ /message }}{{ message "user" }}B{{ /message }}` gets two distinct user messages, because the author may have meant that.

### D6. Nested `{{ message }}` is rejected

The tag's body is compiled with the closer `/message`. If a nested `message` opener appears, Vento's tokenizer happily nests; we forbid it explicitly in our tag handler (track a depth counter: throw if non-zero when entering, modelled after the layout/slot pattern). Justification: nesting has no defined semantics in the OpenAI message contract, and silently flattening would surprise authors.

### D7. SSTI whitelist update

`validateTemplate()` (in `template.ts`) currently rejects everything that isn't a known safe expression. We extend its regex set to accept:
- `^message\s+"(system|user|assistant)"$` — string literal role
- `^message\s+[a-zA-Z_]\w*$` — identifier role (the validator can't statically enforce the role value, but render-time validation catches that)
- `^/message$` — closer

We deliberately do NOT permit pipes, function calls, or arbitrary expressions in the role slot, keeping the SSTI surface flat.

### D8. Drop the auto-appended user turn in `chat-shared.ts`

`buildPromptFromStory` returns `{ messages, ventoError, chapterFiles, chapters }`. `chat-shared.ts` uses `messages` directly as the upstream payload's `messages`. If `messages` does not contain at least one `role: "user"` element, we throw a `vento` `ChatError` (422) with `multi-message:no-user-message` so the Prompt Editor preview path and live chat path both surface the same error.

The live `user_input` is still passed into the Vento context (unchanged variable contract). The default `system.md` will end with `{{ message "user" }}{{ user_input }}{{ /message }}` so the simplest setup still works out of the box. Authors who want richer shaping (e.g. an artificial assistant priming turn before the user's request) can do that.

### D9. Frontend prompt-preview rendering

`reader-src/src/components/PromptPreview.vue` currently shows one rendered blob. It will receive a `messages` array, render one card per entry with a role badge. `routes/prompt.ts`'s preview response shape becomes `{ messages: ChatMessage[] }`. Frontend types update accordingly.

### D10. Default `system.md` rewrite

The repo-managed `playground/_prompts/system.md` is regenerated to use the new tag. Per AGENTS.md, files under `playground/` are user data, but the default seeded prompt is shipped as a committed file in this repo (it's in `playground/_prompts/`). We will treat the *repo-shipped baseline* as fair game to update; if the file is also user-overwritable, this is no different from any other in-repo example. We'll confirm with the project reality during implementation. **Update during implementation:** if `system.md` turns out to be a user-controlled file we should not touch, we instead put the new default in a code-shipped fallback (e.g. `writer/lib/default-system-template.ts`) that the engine uses when the playground file is absent.

## Risks / Trade-offs

- **Risk: Sentinel collision in pathological content.** → Mitigation: per-render UUID + NUL byte. The probability of UUID collision in user prose is ~1 in 2^122 per render; we accept it.
- **Risk: Nested `{{ message }}` slips past depth check if Vento changes its tokenizer.** → Mitigation: explicit unit test for nesting; covered by tests in `tests/writer/lib/vento_message_tag_test.ts`.
- **Risk: Plugin authors confused that fragments don't get an automatic role.** → Mitigation: `docs/plugin-system.md` and `docs/prompt-template.md` updates explain the convention; the default `system.md` shows how to wrap the fragments loop in a system-role block.
- **Risk: Order-of-operations changes break a plugin that relied on the rendered prompt being a single string.** → Mitigation: plugins consume the prompt via the `prompt-assembly` hook *input* (chapter list, user input) — they do not see the rendered output. The `post-response` hook receives the assistant reply, also unchanged. No plugin contract change.
- **Risk: `runString` performance regression from the additional sentinel-split pass.** → Mitigation: split is O(n) on the rendered string with a single regex; rendered prompts are <500 KB. Negligible. Token-usage logging measures wall time (existing `latencyMs`), so any regression will be visible.
- **Trade-off: Templates become slightly more verbose (most authors will wrap their template in `{{ message "system" }} … {{ /message }}{{ message "user" }}{{ user_input }}{{ /message }}`).** → Accepted: the cost is paid once per template; the gain is full conversation control.
- **Trade-off: SSTI whitelist grows by three regex entries.** → Accepted: the new entries do not permit any expression evaluation in the role slot, only literals and bare identifiers.
- **Trade-off: PromptPreview UI gains complexity (per-message cards).** → Accepted: this is also a usability improvement — authors *want* to see exactly what the LLM will see, role-tagged.

## Open Questions

- Should `playground/_prompts/system.md` be considered user data (per AGENTS.md `Important Constraints`), in which case we ship the new default at a different code-managed path and leave the existing `playground/_prompts/system.md` untouched on upgrade? **Resolution during implementation:** check the file's git history; if it's tracked in-repo, update it; if it's a user-bootstrap copy, ship the new default elsewhere and add a deprecation note in `docs/prompt-template.md`.
- Should adjacent `assistant` (or `user`) messages from the template ever be coalesced? **Decision: no** — preserve the author's intent. Document this loudly.
- Should we expose the per-render nonce or `__messages` buffer through the `RenderResult` for debug logging? **Decision: no in v1** — debug logging captures the final assembled `messages` array, which is what authors need.

## Context

The project currently has 12 built-in plugins. Three pairs of plugins are tightly coupled:

1. **apply-patches** (hook-only: runs Rust binary post-response to apply JSONPatch to YAML state) + **variable-display** (full-stack: renders `<UpdateVariable>` blocks on frontend, strips from previousContext). Both operate on the `<UpdateVariable><JSONPatch>…</JSONPatch></UpdateVariable>` pipeline — one handles backend state mutation, the other handles display and cleanup.

2. **threshold-lord** (prompt-only: injects prompt fragments instructing LLM to output `<disclaimer>` tags) + **disclaimer** (prompt-only: strips `<disclaimer>` from frontend display and previousContext). Classic producer-consumer pair where one plugin's entire purpose is consuming the other's output.

3. **user-message** plugin currently only strips `<user_message>` tags from display and previousContext, while the actual write logic (`<user_message>` block construction at chat.ts L149 and `fullContent` assembly at chat.ts L216) remains hardcoded in `chat.ts`.

The hook system defines 4 backend stages: `prompt-assembly`, `response-stream`, `post-response`, `strip-tags`. Frontend has `frontend-render` and `frontend-strip`. There is no hook stage for pre-write content injection.

## Goals / Non-Goals

**Goals:**

- Merge `apply-patches` + `variable-display` into a single `state-patches` plugin that owns the full `<UpdateVariable>` lifecycle
- Merge `disclaimer` + `threshold-lord` into a unified `threshold-lord` plugin that owns both prompt injection and tag cleanup
- Extract the `<user_message>` block construction and file prepending from `chat.ts` into the `user-message` plugin via a new `pre-write` hook stage
- Reduce total plugin count from 12 to 9 (remove 3 directories, create 1 new)
- Maintain identical runtime behavior — no observable change to LLM prompts, file output, or frontend rendering

**Non-Goals:**

- Changing the Rust `apply-patches` crate code or its CLI interface
- Modifying LLM prompt content or template structure
- Restructuring plugins that are already self-contained (e.g., `options-panel`, `context-compaction`, `status-bar`)
- Adding new user-facing features

## Decisions

### Decision 1: Merged plugin naming

**`state-patches`** for `apply-patches` + `variable-display`. The name emphasizes the unified state patch lifecycle — writing patches to YAML (backend) and rendering patch blocks (frontend). The Rust crate stays at `plugins/state-patches/rust/` (moved from `apply-patches/rust/`).

**`threshold-lord`** absorbs `disclaimer`. The `threshold-lord` name is kept because it is the primary plugin — the disclaimer strip is a secondary cleanup concern. The merged plugin gains `stripTags: ["disclaimer"]` and a `frontendModule` for stripping.

Alternative considered: naming the first merge `variable-patches` — rejected because `state-patches` better reflects the dual purpose (state mutation + variable display).

### Decision 2: New `pre-write` hook stage for user-message extraction

A new backend hook stage `pre-write` is added to the hook system. It is dispatched in `chat.ts` after the OpenRouter API response is confirmed but before writing to the chapter file. The context object includes:

```ts
{
  message: string;       // raw user input
  chapterPath: string;   // target file path
  storyDir: string;
  series: string;
  name: string;
  preContent: string;    // initially "", handlers append to this
}
```

The `user-message` plugin registers a `pre-write` handler that sets `context.preContent` to the `<user_message>` block. `chat.ts` then writes `context.preContent` (instead of a hardcoded `userBlock`) to the chapter file before streaming AI content.

Alternative considered: using `post-response` with a file write — rejected because `post-response` runs after the file is already written and closed, making prepending impossible without reopening and rewriting.

Alternative considered: using `response-stream` — rejected because user-message block must be written before any streaming begins, and this stage is for chunk transformation.

### Decision 3: Plugin type for merged `state-patches`

Type: `full-stack`. The merged plugin has a backend module (post-response hook for Rust binary), frontend module (UpdateVariable renderer), and stripTags. This matches the `full-stack` type definition.

### Decision 4: Plugin type for merged `threshold-lord`

Type: `prompt-only`. The existing `threshold-lord` and `disclaimer` are both `prompt-only`. After merging, the plugin has promptFragments and a frontendModule for stripping, plus stripTags. The `prompt-only` type is retained since the primary function is prompt injection; the frontend strip is a lightweight addition that existing `prompt-only` plugins already use (both `disclaimer` and `user-message` are `prompt-only` with `frontendModule`).

### Decision 5: Migration approach

All merges are performed as file moves and manifest edits — no new logic is introduced. The `handler.js` in `state-patches` updates the binary path to reflect the new plugin directory. Existing test files are moved to match new plugin names. Spec references are updated via delta specs.

## Risks / Trade-offs

**[Risk] External plugins depending on removed plugin names** → Mitigation: No known external plugins depend on these names. The `PLUGIN_DIR` mechanism loads external plugins independently. Document the rename in commit messages.

**[Risk] Rust binary path change in `state-patches/handler.js`** → Mitigation: The path is computed from `context.rootDir` + relative path. Updating the relative path segment from `apply-patches` to `state-patches` is a single string change. The `apply-patches/` top-level directory (containing AGENTS.md and the Rust workspace) is separate from the plugin directory and remains unchanged.

**[Risk] `pre-write` hook adds latency before file writing** → Mitigation: The `user-message` handler only constructs a string — no I/O or async work. The overhead is negligible (microseconds).

**[Risk] Forgetting to update `system.md` template variables** → Mitigation: The `threshold-lord` prompt fragment variable names (`threshold_lord_start`, `threshold_lord_end`) are unchanged since the plugin keeps its name. No template changes needed.

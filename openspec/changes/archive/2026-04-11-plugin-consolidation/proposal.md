## Why

Six built-in plugins form three tightly-coupled pairs that cannot function independently, yet they live in separate directories with separate manifests. This forces maintainers to coordinate changes across multiple plugin folders for what is logically a single feature. Additionally, the `user-message` plugin only handles tag stripping while its core write logic (`<user_message>` block construction and file prepending) remains hard-coded in `chat.ts`, breaking the principle that all XML-tag lifecycle logic should be plugin-owned.

## What Changes

- **Merge `apply-patches` + `variable-display`** into a single `state-patches` plugin. `apply-patches` runs the Rust binary post-response to mutate YAML state; `variable-display` renders `<UpdateVariable>` blocks on the frontend and strips them from `previousContext`. Both operate on the same `<UpdateVariable><JSONPatch>…</JSONPatch></UpdateVariable>` pipeline and have no reason to exist separately.
- **Merge `disclaimer` + `threshold-lord`** into a single `threshold-lord` plugin. `threshold-lord` injects the prompt that instructs the LLM to output `<disclaimer>` tags; `disclaimer` strips those tags from display and context. The `disclaimer` plugin is entirely a consumer of `threshold-lord`'s output.
- **Extract user-message write logic into the `user-message` plugin**. Move the `<user_message>` block construction (chat.ts L149) and `fullContent` assembly (chat.ts L216) into a plugin hook, so the `user-message` plugin owns the full tag lifecycle — writing, stripping from context, and stripping from display. **BREAKING**: Requires a new `pre-write` backend hook stage dispatched before chapter file writing begins.
- **Remove the now-empty original plugin directories** (`apply-patches`, `variable-display`, `disclaimer`).

## Capabilities

### New Capabilities

_None — this change reorganizes existing capabilities without introducing new ones._

### Modified Capabilities

- `plugin-hooks`: Adding `pre-write` hook stage for user-message block injection before chapter file writing
- `plugin-core`: Plugin directory restructuring (3 merges, 3 directory removals)
- `post-response-patch`: Merged into `state-patches` — Rust binary invocation now part of consolidated plugin
- `variable-display`: Merged into `state-patches` — frontend rendering and stripTags absorbed
- `vento-prompt-template`: Template variable references updated for renamed prompt fragment variables

## Impact

- **writer/routes/chat.ts**: User-message block construction and `fullContent` assembly extracted to plugin hook; new `pre-write` hook dispatch point added
- **writer/lib/hooks.ts**: New `pre-write` stage registered
- **plugins/**: 3 directories removed (`apply-patches`, `variable-display`, `disclaimer`); 2 directories restructured (`threshold-lord`, `user-message`); 1 directory created (`state-patches`)
- **system.md**: Template variable names for threshold-lord prompt fragments may change
- **Tests**: Existing plugin tests need migration to new directory structure
- **apply-patches/**: Rust crate unchanged, only the plugin wrapper moves

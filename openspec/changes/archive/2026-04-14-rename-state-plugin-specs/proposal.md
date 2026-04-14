## Why

Commit `1b0cfbae` renamed the `state-patches` plugin directory to `state` and changed the plugin name in `plugin.json` from `"state-patches"` to `"state"`. The codebase is updated, but 12 main specs and 3 spec directory names still reference the old `state-patches` plugin name and `plugins/state-patches/` directory path. These specs need to reflect the rename to stay in sync with the implementation.

Note: The Rust binary is still named `state-patches` — only the plugin name and directory changed. References to the binary name must be preserved.

## What Changes

- Rename 3 spec directories: `state-patches-tests` → `state-tests`, `state-patches-security` → `state-security`, `state-patches-modules` → `state-modules`
- Update plugin name references (`state-patches` → `state`) and directory paths (`plugins/state-patches/` → `plugins/state/`) in 11 main specs (status-bar reviewed, no changes needed — only has binary name refs)
- Preserve all references to the `state-patches` binary name (unchanged)
- Update the skill reference `manifest-schema.md` example to match the new `plugin.json` (description, section heading, and add `promptFragments` config)
- Fix stale binary path in `post-response-patch` spec: `rust/target/release/state-patches` → `state-patches` (pre-built binary at plugin root)

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `state-patches-tests`: Rename to `state-tests`; update plugin name and directory path references
- `state-patches-security`: Rename to `state-security`; update plugin name references
- `state-patches-modules`: Rename to `state-modules`; update plugin name and directory path references
- `websocket-chat-streaming`: Update plugin name references
- `plugin-hooks`: Update plugin name references
- `plugin-core`: Update plugin name and directory path references
- `vento-prompt-template`: Update plugin name references
- `post-response-patch`: Update plugin name and directory path references (preserve binary name refs)
- `containerization`: Update directory path references (preserve binary name refs)
- `gitignore-config`: Update plugin name and directory path references
- `variable-display`: Update plugin name and directory path references
- `status-bar`: No spec content changes needed (all references are to the binary name)

## Impact

- 11 main spec files under `openspec/specs/` modified
- 3 spec directory renames
- 1 skill reference file (`skills/heartreverie-create-plugin/references/manifest-schema.md`)
- Fix stale binary path in `post-response-patch` spec (pre-existing inaccuracy: was `rust/target/release/state-patches`, actual path is `state-patches` at plugin root)
- No code changes — implementation was already done in commit `1b0cfbae`

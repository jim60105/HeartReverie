## Context

Commit `1b0cfbae` renamed the `state-patches` plugin to `state` (directory and plugin.json name), added a new `state.md` prompt fragment with `promptFragments` config, and updated all codebase references. However, 12 main specs under `openspec/specs/` still reference the old plugin name and directory paths. Three spec directories are named `state-patches-*` and need renaming.

The binary file remains `state-patches` — only the plugin identity changed.

## Goals / Non-Goals

**Goals:**
- Update all 12 affected main specs to reflect the `state-patches` → `state` plugin rename
- Rename 3 spec directories (`state-patches-tests` → `state-tests`, etc.)
- Preserve all references to the `state-patches` binary name (unchanged)
- Update the skill reference file `manifest-schema.md` to match the new plugin description

**Non-Goals:**
- No code changes (implementation already complete)
- No changes to archived specs (historical records)
- No renaming of the `state-patches` Rust binary or crate

## Decisions

### Decision 1: Rename spec directories to match plugin name

Rename `state-patches-tests` → `state-tests`, `state-patches-security` → `state-security`, `state-patches-modules` → `state-modules`. This keeps spec directory names aligned with the plugin name convention.

### Decision 2: Distinguish plugin name vs binary name references

Each occurrence of `state-patches` must be classified:
- **Plugin name** (e.g., "the `state-patches` plugin") → change to `state`
- **Directory path** (e.g., `plugins/state-patches/`) → change to `plugins/state/`
- **Binary/crate name** (e.g., `state-patches` binary, `target/release/state-patches`) → preserve as-is

### Decision 3: Update skill reference example

The `manifest-schema.md` example still has the old description and section heading "No Prompt". Update to match the new `plugin.json`: description "A complete state tracking system.", section heading reflects prompt support, and add `promptFragments` config to the example.

### Decision 4: Fix stale binary path in post-response-patch spec

The existing `post-response-patch` spec references `./plugins/state-patches/rust/target/release/state-patches` as the binary path. The actual implementation uses `./plugins/state/state-patches` (pre-built binary at plugin root). Fix this pre-existing inaccuracy alongside the rename.

### Decision 5: Skip status-bar spec changes

The `status-bar` spec only references `state-patches` as a binary name, which is still correct. No changes needed.

## Risks / Trade-offs

- [Risk] Accidentally changing binary name references → Mitigation: Each spec update must carefully distinguish plugin name vs binary name contexts
- [Risk] Missing a reference → Mitigation: Use grep to verify no stale `state-patches` plugin/directory references remain after all updates

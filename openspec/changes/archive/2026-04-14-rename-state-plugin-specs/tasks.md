## 1. Rename Spec Directories

- [x] 1.1 Rename `openspec/specs/state-patches-tests/` to `openspec/specs/state-tests/` and update the spec title inside `spec.md`
- [x] 1.2 Rename `openspec/specs/state-patches-security/` to `openspec/specs/state-security/` and update the spec title inside `spec.md`
- [x] 1.3 Rename `openspec/specs/state-patches-modules/` to `openspec/specs/state-modules/` and update the spec title inside `spec.md`

## 2. Update Main Specs — Plugin Name References

- [x] 2.1 Update `openspec/specs/state-tests/spec.md`: change plugin name refs (`state-patches` plugin → `state` plugin) and directory paths (`plugins/state-patches/` → `plugins/state/`); preserve binary name `state-patches`
- [x] 2.2 Update `openspec/specs/state-security/spec.md`: change plugin name refs
- [x] 2.3 Update `openspec/specs/state-modules/spec.md`: change plugin name refs and directory paths
- [x] 2.4 Update `openspec/specs/post-response-patch/spec.md`: change plugin name refs (~6) and directory paths (~4); preserve binary name refs (~8)
- [x] 2.5 Update `openspec/specs/containerization/spec.md`: change directory paths (~18); preserve binary name refs (~10)
- [x] 2.6 Update `openspec/specs/variable-display/spec.md`: change plugin name refs and directory paths
- [x] 2.7 Update `openspec/specs/plugin-core/spec.md`: change plugin name refs and directory paths
- [x] 2.8 Update `openspec/specs/plugin-hooks/spec.md`: change plugin name ref; preserve binary name ref
- [x] 2.9 Update `openspec/specs/websocket-chat-streaming/spec.md`: change plugin name refs
- [x] 2.10 Update `openspec/specs/vento-prompt-template/spec.md`: change plugin name ref
- [x] 2.11 Update `openspec/specs/gitignore-config/spec.md`: change plugin name ref and directory paths

## 3. Update Skill Reference

- [x] 3.1 Update `skills/heartreverie-create-plugin/references/manifest-schema.md`: change the section heading from "No Prompt" to reflect prompt support, update the example description to "A complete state tracking system.", and add the `promptFragments` config to the example JSON to match the current `plugins/state/plugin.json`

## 4. Verification

- [x] 4.1 Grep all main specs for stale `plugins/state-patches/` directory paths (expect zero matches outside archived changes and binary name contexts)
- [x] 4.2 Grep all main specs for stale `"state-patches"` plugin name references (expect zero matches outside binary name contexts)
- [x] 4.3 Grep all main specs for stale `rust/target/release/state-patches` binary path references (expect zero — should all use `plugins/state/state-patches`)
- [x] 4.4 Verify `manifest-schema.md` example includes `promptFragments` config matching current plugin.json

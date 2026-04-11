## 1. Hook System: Add `pre-write` Stage

- [x] 1.1 Add `"pre-write"` to `VALID_STAGES` set and `HookStage` type in `writer/lib/hooks.ts` and `writer/types.ts`
- [x] 1.2 Write unit tests for `pre-write` hook registration and dispatch (register handler, dispatch with context including `preContent`, verify `preContent` is mutated)

## 2. Merge `apply-patches` + `variable-display` → `state-patches`

- [x] 2.1 Create `plugins/state-patches/` directory and new `plugin.json` manifest (type: `full-stack`, backendModule: `./handler.js`, frontendModule: `./frontend.js`, stripTags: `["UpdateVariable"]`, tags: `["UpdateVariable", "update"]`)
- [x] 2.2 Copy `plugins/apply-patches/handler.js` to `plugins/state-patches/handler.js` and update the Rust binary path from `plugins/apply-patches/rust/` to `plugins/state-patches/rust/`
- [x] 2.3 Copy `plugins/variable-display/frontend.js` to `plugins/state-patches/frontend.js` (no changes needed)
- [x] 2.4 Move `plugins/apply-patches/rust/` directory to `plugins/state-patches/rust/`
- [x] 2.5 Remove old `plugins/apply-patches/` directory (plugin.json, handler.js — rust/ already moved)
- [x] 2.6 Remove old `plugins/variable-display/` directory (plugin.json, frontend.js)
- [x] 2.7 Update `apply-patches/AGENTS.md` if it references the old plugin path `plugins/apply-patches/rust/`

## 3. Merge `disclaimer` + `threshold-lord` → `threshold-lord`

- [x] 3.1 Update `plugins/threshold-lord/plugin.json` to add `frontendModule: "./frontend.js"`, `stripTags: ["disclaimer"]`, and `tags: ["disclaimer"]`
- [x] 3.2 Copy `plugins/disclaimer/frontend.js` to `plugins/threshold-lord/frontend.js` and update the comment to reference `threshold-lord`
- [x] 3.3 Remove old `plugins/disclaimer/` directory

## 4. Extract User-Message Write Logic into Plugin

- [x] 4.1 Create `plugins/user-message/handler.ts` that registers a `pre-write` hook handler setting `context.preContent = '<user_message>\n' + context.message + '\n</user_message>\n\n'`
- [x] 4.2 Update `plugins/user-message/plugin.json` to add `backendModule: "./handler.ts"` and change type to `full-stack`
- [x] 4.3 Modify `writer/routes/chat.ts` to dispatch `pre-write` hook before file writing: remove hardcoded `userBlock` construction (L149), dispatch `hookDispatcher.dispatch("pre-write", { message, chapterPath, storyDir, series, name, preContent: "" })`, write `context.preContent` to file instead of `userBlock`, and replace `fullContent = userBlock + aiContent` with `fullContent = context.preContent + aiContent`
- [x] 4.4 Write unit tests for `user-message` handler: verify `preContent` is set correctly, verify empty message handling, verify handler priority

## 5. Update References and Documentation

- [x] 5.1 Update `AGENTS.md`: project structure section (replace `apply-patches` + `variable-display` with `state-patches`, note merged `threshold-lord`, expanded `user-message`), Rust path references (`plugins/apply-patches/rust/` → `plugins/state-patches/rust/`), build instructions, and architecture description
- [x] 5.2 Update `README.md`: Rust build path (`plugins/apply-patches/rust/` → `plugins/state-patches/rust/`), test command paths
- [x] 5.3 Update `docs/plugin-system.md`: plugin directory tree, plugin type examples (`apply-patches` → `state-patches`), stripTags examples, hook-only manifest example, built-in plugins reference table (remove `apply-patches`, `variable-display`, `disclaimer` rows; add `state-patches` row; update `threshold-lord` and `user-message` descriptions)
- [x] 5.4 Update any test files that reference old plugin directory names or import from old paths

## 6. Validation

- [x] 6.1 Run full test suite (`deno test --allow-read --allow-write --allow-env --allow-net writer/ reader/js/ tests/`) and verify all tests pass
- [x] 6.2 Verify plugin loading by checking `plugins/` directory has the correct 11 plugin directories (context-compaction, de-robotization, imgthink, options, state-patches, status, threshold-lord, t-task, user-message, world-aesthetic, writestyle)
- [x] 6.3 Git commit with conventional commit message

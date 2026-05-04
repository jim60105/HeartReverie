## 1. Engine: render plugin prompt fragments through Vento

- [ ] 1.1 In `writer/lib/plugin-manager.ts`, extend the `PromptVariables` interface with an optional `metadata?: Record<string, { plugin: string; file: string }>` field. Update `getPromptVariables()` to populate `metadata[frag.variable] = { plugin: manifest.name, file: frag.file }` whenever it stores a named-variable fragment in `variables`. Leave `variables` and `fragments` shape unchanged so existing mocks keep compiling.
- [ ] 1.2 In `writer/lib/template.ts#renderSystemPrompt`, after `pluginManager.getPromptVariables()`, build a fragment-render context containing at minimum `chapter_number: chapterNumber ?? 1`, plus `series_name`, `story_name`, the `loreVars`, and the already-computed `dynamicVars`.
- [ ] 1.3 Iterate `pluginVars.variables`; for any value containing `{{`, render it via `ventoEnv.runString(value, { ...fragmentContext })` and replace the entry with the rendered string. Wrap in try/catch — on failure, look up `pluginVars.metadata?.[name]` and log a warning with `{ variable: name, plugin: meta?.plugin ?? "unknown", file: meta?.file ?? "unknown", error: err.message }`, then keep the raw content (mirror lines 156–172 lore-passage pattern).
- [ ] 1.4 Confirm `validateTemplate()` whitelist still passes for `{{ chapter_number }}` (bare identifier — already permitted; no change needed). Add a comment noting plugin fragments are first-party and not run through `validateTemplate()`.

## 2. Plugin: rewrite the chapter-summary instruction

- [ ] 2.1 Replace `${chapter_number}` with `{{ chapter_number }}` in `plugins/context-compaction/chapter-summary-instruction.md`.
- [ ] 2.2 Add an explicit assertion line at the top of the instruction body, e.g. "本次生成的是第 {{ chapter_number }} 章，摘要中的章節編號必須使用此數字，請勿自行推斷。" (translate/match existing tone).
- [ ] 2.3 Remove or rephrase any existing wording that hints the LLM should determine the chapter number itself.
- [ ] 2.4 Verify the plugin still loads and renders cleanly when `chapter_number` is undefined (defaults to `1`) by manual local run.

## 3. Tests

- [ ] 3.1 Add a unit test (e.g. extend `writer/lib/template.test.ts` or create a new test under `tests/`) that loads the plugin manager with `plugins/context-compaction/` enabled, calls `renderSystemPrompt` with `chapterNumber: 42`, and asserts the rendered system prompt contains the literal substring `第 42 章` (or equivalent canonical phrasing).
- [ ] 3.2 In the same test, assert the rendered prompt does **not** contain `${chapter_number}` and does **not** contain the unrendered `{{ chapter_number }}`.
- [ ] 3.3 Add a negative test: render with a fragment containing intentionally broken Vento (`{{ if x }}` with no closing `{{ /if }}`) and assert (a) the warning is logged with the offending variable name, plugin name, and file path populated from the new `metadata` map; (b) the raw content is kept (use a fixture plugin under `tests/fixtures/`, do not modify the real plugin).
- [ ] 3.4 Add a `PluginManager.getPromptVariables()` unit test (or extend `tests/writer/lib/plugin-manager_test.ts`) asserting that `metadata[varName].plugin` and `metadata[varName].file` are populated for each named-variable fragment.
- [ ] 3.5 Run the full test suite (`deno task test` or equivalent already used in `deno.json`) and ensure it passes.

## 4. Documentation

- [ ] 4.1 Update `plugins/context-compaction/README.md` to mention that the instruction file is a Vento template and that `chapter_number` is injected by the engine.
- [ ] 4.2 If `AGENTS.md` documents prompt-fragment authoring, add a one-line note that named-variable fragments are now Vento-rendered with the same dynamic context as `system.md`.

## 5. Verification

- [ ] 5.1 Run `openspec validate fix-summary-chapter-number --strict` and resolve any findings.
- [ ] 5.2 Manually generate a chapter against a known story, inspect the outgoing system prompt (existing logging path), and confirm the chapter number appears correctly in the instruction section.

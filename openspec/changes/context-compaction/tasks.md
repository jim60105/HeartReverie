## 1. Core Hook Integration

- [x] 1.1 Add `prompt-assembly` hook dispatch in `buildPromptFromStory()` — after constructing `previousContext` array (post tag-stripping), dispatch `prompt-assembly` hook with mutable context `{ previousContext, rawChapters, storyDir, series, name }` where `rawChapters` is the unstripped chapter contents, then use the potentially-modified `previousContext` for `renderSystemPrompt()`
- [x] 1.2 Add `HookDispatcher` parameter to `buildPromptFromStory()` function signature and thread it from the chat route handler
- [x] 1.3 Update existing tests for `buildPromptFromStory()` to verify `prompt-assembly` hook dispatch occurs and `previousContext` modifications are respected

## 2. Plugin Scaffold

- [x] 2.1 Create `plugins/context-compaction/plugin.json` manifest — type `full-stack`, backendModule `./handler.ts`, promptFragments with chapter summary instruction, stripTags `["chapter_summary"]`, frontendModule `./frontend.js`
- [x] 2.2 Create `plugins/context-compaction/handler.ts` — export `register(hookDispatcher)` that registers `prompt-assembly` handler at priority 100
- [x] 2.3 Create `plugins/context-compaction/config.ts` — configuration loader that reads `compaction-config.yml` from story-level then series-level with defaults (`recentChapters: 3`, `enabled: true`)
- [x] 2.4 Create `plugins/context-compaction/chapter-summary-instruction.md` — prompt fragment instructing LLM to output `<chapter_summary>` tag after story content, with format specification for concatenation-friendly summaries (chapter number annotation, key events, character state changes, unresolved threads)

## 3. Summary Extraction

- [x] 3.1 Create `plugins/context-compaction/extractor.ts` — module with `extractChapterSummary(rawContent: string): string | null` that extracts content from `<chapter_summary>...</chapter_summary>` tags in a chapter's raw text, returns null if tag not found
- [x] 3.2 Create `plugins/context-compaction/compactor.ts` — module with `compactContext()` function that takes stripped `previousContext`, raw chapter contents, and config; returns modified `previousContext` array with three-tier structure (L0 concatenated summaries + L1 fallback originals + L2 recent originals)

## 4. Tiered Context Assembly

- [x] 4.1 Implement L2 (recent chapters) — identify last N chapters from `previousContext` array, keep as-is (already stripped by `stripPromptTags`)
- [x] 4.2 Implement L1 (summary extraction) — for chapters outside L2 window, call `extractChapterSummary()` on corresponding `rawChapters` entry; if summary found, use it; if not, keep stripped original text
- [x] 4.3 Implement L0 (global summary by concatenation) — collect all extracted chapter summaries from L1 chapters, concatenate in chronological order, wrap in `<story_summary>` tags, prepend as first element of `previousContext`
- [x] 4.4 Implement fallback — when story has fewer chapters than L2 window, return `previousContext` unmodified

## 5. Frontend Module

- [x] 5.1 Create `plugins/context-compaction/frontend.js` — register `frontend-strip` hook to strip `<chapter_summary>` tags from rendered chapter content in the reader

## 6. Tests

- [x] 6.1 Write tests for `extractChapterSummary()` — valid tag extraction, no tag present (returns null), nested tags, malformed tags
- [x] 6.2 Write tests for `compactContext()` — all-three-tiers scenario, no-summaries-fallback, partial-summaries, fewer-chapters-than-window
- [x] 6.3 Write tests for configuration loading — story-level override, series-level fallback, defaults, disabled flag
- [x] 6.4 Write tests for `prompt-assembly` hook integration — verify `previousContext` is modified by the compactor, verify `rawChapters` is passed correctly
- [x] 6.5 Write tests for L0 concatenation — verify summaries are concatenated in order and wrapped in `<story_summary>` tags

## 7. Verification & Commit

- [x] 7.1 Run `deno check` to verify all TypeScript types pass
- [x] 7.2 Run full test suite to verify no regressions
- [x] 7.3 Code review — verify hook dispatch, error handling, fallback paths, tag extraction robustness
- [x] 7.4 Commit all changes with conventional commit message

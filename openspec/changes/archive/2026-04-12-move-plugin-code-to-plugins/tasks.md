## 1. Remove Dead Code

- [x] 1.1 Delete `reader-src/src/components/StatusBar.vue`
- [x] 1.2 Delete `reader-src/src/components/OptionsPanel.vue`
- [x] 1.3 Delete `reader-src/src/components/VariableDisplay.vue`
- [x] 1.4 Delete `reader-src/src/lib/parsers/status-parser.ts`
- [x] 1.5 Delete `reader-src/src/lib/parsers/options-parser.ts`
- [x] 1.6 Delete `reader-src/src/lib/parsers/variable-parser.ts`
- [x] 1.7 Remove plugin-specific types from `reader-src/src/types/index.ts`: `StatusBarProps`, `CloseUpEntry`, `OptionItem`, `OptionsPanelProps`, `VariableDisplayProps`, `OptionsPanelEmits`
- [x] 1.8 Delete `reader-src/src/components/__tests__/leaf-components.test.ts`
- [x] 1.9 Delete `reader-src/src/lib/parsers/__tests__/status-parser.test.ts`
- [x] 1.10 Delete `reader-src/src/lib/parsers/__tests__/options-parser.test.ts`
- [x] 1.11 Delete `reader-src/src/lib/parsers/__tests__/variable-parser.test.ts`
- [x] 1.12 Remove any imports of deleted files from other modules (check for broken imports)

## 2. Fix Plugin-Coupled DOM Logic

- [x] 2.1 Update `ContentArea.vue`: change `.status-float` querySelector to `.plugin-sidebar`
- [x] 2.2 Update `plugins/status/frontend.js`: change `.status-float` class to `.plugin-sidebar` in `renderStatusPanel()` output
- [x] 2.3 Update `reader-src/src/styles/base.css`: rename `.status-float` selector to `.plugin-sidebar`

## 3. Document CSS Plugin Coupling

- [x] 3.1 Add comments in `base.css` identifying which CSS blocks serve which plugin's rendered HTML output

## 4. Clean Up Tests

- [x] 4.1 Remove references to deleted components/parsers from `rendering-pipeline.test.ts` and `useMarkdownRenderer.test.ts` if they import dead modules
- [x] 4.2 Verify all remaining tests pass: `deno task test:frontend` and `deno test --allow-read --allow-write --allow-env --allow-net tests/writer/ tests/reader/js/`

## 5. Build Verification

- [x] 5.1 Run `deno task build:reader` to confirm TypeScript compilation passes with zero errors after dead code removal
- [x] 5.2 Verify no runtime errors in browser by starting server and loading the reader

## 6. Sync Delta Specs

- [x] 6.1 Sync delta specs to main specs using openspec-sync-specs workflow
- [ ] 6.2 Archive the change using openspec-archive-change workflow

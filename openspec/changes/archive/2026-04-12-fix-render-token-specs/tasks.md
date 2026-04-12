## 1. Sync Delta Specs to Main Specs

- [x] 1.1 Update `openspec/specs/md-renderer/spec.md`: Apply MODIFIED "Tokenized rendering output" requirement — replace 5-token model with 2-token model (html + vento-error), remove plugin-specific token types and scenarios, add placeholder reinsertion scenarios
- [x] 1.2 Update `openspec/specs/md-renderer/spec.md`: Apply MODIFIED "Rendering output as RenderToken array" requirement — replace 5-way component rendering with 2-way (html via v-html, vento-error via VentoErrorCard)
- [x] 1.3 Update `openspec/specs/md-renderer/spec.md`: Apply REMOVED "Plugin tag handler registration API" requirement — delete the entire requirement block
- [x] 1.4 Update `openspec/specs/vue-component-architecture/spec.md`: Apply MODIFIED "RenderToken type definition" requirement — replace 5-variant union with HtmlToken | VentoErrorToken, remove plugin-specific variants
- [x] 1.5 Update `openspec/specs/vue-component-architecture/spec.md`: Apply MODIFIED "ChapterContent token-based rendering" requirement — replace 5-way branching with 2-way (html + vento-error), remove plugin-specific component imports

## 2. Verification

- [x] 2.1 Verify updated md-renderer spec contains no references to `status`, `options`, or `variable` token types
- [x] 2.2 Verify updated vue-component-architecture spec RenderToken is `HtmlToken | VentoErrorToken` only
- [x] 2.3 Verify no other spec files reference the removed 5-variant RenderToken definition

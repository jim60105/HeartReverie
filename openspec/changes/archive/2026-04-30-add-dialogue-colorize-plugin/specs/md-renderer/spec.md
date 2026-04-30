## REMOVED Requirements

### Requirement: Quote character normalisation
**Reason**: The substitution rewrites every Unicode quote pair (`"` `"`, `«` `»`, `「` `」`, `｢` `｣`, `《` `》`, `„`) into ASCII `"`, which destroys the original typographic intent of LLM output (especially CJK corner quotes). The legacy reason for this normalization — enabling a CSS selector that could only target ASCII quotes — is now solved cleanly by the `dialogue-colorize-plugin` capability, which colourizes every supported pair without modifying the underlying characters.
**Migration**: No user data migration. Chapter `.md` files, prompt assembly, LLM request bodies, and exports already preserve the original characters; only the rendered HTML changes visually. Internal or external code importing `normalizeQuotes()` from `reader-src/src/lib/markdown-pipeline.ts` MUST remove that import; no replacement utility is provided. Visual dialogue colourization is provided by the built-in `dialogue-colorize` plugin (enabled by default).

## ADDED Requirements

### Requirement: Quote character preservation

The renderer SHALL preserve every Unicode quote character emitted upstream (including but not limited to ASCII straight quotes `"`, curly quotes `"` `"`, guillemets `«` `»`, CJK corner quotes `「` `」`, half-width corner quotes `｢` `｣`, book title brackets `《` `》`, and the German low quote `„`) verbatim in the rendered HTML output. No stage of the rendering pipeline SHALL substitute one quote character for another. Visual styling of dialogue runs is the exclusive responsibility of plugins subscribing to the `chapter:render:after` hook.

#### Scenario: Original quote characters survive rendering
- **WHEN** a chapter's prose contains `「こんにちは」`, `«你好»`, `"Hello"`, `"World"`, `《書名》`, and `„unfinished`
- **THEN** the rendered HTML output SHALL contain those exact characters in the same positions and order; no quote character SHALL be substituted by any rendering stage

#### Scenario: Renderer ships no quote-substitution utility
- **WHEN** developers inspect `reader-src/src/lib/markdown-pipeline.ts`
- **THEN** the file SHALL NOT export a `normalizeQuotes` function (or any equivalent function whose effect is to rewrite Unicode quote characters into ASCII quotes), and `useMarkdownRenderer.renderChapter()` SHALL NOT call any such function during rendering

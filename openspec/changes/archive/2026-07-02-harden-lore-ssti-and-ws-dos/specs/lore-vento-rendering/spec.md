## ADDED Requirements

### Requirement: SSTI revalidation before lore passage rendering

Before rendering any individual lore passage body through the Vento engine (`ventoEnv.runString()`), the system SHALL revalidate that body against the Vento SSTI whitelist (`validateTemplate()`). If the body fails validation, the system SHALL NOT execute it through the engine; instead it SHALL use the raw (unrendered) passage content as the value for that passage and SHALL emit a `warn`-level log naming the passage's relative path and the diagnostic validation reason.

This is a defense-in-depth control independent of the write-path validation in the `lore-api` capability. It guarantees that a passage body which reaches disk through any path — a future or alternate write route, a direct filesystem edit, or imported/shared lore content — cannot achieve code execution at render time. The control reuses the existing per-passage raw-content fallback contract, so a rejected body degrades to plain text rather than failing the whole render.

The revalidation SHALL be applied to the same bodies that are candidates for rendering (those whose content includes `{{`), and SHALL run before the `runString()` call rather than relying on a `runString` failure.

#### Scenario: Unsafe lore body is used raw and never executed at render time
- **WHEN** a lore passage body on disk contains `{{ Deno.env.toObject() |> JSON.stringify }}` and prompt assembly resolves lore variables
- **THEN** the system SHALL detect the body fails `validateTemplate()`, SHALL NOT call `runString()` on it, SHALL use the raw body text as that passage's value, and SHALL emit a `warn` log with the passage path and reason
- **AND** no environment variables, file contents, or subprocess output SHALL appear in the rendered lore variables

#### Scenario: Safe lore body still renders normally
- **WHEN** a lore passage body contains only whitelist-safe Vento (e.g. `{{ series_name }}` or `{{ lore_character }}`)
- **THEN** the body SHALL pass `validateTemplate()` and SHALL be rendered through `runString()` exactly as before, producing the substituted output

#### Scenario: Plain passage without Vento syntax is unaffected
- **WHEN** a lore passage body contains no `{{` sequence
- **THEN** the revalidation step SHALL be skipped and the body SHALL be returned unchanged, identical to existing behavior

### Requirement: Whitelist parity for legitimate lore constructs

Render-time SSTI enforcement SHALL NOT regress legitimate lore that renders correctly today. The implementation SHALL be accompanied by a regression corpus that exercises the lore constructs the whitelist permits — at minimum: simple variable references (`{{ series_name }}`, `{{ lore_<tag> }}`), pipe-filter chains (`{{ ident |> filter }}`, `{{ ident |> filter |> filter }}`), `for`/`if`/`else` control flow, the `{{ message ... }}` tag, and Vento comments. Every construct in the corpus SHALL pass `validateTemplate()` and continue to render to the same output it produced before this change. If any construct that legitimate lore genuinely requires is found to fail the whitelist, the whitelist SHALL be extended to admit it rather than disabling render-time enforcement.

#### Scenario: Whitelist-permitted lore constructs still render unchanged
- **WHEN** the regression corpus of whitelist-permitted lore bodies is rendered before and after this change
- **THEN** each body SHALL pass `validateTemplate()` and SHALL produce output identical to its pre-change rendering, demonstrating no legitimate lore is downgraded to raw

#### Scenario: Pipe-filter chain in lore renders normally
- **WHEN** a lore passage body uses a whitelist-permitted pipe chain such as `{{ lore_character |> upper }}`
- **THEN** the body SHALL pass `validateTemplate()` and SHALL be rendered through `runString()` rather than downgraded to raw

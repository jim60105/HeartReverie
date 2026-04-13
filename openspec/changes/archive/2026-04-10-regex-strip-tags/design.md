## Context

The plugin system's `stripTags` manifest field currently accepts only plain tag name strings. The `getStripTagPatterns()` method auto-generates regex patterns from these names using `<tagName>[\s\S]*?</tagName>`. Tags with attributes on the opening element (e.g., `<T-task type="think">`) are not matched.

## Goals / Non-Goals

**Goals:**
- Allow plugins to specify custom regex patterns in `stripTags` for precise tag matching
- Maintain backward compatibility with existing plain tag name entries
- Update the `t-task` plugin to strip `<T-task>` tags that include attributes

**Non-Goals:**
- Changing the frontend strip tag system (hooks-based, separate mechanism)
- Adding new regex validation or sanitization beyond existing `escapeRegex` for plain names
- Supporting regex flags other than `g` (the combined pattern always uses `g`)

## Decisions

### D1: Regex detection by leading `/`

A `stripTags` entry starting with `/` is treated as a regex pattern string. The leading and trailing `/` plus optional flags are stripped, and the inner pattern is used directly. Plain strings (no leading `/`) continue to be auto-wrapped as before.

**Rationale:** Simple, unambiguous detection. No plain tag name starts with `/`.

### D2: Regex flags are ignored — combined pattern always uses `g`

All individual patterns are joined with `|` into a single `RegExp(..., "g")`. Per-entry flags (like `/g`) are parsed but discarded since the combined regex always uses the `g` flag.

**Rationale:** The existing system uses a single combined regex with `g`. Mixing per-pattern flags is not supported by JavaScript's `RegExp`.

## Risks / Trade-offs

- **Invalid regex risk:** A malformed regex pattern in a plugin manifest will throw at startup. Mitigation: wrap in try-catch, log warning, and skip the invalid entry.
- **Security:** Regex patterns from plugin manifests could theoretically be crafted for ReDoS. Mitigation: plugin manifests are author-controlled files on disk, not user input. Same trust level as existing `backendModule` code execution.

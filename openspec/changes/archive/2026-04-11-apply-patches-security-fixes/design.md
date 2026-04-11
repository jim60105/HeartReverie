## Context

The `apply-patches` CLI was recently refactored from a monolithic `main.rs` into six focused modules with 83 tests and 83.46% line coverage. A GPT-5.4 code review identified four pre-existing issues that were faithfully preserved during the refactor but warrant fixing: symlink traversal, malformed-JSON line-only parsing, non-RFC-6901 path parsing, and incorrect `/-` insert semantics on scalars.

The tool processes custom JSONPatch operations (NOT RFC 6902) from Markdown files against YAML state. It is used with SillyTavern story branches where directory trees come from user-created content.

## Goals / Non-Goals

**Goals:**
- Prevent symlink-based path traversal attacks in directory discovery and output writing
- Support multiline malformed-JSON entries in `<JSONPatch>` blocks (brace-aware accumulation)
- Implement RFC 6901 path escaping (`~0` → `~`, `~1` → `/`) and preserve empty segments
- Fix `/-` insert on non-sequence parents to create a sequence instead of a mapping key

**Non-Goals:**
- Full RFC 6902 compliance (the custom format is intentional)
- Supporting symbolic links as valid scenario/chapter directories
- Rewriting the overall pipeline architecture
- Changing the module structure from the recent refactor

## Decisions

### D1: Symlink rejection via `symlink_metadata`

Use `std::fs::symlink_metadata()` to check entry type without following symlinks. Reject any entry where `metadata.file_type().is_symlink()` is true. This is simpler and more predictable than canonicalize-and-check.

**Alternative**: Canonicalize all paths and verify they remain under a canonicalized root. Rejected because it allows symlinks pointing inside the root, which adds complexity for no real benefit in this tool's use case.

### D2: Brace-aware multiline fallback parser

Replace line-by-line manual extraction with a character-scanning approach that:
1. Tracks brace depth (`{` increments, `}` decrements) with quote awareness
2. Accumulates characters into a buffer until brace depth returns to 0
3. Extracts `op`, `path`, `value` fields from each completed object buffer

This handles both single-line and pretty-printed malformed JSON entries.

**Alternative**: Use a streaming JSON parser with error recovery. Rejected because the malformed JSON is specifically about unescaped quotes in values, not structural issues — a full parser would still choke on the same problem.

### D3: RFC 6901 unescaping in `parse_path`

Update `parse_path` to:
1. Split on `/` after stripping the leading `/`
2. Preserve empty segments (empty string between consecutive `/`)
3. Unescape `~1` → `/` then `~0` → `~` (order matters per RFC 6901 §4)

**Alternative**: Keep custom parsing. Rejected because RFC 6901 is the standard for JSON Pointer and the tool already uses JSON Pointer syntax — fixing this improves correctness with no compatibility risk (no existing story data uses `~0` or `~1` escapes, but they might in the future).

### D4: Sequence creation for `/-` on non-sequence

When `insert` targets a path ending in `/-` and the parent is not a sequence:
- If parent is a mapping or scalar, create a new sequence with the value as the sole element
- Replace the parent value at that path with the new sequence

This matches the intuitive meaning of "append to array" even when the array doesn't exist yet (consistent with upsert semantics used elsewhere).

## Risks / Trade-offs

- [Symlink rejection breaks valid setups] → Low risk; symlinked story directories are not a documented use case. A warning message on stderr will explain why a directory was skipped.
- [RFC 6901 changes existing behavior] → Low risk; no known story data uses escaped characters in paths. Preserving empty segments could theoretically break a path like `//x` but such paths are malformed today anyway.
- [Multiline fallback may parse differently] → Medium risk; the new brace-aware parser must produce identical results for single-line entries. Regression tests will cover both formats.
- [`/-` sequence creation changes behavior] → Low risk; the current behavior (creating a mapping with key `"-"`) is clearly a bug, not intentional behavior.

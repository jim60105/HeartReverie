## Why

The apply-patches CLI has four pre-existing robustness and security gaps identified during code review: symlink traversal allows reads/writes outside the root directory, the malformed-JSON fallback silently drops multiline entries, `parse_path` ignores RFC 6901 escaping, and `insert` with `/-` on a scalar creates a mapping instead of a sequence. These issues affect correctness and could be exploited in crafted directory trees.

## What Changes

- **Symlink traversal prevention**: Reject symlinked scenario/chapter directories or canonicalize and verify all processed paths remain under the canonicalized root.
- **Multiline malformed-JSON support**: Replace line-by-line fallback parsing with brace-aware, quote-aware block accumulation so pretty-printed malformed entries are not silently dropped.
- **RFC 6901 path parsing**: Preserve empty segments after the leading slash and unescape `~1 → /`, `~0 → ~` in `parse_path`.
- **Sequence append (`/-`) fix**: When `insert` targets `/-` on a non-sequence parent, create a sequence instead of inserting a mapping key `"-"`.

## Capabilities

### New Capabilities

- `apply-patches-security`: Symlink traversal prevention and path canonicalization for safe directory processing.

### Modified Capabilities

- `jsonpatch-processor`: Fix multiline malformed-JSON fallback, RFC 6901 path escaping, and `/-` insert semantics.
- `apply-patches-tests`: Add regression tests for all four fixes.

## Impact

- `apply-patches/src/pipeline.rs` — symlink check in directory discovery
- `apply-patches/src/parser.rs` — multiline fallback parser rewrite
- `apply-patches/src/convert.rs` — RFC 6901 `parse_path` rewrite
- `apply-patches/src/patch_ops.rs` — `/-` insert semantics fix
- `apply-patches/src/yaml_nav.rs` — potential container-type-aware navigation
- `apply-patches/tests/integration.rs` — new regression tests
- No dependency changes expected

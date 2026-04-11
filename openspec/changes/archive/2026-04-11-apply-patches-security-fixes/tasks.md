## 1. Symlink Traversal Prevention

- [x] 1.1 Add `is_symlink()` check in `pipeline.rs` `sorted_subdirs` to skip symlinked directories with stderr warning
- [x] 1.2 Add `is_symlink()` check in scenario directory discovery (main.rs) to skip symlinked scenario dirs with stderr warning
- [x] 1.3 Add output path canonicalization check — verify `current-status.yml` path stays under root before writing
- [x] 1.4 Add unit tests for symlink rejection in `pipeline.rs`
- [x] 1.5 Add integration test for symlink traversal prevention (create symlink in temp dir, verify skipped)

## 2. Multiline Malformed JSON Fallback

- [x] 2.1 Replace line-by-line fallback parser in `parser.rs` with brace-aware block accumulation (track brace depth, quote awareness)
- [x] 2.2 Verify single-line malformed entries still parse identically (regression)
- [x] 2.3 Add unit tests for multiline malformed JSON objects (pretty-printed across multiple lines)
- [x] 2.4 Add unit test for mixed single-line and multiline malformed entries in same block

## 3. RFC 6901 Path Parsing

- [x] 3.1 Rewrite `parse_path` in `convert.rs` to preserve empty segments and unescape `~1` → `/` then `~0` → `~`
- [x] 3.2 Add unit tests for: escaped tilde (`~0`), escaped slash (`~1`), empty segments, double escape (`~01`), backward compatibility with existing simple paths
- [x] 3.3 Verify all existing tests still pass after parse_path change

## 4. Sequence Creation for `/-` Insert

- [x] 4.1 Fix `apply_insert` in `patch_ops.rs` to create a sequence when `/-` targets a non-sequence parent
- [x] 4.2 Update or add unit test to verify `/-` on scalar creates `[value]` not `{"-": value}`
- [x] 4.3 Add unit test for `/-` on mapping parent (should also create sequence)

## 5. Final Verification

- [x] 5.1 Run full `cargo test` — all existing + new tests pass
- [x] 5.2 Run `cargo build` — no warnings
- [x] 5.3 Verify line coverage still meets 75% threshold

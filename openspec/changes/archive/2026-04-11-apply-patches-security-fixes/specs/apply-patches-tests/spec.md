## ADDED Requirements

### Requirement: Regression tests for security and correctness fixes
The test suite SHALL include regression tests for symlink traversal prevention, multiline malformed-JSON parsing, RFC 6901 path escaping, and `/-` insert semantics on non-sequence parents.

#### Scenario: Symlink traversal regression test
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify that symlinked directories are skipped and a warning is logged

#### Scenario: Multiline malformed JSON regression test
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify that pretty-printed malformed JSON objects are correctly parsed across multiple lines

#### Scenario: RFC 6901 escaping regression test
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify `~0` → `~` and `~1` → `/` unescaping, empty segment preservation, and combined escape sequences

#### Scenario: Sequence creation regression test
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify that `insert` with `/-` on a scalar parent creates a sequence, not a mapping with key `"-"`

# state-security Specification

## Purpose
TBD - created by archiving change apply-patches-security-fixes (now state). Update Purpose after archive.
## Requirements
### Requirement: Symlink traversal prevention
The tool SHALL reject symlinked directories during scenario and sub-directory discovery. When a directory entry is a symbolic link, the tool SHALL skip it and log a warning to stderr. All file paths processed by the tool SHALL remain under the root directory.

#### Scenario: Symlinked scenario directory skipped
- **WHEN** `root/scenario-a` is a symbolic link to an external directory
- **THEN** the tool SHALL skip `root/scenario-a` and log a warning to stderr

#### Scenario: Symlinked sub-directory skipped
- **WHEN** `root/scenario/chapter-01` is a symbolic link
- **THEN** the tool SHALL skip `chapter-01` during sub-directory processing and log a warning to stderr

#### Scenario: Regular directories processed normally
- **WHEN** `root/scenario-a` is a regular directory (not a symlink)
- **THEN** the tool SHALL process it normally as before

### Requirement: Path canonicalization for output
The tool SHALL verify that all output file paths (`current-status.yml`) resolve to locations under the root directory before writing.

#### Scenario: Output path within root
- **WHEN** the computed output path is under the root directory
- **THEN** the tool SHALL write `current-status.yml` normally

#### Scenario: Output path escapes root
- **WHEN** the computed output path resolves outside the root directory (e.g., via `..` components)
- **THEN** the tool SHALL refuse to write and log an error to stderr


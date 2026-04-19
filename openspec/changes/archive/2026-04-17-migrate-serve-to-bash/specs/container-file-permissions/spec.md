# Spec: container-file-permissions (delta)

> Delta spec for the migrate-serve-to-bash change.

## MODIFIED Requirements

### Requirement: Git executable permissions

Shell scripts `entrypoint.sh` and `serve.sh` MUST be tracked in git with the executable permission bit set (filemode `100755`), not `100644`. This ensures the scripts are executable when checked out and when copied into the container image.

#### Scenario: entrypoint.sh is executable in git
- **WHEN** `git ls-files -s entrypoint.sh` is examined
- **THEN** the filemode SHALL be `100755`

#### Scenario: serve.sh is executable in git
- **WHEN** `git ls-files -s serve.sh` is examined
- **THEN** the filemode SHALL be `100755`

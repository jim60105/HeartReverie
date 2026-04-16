# Spec: containerization (delta)

> Delta spec for the migrate-serve-to-bash change.

## MODIFIED Requirements

### R12a: Unified Startup Scripts

- The `entrypoint.sh` MUST work for both container and local development environments
- A thin wrapper script (`serve.sh`) MAY exist for local development convenience, setting project-relative environment variables (`PORT`, `PLAYGROUND_DIR`, `READER_DIR`, `CERT_DIR`) and delegating to `entrypoint.sh`
- The wrapper script MUST be a Bash script (`#!/usr/bin/env bash`), not Zsh
- The wrapper script MUST NOT duplicate any cert generation or server startup logic — all such logic MUST be in `entrypoint.sh`

#### Scenario: Dev wrapper script uses Bash
- **WHEN** the `serve.sh` script is examined
- **THEN** the shebang SHALL be `#!/usr/bin/env bash`

#### Scenario: Dev wrapper script delegates to entrypoint
- **WHEN** the developer runs `./serve.sh`
- **THEN** the script SHALL set project-relative environment variables and exec `entrypoint.sh`

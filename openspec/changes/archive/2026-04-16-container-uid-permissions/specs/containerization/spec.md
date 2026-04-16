# Spec: containerization (delta)

> Modifies the default UID build argument from 1001 to 1000 for better compatibility with common container base images and host systems.

## MODIFIED Requirements

### R5: Containerfile Syntax and Structure

The root Containerfile MUST follow these conventions:
- Begin with `# syntax=docker/dockerfile:1`
- Declare `ARG UID=1000`, `ARG VERSION=EDGE`, and `ARG RELEASE=0` at the top level
- Build stages MUST be separated by a line of exactly 40 `#` characters
- Files MUST be named `Containerfile` (not `Dockerfile`)

#### Scenario: Default UID is 1000
- **WHEN** the root `Containerfile` top-level `ARG` instructions are examined
- **THEN** the UID argument SHALL be declared as `ARG UID=1000`

### R10: Non-Root User Execution

- The final stage MUST create a non-root user with UID from the `$UID` build arg (default 1000) and GID 0
- The `USER` instruction MUST use the format `$UID:0` for OpenShift arbitrary UID compatibility
- All application files and directories MUST be owned by `$UID:0`

#### Scenario: Container runs as non-root with default UID 1000
- **WHEN** the container starts with default build arguments
- **THEN** the process SHALL run as UID 1000, GID 0

#### Scenario: Custom UID override
- **WHEN** the image is built with `--build-arg UID=5000`
- **THEN** the container process SHALL run as UID 5000, GID 0

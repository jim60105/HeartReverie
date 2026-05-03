# Spec: container-file-permissions

> Defines requirements for runtime file and directory permission modes in the backend and entrypoint script, ensuring files created at runtime are group-writable for OpenShift arbitrary UID compatibility.

## Purpose

When the container runs with an arbitrary UID (as OpenShift does), the effective user belongs to GID 0 but has a random UID. Files and directories created at runtime must be group-writable so that subsequent container restarts (potentially with a different arbitrary UID, still in GID 0) can read and modify them. This spec ensures all runtime file-creation calls use explicit POSIX permission modes and that the entrypoint sets an appropriate umask.

## Requirements

### Requirement: Runtime directory creation permissions

Every `Deno.mkdir()` call in the backend that creates directories at runtime MUST include the options `{ recursive: true, mode: 0o775 }` so that created directories are owner-rwx, group-rwx, and other-rx. This ensures directories are group-writable for OpenShift arbitrary UID compatibility.

Affected files:
- `writer/lib/chat-shared.ts`
- `writer/routes/chapters.ts`
- `writer/routes/lore.ts`
- `writer/routes/prompt.ts`

#### Scenario: mkdir in chat-shared uses mode 0o775
- **WHEN** `writer/lib/chat-shared.ts` calls `Deno.mkdir()` to create a chapter directory
- **THEN** the call MUST include `{ recursive: true, mode: 0o775 }` in its options

#### Scenario: mkdir in chapters route uses mode 0o775
- **WHEN** `writer/routes/chapters.ts` calls `Deno.mkdir()` to ensure a chapter directory exists
- **THEN** the call MUST include `{ recursive: true, mode: 0o775 }` in its options

#### Scenario: mkdir in lore route uses mode 0o775
- **WHEN** `writer/routes/lore.ts` calls `Deno.mkdir()` to create a lore directory
- **THEN** the call MUST include `{ recursive: true, mode: 0o775 }` in its options

#### Scenario: mkdir in prompt route uses mode 0o775
- **WHEN** `writer/routes/prompt.ts` calls `Deno.mkdir()` to create a prompt directory
- **THEN** the call MUST include `{ recursive: true, mode: 0o775 }` in its options

### Requirement: Runtime file creation permissions

Every `Deno.writeTextFile()` and `Deno.open()` call with `{ create: true }` in the backend MUST include `{ mode: 0o664 }` in its options so that created files are owner-rw, group-rw, and other-r. This ensures files are group-readable and group-writable for OpenShift arbitrary UID compatibility.

Affected files:
- `writer/lib/chat-shared.ts`
- `writer/routes/chapters.ts`
- `writer/routes/lore.ts`
- `writer/routes/prompt.ts`

#### Scenario: Deno.open in chat-shared uses mode 0o664
- **WHEN** `writer/lib/chat-shared.ts` calls `Deno.open()` with `{ create: true }` to create a chapter file
- **THEN** the call MUST include `mode: 0o664` in its options

#### Scenario: writeTextFile in chapters route uses mode 0o664
- **WHEN** `writer/routes/chapters.ts` calls `Deno.writeTextFile()` to save chapter content
- **THEN** the call MUST include `{ mode: 0o664 }` in its options

#### Scenario: writeTextFile in lore route uses mode 0o664
- **WHEN** `writer/routes/lore.ts` calls `Deno.writeTextFile()` to save a lore passage
- **THEN** the call MUST include `{ mode: 0o664 }` in its options

#### Scenario: writeTextFile in prompt route uses mode 0o664
- **WHEN** `writer/routes/prompt.ts` calls `Deno.writeTextFile()` to save a prompt template
- **THEN** the call MUST include `{ mode: 0o664 }` in its options

### Requirement: Process umask is set at startup

The container `CMD` and `scripts/serve.sh` MUST set `umask 0002` at process-start time, before the Deno server begins serving requests. In the Containerfile this is done by setting `CMD` to `["sh", "-c", "umask 0002 && exec deno run --allow-net --allow-read --allow-write --allow-env --allow-run writer/server.ts"]`. In `scripts/serve.sh` it is done by inserting a `umask 0002` line at the top of the script (after `set -euo pipefail`, before `exec deno run …`). The umask discipline preserves OpenShift arbitrary-UID + shared-GID-0 group-write semantics on directories the application creates at runtime via `Deno.mkdir({ recursive: true, mode: 0o775 })`, since Deno's `mkdir` honours the inherited process umask.

#### Scenario: Containerfile CMD includes umask 0002

- **WHEN** the root `Containerfile` final-stage `CMD` JSON array is examined
- **THEN** the `sh -c` argument string SHALL contain the substring `umask 0002` followed by `exec deno run`

#### Scenario: scripts/serve.sh sets umask 0002

- **WHEN** `scripts/serve.sh` is read top-to-bottom
- **THEN** there SHALL be a `umask 0002` line that runs before the final `exec deno run …` line

#### Scenario: Runtime-created directory is group-writable

- **WHEN** the running container creates a directory at runtime via code that calls `Deno.mkdir(path, { recursive: true, mode: 0o775 })`
- **THEN** the resulting directory mode SHALL include the group-write bit (`0o775`, NOT `0o755`)

### Requirement: Git executable permissions

`scripts/serve.sh` MUST be tracked in git with the executable permission bit set (filemode `100755`), not `100644`. This ensures the script is executable when checked out and when copied into the container image. The `entrypoint.sh` script no longer exists in the repository (deleted as part of removing in-application TLS), so its filemode requirement is dropped.

#### Scenario: serve.sh is executable in git
- **WHEN** `git ls-files -s scripts/serve.sh` is examined
- **THEN** the filemode SHALL be `100755`

#### Scenario: entrypoint.sh does not exist

- **WHEN** the repository root is examined
- **THEN** there SHALL be no file at `entrypoint.sh` (`ls entrypoint.sh` returns "No such file or directory")

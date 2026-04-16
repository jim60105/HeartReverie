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

### Requirement: Entrypoint umask

`entrypoint.sh` MUST set `umask 002` immediately after the shebang line and `set -eu`, before any file-creating operations. This ensures that all child processes create files with group-writable permissions by default (directories: 775, files: 664).

#### Scenario: umask set early in entrypoint
- **WHEN** `entrypoint.sh` is examined
- **THEN** `umask 002` SHALL appear after `#!/bin/sh` and `set -eu` but before any `openssl`, `mkdir`, or other file-creating commands

### Requirement: TLS certificate file permissions

After generating self-signed TLS certificates, `entrypoint.sh` MUST explicitly set file permissions: `chmod 664` for the certificate (group-rw, other-r) and `chmod 660` for the private key (group-rw, no other access). This is necessary because OpenSSL hardcodes private key files to mode 0600 regardless of the process umask, which would prevent a subsequent container restart under a different arbitrary UID (still in GID 0) from reading the key. The private key MUST NOT be world-readable.

#### Scenario: Generated TLS cert is group-readable
- **WHEN** `entrypoint.sh` generates self-signed TLS certificates via `openssl`
- **THEN** the entrypoint MUST run `chmod 664` on the certificate file and `chmod 660` on the private key file after generation, ensuring the key is not world-readable

#### Scenario: Existing TLS certs remain accessible
- **WHEN** the container restarts with a different arbitrary UID (same GID 0) and TLS certs already exist
- **THEN** the key and cert files SHALL be readable by the new UID because they have group-read permissions

### Requirement: Git executable permissions

Shell scripts `entrypoint.sh` and `serve.zsh` MUST be tracked in git with the executable permission bit set (filemode `100755`), not `100644`. This ensures the scripts are executable when checked out and when copied into the container image.

#### Scenario: entrypoint.sh is executable in git
- **WHEN** `git ls-files -s entrypoint.sh` is examined
- **THEN** the filemode SHALL be `100755`

#### Scenario: serve.zsh is executable in git
- **WHEN** `git ls-files -s serve.zsh` is examined
- **THEN** the filemode SHALL be `100755`

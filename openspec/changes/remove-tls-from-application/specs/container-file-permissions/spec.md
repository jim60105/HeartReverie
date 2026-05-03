## REMOVED Requirements

### Requirement: Entrypoint umask

**Reason:** `entrypoint.sh` is deleted as part of removing in-application TLS, so the requirement that pinned the umask line to that specific file no longer applies. The `umask 0002` itself is **not** dropped — it has been moved to two places that replace `entrypoint.sh`'s role: (a) the Containerfile `CMD` shell shim (`["sh", "-c", "umask 0002 && exec deno run …"]`), and (b) `scripts/serve.sh` (a top-of-script `umask 0002` line before `exec deno run …`). Empirical verification on the in-use Deno runtime confirmed that `Deno.mkdir({ mode: 0o775 })` is masked to `0o755` under inherited `umask 0022`, so dropping the umask without preserving it elsewhere would break OpenShift arbitrary-UID + shared-GID-0 group-write semantics on every directory the application creates at runtime. Files are independent (Deno explicit-`chmod`s them after creation), but the explicit `mode:` discipline at write call sites SHALL be preserved as defence-in-depth (see the existing "Runtime directory creation permissions" / "Runtime file creation permissions" requirements; this change does not remove them).

### Requirement: TLS certificate file permissions

**Reason:** The application no longer generates self-signed TLS certificates at startup (no `entrypoint.sh`, no `openssl`, no `/certs` directory). Operators terminating TLS upstream provide their own cert/key file permissions through their secret-management toolchain.

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Git executable permissions

`scripts/serve.sh` MUST be tracked in git with the executable permission bit set (filemode `100755`), not `100644`. This ensures the script is executable when checked out and when copied into the container image. The `entrypoint.sh` script no longer exists in the repository (deleted as part of removing in-application TLS), so its filemode requirement is dropped.

#### Scenario: serve.sh is executable in git

- **WHEN** `git ls-files -s scripts/serve.sh` is examined
- **THEN** the filemode SHALL be `100755`

#### Scenario: entrypoint.sh does not exist

- **WHEN** the repository root is examined
- **THEN** there SHALL be no file at `entrypoint.sh` (`ls entrypoint.sh` returns "No such file or directory")

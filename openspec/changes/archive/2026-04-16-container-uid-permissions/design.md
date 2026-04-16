## Context

The container image defaults to UID 1001 and application code creates files/directories without explicit POSIX modes, inheriting the process umask. This causes permission conflicts in three deployment scenarios: host-mounted volumes (where the first non-root user is typically UID 1000), rootless Podman (where UID mapping expects conventional UIDs), and OpenShift (where containers run as arbitrary UIDs in the root group). See [proposal.md](proposal.md) for full motivation.

## Goals / Non-Goals

**Goals**

- Align the container's default UID with the Linux convention (1000) to eliminate host-volume permission mismatches out of the box.
- Guarantee every runtime-created file and directory has deterministic, group-writable permissions — regardless of the container runtime or orchestrator.
- Ensure shell scripts are executable in git so `./entrypoint.sh` works without manual `chmod` after clone.

**Non-Goals**

- Supporting arbitrary UID at build-time is already handled by `ARG UID`; this change only updates the default value.
- Retrofitting SELinux label management or ACLs — volume `:z`/`:Z` flags remain the user's responsibility.
- Backward compatibility with the previous UID 1001 — the project is pre-release with no existing deployments to migrate.

## Decisions

### 1. Default UID 1000

UID 1000 is the de-facto first non-root user on Debian, Ubuntu, Fedora, and Arch. Matching this convention means `podman run -v ./data:/app/playground` works without `--userns` gymnastics for the majority of Linux hosts. The `ARG UID` build argument remains, so anyone with a non-standard setup can override at build time (`--build-arg UID=1001`).

### 2. Explicit modes in application code: 0o775 (dirs) / 0o664 (files)

Rather than relying solely on umask, every `Deno.mkdir()` call specifies `{ mode: 0o775 }` and every `Deno.writeTextFile()` / `Deno.open({ create: true })` call specifies `{ mode: 0o664 }`. The rationale:

- **Owner + group writable, others read/execute** — this is the standard group-collaboration permission model. It allows the root group (GID 0) full access, which is required by OpenShift's arbitrary-UID policy where the container user is always in group 0.
- **Not 0o777 / 0o666** — world-writable permissions are unnecessary and violate the principle of least privilege. The container runs a single application user; no "other" users need write access.
- **Explicit over implicit** — hardcoded modes make the permission contract visible in code review and immune to umask misconfiguration. A developer reading `Deno.mkdir(dir, { recursive: true, mode: 0o775 })` knows exactly what permissions the directory gets.

### 3. `umask 002` as the primary runtime permission guarantee in entrypoint.sh

The entrypoint script sets `umask 002` before launching the Deno server. This is the **primary mechanism** that guarantees group-writable permissions at runtime:

- `Deno.mkdir({ mode })` and `Deno.open({ mode })` are still subject to the process umask — the effective permissions are `mode & ~umask`. With `umask 002`, the requested modes (0o775/0o664) pass through unchanged because `002` only strips the "other-write" bit.
- Child processes spawned by the shell (e.g., `openssl` for TLS certificates) inherit this umask, so directories created by `mkdir -p` will be group-writable.
- If a future code path misses an explicit `mode` argument, the umask still prevents files from being created as owner-only (the typical default umask 022 strips group-write).

**Exception — OpenSSL private keys**: OpenSSL explicitly sets private key files to mode 0600 regardless of umask. The entrypoint MUST apply `chmod 664` to the certificate and `chmod 660` to the private key after creation — ensuring group-readability for arbitrary-UID restarts while keeping the private key non-world-readable.

### 4. Layered permission strategy

The overall approach is **umask as primary guarantee + explicit modes as documentation + Containerfile for build-time**:

| Layer | Scope | Purpose |
|-------|-------|---------|
| `umask 002` in `entrypoint.sh` | All runtime file creation (Deno + shell children) | **Primary guarantee** — ensures group-write regardless of whether individual calls specify mode |
| `Deno.mkdir({ mode })` / `Deno.writeTextFile({ mode })` | TypeScript application code | Documents intended permissions in code; effective mode is `requested & ~umask` |
| Explicit `chmod` after `openssl` | TLS cert/key generation | Corrects OpenSSL's hardcoded 0600 on private keys |
| `COPY --chmod=775 --chown=$UID:0` in Containerfile | Image build time | Ensures all shipped files are group-accessible (already in place, no changes needed) |

This layering means no single mechanism is a single point of failure for permissions.

### 5. Git executable bit on shell scripts

`entrypoint.sh` and `serve.zsh` are marked as `100755` in the git index. This is purely conventional — it ensures `./entrypoint.sh` works immediately after `git clone` without requiring a manual `chmod +x` step, and it matches developer expectations for shell scripts. The Containerfile's `--chmod=775` already handles the container image independently.

## Risks / Trade-offs

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| **Breaking existing mounts** — users who built images with the old UID 1001 will find volume ownership mismatched after rebuild | Low (pre-release, no known deployments) | Documented as a breaking change; `chown -R 1000:0` or rebuild with `--build-arg UID=1001` as escape hatch |
| **Deno ignores `mode` on some platforms** — `Deno.writeTextFile` mode is POSIX-only; on Windows it is silently ignored | Negligible | The server targets Linux containers; Windows is not a supported deployment target |
| **Future code paths skip explicit mode** — a new `Deno.mkdir()` call added without `{ mode }` | Medium | The `umask 002` safety net ensures group-write even without explicit mode; code review and tests should catch omissions |
| **umask 002 is too permissive for non-container use** — local dev on a shared machine could expose files to group members | Low | Local dev typically runs as a single user; the shell scripts are developer tools, not multi-tenant services |

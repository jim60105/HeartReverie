## Why

The container image currently uses UID 1001, which can cause permission conflicts when volumes are mounted from the host — most Linux distros default the first user to UID 1000. Additionally, files and directories created at runtime by the application lack explicit POSIX permissions, meaning they inherit the process umask and may not be group-writable, breaking OpenShift/rootless-Podman deployments where a random UID runs with GID 0.

## What Changes

- **BREAKING**: Change the default container UID from 1001 to 1000 in `Containerfile`
- Add explicit `mode: 0o775` to every `Deno.mkdir()` call in the backend so directories created at runtime are group-writable and executable
- Add explicit `{ mode: 0o664 }` to every `Deno.writeTextFile()` / `Deno.open({ create: true })` call so files created at runtime are group-writable
- Mark shell scripts (`entrypoint.sh`, `serve.zsh`) as executable (100755) in git — currently they are 100644
- Verify that all `COPY`/`ADD` instructions in the Containerfile already include `--chmod=775 --chown=$UID:0` (they do; document/confirm this)
- Set `umask 002` in `entrypoint.sh` so that any files created by child processes (e.g., TLS certs from `openssl`, future scripts) default to group-writable

## Capabilities

### New Capabilities

- `container-file-permissions`: Covers the runtime file-permission strategy — every file/directory the application creates gets explicit POSIX modes (775 for dirs, 664 for files) and the entrypoint sets `umask 002`.

### Modified Capabilities

- `containerization`: Default UID changes from 1001 → 1000; confirms COPY/ADD already use `--chmod=775 --chown=$UID:0`.

## Impact

- **Containerfile**: UID ARG default changes from 1001 to 1000; no new build dependencies
- **Backend (writer/)**: `chat-shared.ts`, `routes/chapters.ts`, `routes/lore.ts`, `routes/prompt.ts` — all `Deno.mkdir()`, `Deno.writeTextFile()`, and `Deno.open()` calls gain explicit `mode` options
- **entrypoint.sh**: Gains `umask 002` near the top; shell scripts become executable in git
- **Existing containers**: Rebuilds will use UID 1000 instead of 1001. Existing volumes owned by UID 1001 need manual `chown` (acceptable per no-backward-compat instruction)
- **No API changes, no frontend changes, no dependency changes**

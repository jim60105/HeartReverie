## Why

The dev startup script `serve.zsh` requires Zsh, which is not universally available on all developer machines (e.g., minimal Linux containers, CI environments, Windows with Git Bash). Since the script uses no Zsh-specific features beyond `${0:a:h}` for path resolution, migrating it to Bash (`serve.sh`) removes an unnecessary dependency and makes the project more accessible.

## What Changes

- Rename `serve.zsh` to `serve.sh` and change the shebang from `#!/bin/zsh` to `#!/bin/bash`
- Replace the Zsh-specific `${0:a:h}` path resolution with a POSIX/Bash equivalent
- Update all documentation references from `serve.zsh` / `zsh ./serve.zsh` to `serve.sh` / `./serve.sh`

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `containerization`: The dev wrapper script filename changes from `serve.zsh` to `serve.sh`; Zsh is no longer required for local development
- `container-file-permissions`: The executable script filename changes from `serve.zsh` to `serve.sh`

## Impact

- **`serve.zsh` → `serve.sh`**: Renamed and rewritten as Bash script
- **Documentation**: `README.md`, `AGENTS.md`, `docs/plugin-system.md` — all references updated
- **`.containerignore`**: Filename reference updated
- **OpenSpec specs**: `unified-server`, `deno-migration`, `containerization`, `container-file-permissions` — filename references updated
- **HeartReverie_Plugins** (cross-repo): `README.md` reference updated
- **No backend code changes**: The script is a thin wrapper; no TypeScript or server logic is affected

## Context

The current `serve.zsh` is a thin wrapper script that sets project-relative environment variables and delegates to `entrypoint.sh`. The only Zsh-specific construct is `${0:a:h}` for resolving the script's absolute directory path. All other constructs (`set -euo pipefail`, `[[ ]]`, regex matching, `readonly`, arithmetic evaluation) are Bash-compatible.

## Goals / Non-Goals

**Goals:**

- Replace the Zsh dependency with Bash for the dev startup script
- Maintain identical runtime behavior (port validation, env var export, exec delegation)
- Update all documentation and spec references

**Non-Goals:**

- Rewriting `entrypoint.sh` (already POSIX `sh`)
- Changing any server behavior or backend code

## Decisions

### D1: Use `cd "$(dirname "$0")" && pwd` for path resolution

**Decision**: Replace `${0:a:h}` with `SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"` — a well-established Bash idiom for resolving a script's absolute directory.

**Rationale**: This is portable across Bash versions and does not depend on GNU `readlink -f` (which is unavailable on macOS). The script is always invoked directly, so symlink resolution is not a concern.

**Alternative considered**: `readlink -f "$0"` — rejected because macOS ships BSD `readlink` which lacks `-f`.

### D2: Rename to `serve.sh`

**Decision**: Rename the file from `serve.zsh` to `serve.sh` to reflect the new interpreter.

**Rationale**: The `.zsh` extension communicates Zsh requirement to users. Keeping it after migration would be misleading.

### D3: Use `#!/usr/bin/env bash` shebang

**Decision**: Use `#!/usr/bin/env bash` instead of `#!/bin/bash` for the shebang line.

**Rationale**: `env bash` is more portable — Bash may not be at `/bin/bash` on all systems (e.g., NixOS, some BSDs). Since the migration motivation is broader accessibility, this strengthens that goal.

### D4: Guard against Bash octal parsing in port validation

**Decision**: Use `10#$1` in arithmetic evaluation to force base-10 parsing.

**Rationale**: Bash's `(( ))` treats numbers with leading zeroes as octal, causing `08` and `09` to error out. The `10#` prefix forces decimal interpretation, matching the Zsh behavior.

## Risks / Trade-offs

- **[Risk]** Developers may have shell aliases or scripts referencing `serve.zsh` → **Mitigation**: No backward compatibility concern — project is pre-release with 0 users. Documentation updates will guide anyone who encounters the change.

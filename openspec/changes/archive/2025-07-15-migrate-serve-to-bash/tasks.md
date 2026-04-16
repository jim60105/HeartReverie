## 1. Script Migration

- [x] 1.1 Rename `serve.zsh` to `serve.sh` via `git mv`
- [x] 1.2 Change shebang from `#!/bin/zsh` to `#!/usr/bin/env bash`
- [x] 1.3 Replace `${0:a:h}` with `SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"` and update all references from `PROJECT_ROOT` to `SCRIPT_DIR`
- [x] 1.4 Add `10#` prefix to arithmetic port validation to prevent Bash octal parsing of leading-zero inputs
- [x] 1.5 Verify the script retains executable permission (`100755`) after rename

## 2. Documentation Updates

- [x] 2.1 Update `README.md`: change `zsh ./serve.zsh` to `./serve.sh`
- [x] 2.2 Update `AGENTS.md`: change `serve.zsh` references to `serve.sh`
- [x] 2.3 Update `docs/plugin-system.md`: change `zsh ./serve.zsh` to `./serve.sh`
- [x] 2.4 Update `HeartReverie_Plugins/README.md` (cross-repo): change `zsh ./serve.zsh` to `./serve.sh`
- [x] 2.5 Update `.containerignore`: change `serve.zsh` to `serve.sh`

## 3. OpenSpec Main Specs Updates

- [x] 3.1 Update `openspec/specs/unified-server/spec.md`: change `serve.zsh` references to `serve.sh`
- [x] 3.2 Update `openspec/specs/deno-migration/spec.md`: change `serve.zsh` references to `serve.sh`
- [x] 3.3 Update `openspec/specs/containerization/spec.md`: change `serve.zsh` to `serve.sh` (will be handled by delta spec sync)
- [x] 3.4 Update `openspec/specs/container-file-permissions/spec.md`: change `serve.zsh` to `serve.sh` (will be handled by delta spec sync)

## 4. Verification

- [x] 4.1 Verify `serve.sh` is executable and has correct shebang (`#!/usr/bin/env bash`)
- [x] 4.2 Verify no remaining references to `serve.zsh` in the codebase (excluding archive)

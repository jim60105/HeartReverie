## 1. Containerfile UID Update

- [x] 1.1 Change `ARG UID=1001` to `ARG UID=1000` in the root `Containerfile` (line 3)

## 2. Backend Runtime Permissions — Directory Creation

- [x] 2.1 Add `mode: 0o775` to `Deno.mkdir()` in `writer/lib/chat-shared.ts` (line 161)
- [x] 2.2 Add `mode: 0o775` to `Deno.mkdir()` in `writer/routes/chapters.ts` (line 135)
- [x] 2.3 Add `mode: 0o775` to `Deno.mkdir()` in `writer/routes/lore.ts` (line 311)
- [x] 2.4 Add `mode: 0o775` to `Deno.mkdir()` in `writer/routes/prompt.ts` (line 70)

## 3. Backend Runtime Permissions — File Creation

- [x] 3.1 Add `mode: 0o664` to `Deno.open()` in `writer/lib/chat-shared.ts` (line 178)
- [x] 3.2 Add `mode: 0o664` to `Deno.writeTextFile()` in `writer/routes/chapters.ts` (line 140)
- [x] 3.3 Add `mode: 0o664` to `Deno.writeTextFile()` in `writer/routes/lore.ts` (line 313)
- [x] 3.4 Add `mode: 0o664` to `Deno.writeTextFile()` in `writer/routes/prompt.ts` (line 71)

## 4. Entrypoint and Shell Scripts

- [x] 4.1 Add `umask 002` to `entrypoint.sh` after `set -eu` and before any file operations
- [x] 4.2 Add `chmod 664 "$CERT_FILE"` and `chmod 660 "$KEY_FILE"` after `openssl` cert generation in `entrypoint.sh`
- [x] 4.3 Mark `entrypoint.sh` as executable in git via `git update-index --chmod=+x entrypoint.sh`
- [x] 4.4 Mark `serve.zsh` as executable in git via `git update-index --chmod=+x serve.zsh`

## 5. Verification

- [x] 5.1 Run `deno task test:backend` to verify no regressions in existing tests
- [x] 5.2 Verify `git ls-files -s entrypoint.sh serve.zsh` shows `100755` for both scripts
- [x] 5.3 Verify `entrypoint.sh` contains `umask 002` before any file-creating commands and `chmod 664` after cert generation

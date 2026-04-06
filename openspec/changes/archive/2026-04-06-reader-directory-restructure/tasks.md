## 1. Create reader directory and move files

- [x] 1.1 Create `reader/` directory at project root
- [x] 1.2 `git mv index.html reader/index.html`
- [x] 1.3 `git mv js/ reader/js/`
- [x] 1.4 `git mv serve.zsh reader/serve.zsh`

## 2. Update serve.zsh

- [x] 2.1 Update `SERVE_ROOT` in `serve.zsh` to use `${0:a:h}` (script's own directory) instead of `${PWD}`, so the dev server always serves `reader/` regardless of where it is invoked from
- [x] 2.2 Move `.certs/` reference — cert dir already uses `${0:a:h}/.certs` so it moves automatically with the script; verify this is correct

## 3. Verify and update references

- [x] 3.1 Verify all JS module imports in `reader/index.html` still resolve (they use relative `./js/` paths which stay valid)
- [x] 3.2 Verify CDN links (Tailwind, marked.js, Google Fonts) are absolute URLs and unaffected
- [x] 3.3 Update `README.md` to reflect new `reader/` directory structure

## 4. Validation

- [x] 4.1 Start dev server from new location and verify the app loads correctly
- [x] 4.2 Verify story folder selection and chapter navigation still work

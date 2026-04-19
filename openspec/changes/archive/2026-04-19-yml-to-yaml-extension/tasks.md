## 1. Workflow files

- [x] 1.1 `git mv .github/workflows/copilot-setup-steps.yml .github/workflows/copilot-setup-steps.yaml`
- [x] 1.2 `git mv .github/workflows/docker-publish-latest.yml .github/workflows/docker-publish-latest.yaml`
- [x] 1.3 `git mv .github/workflows/docker-reused-setup-steps/action.yml .github/workflows/docker-reused-setup-steps/action.yaml`
- [x] 1.4 `git mv .github/workflows/release.yml .github/workflows/release.yaml`
- [x] 1.5 Grep workflow files for any cross-references to the renamed filenames and update them

## 2. Playground data files

- [x] 2.1 `git mv playground/悠奈悠花姊妹大冒險/init-status.yml playground/悠奈悠花姊妹大冒險/init-status.yaml`
- [x] 2.2 Rename every `playground/**/current-status.yml` to `current-status.yaml` (seven story directories)

## 3. Backend code string literals

- [x] 3.1 `writer/routes/ws.ts`: replace `current-status.yml` with `current-status.yaml` (line ~326)
- [x] 3.2 `writer/routes/chapters.ts`: replace `current-status.yml` with `current-status.yaml` (lines ~159, ~237, ~316)
- [x] 3.3 `writer/routes/branch.ts`: update `current-status.yml` in the comment (line ~166)
- [x] 3.4 `plugins/context-compaction/config.ts`: replace `compaction-config.yml` with `compaction-config.yaml` (line ~32)
- [x] 3.5 Run a final `grep -rn "\.yml" writer/ plugins/` sweep to catch any remaining references and update them

## 4. Tests

- [x] 4.1 `tests/plugins/context-compaction/config_test.ts`: update every `compaction-config.yml` reference (fixtures + assertions)
- [x] 4.2 `tests/plugins/context-compaction/handler_test.ts`: update `compaction-config.yml` reference (line ~104)
- [x] 4.3 Run a final `grep -rn "\.yml" tests/` sweep and update any remaining references

## 5. Gitignore

- [x] 5.1 Update root `.gitignore`: change `**/current-status.yml` to `**/current-status.yaml`

## 6. Documentation

- [x] 6.1 `docs/prompt-template.md`: update all `.yml` references to `.yaml`
- [x] 6.2 `plugins/context-compaction/README.md`: update `compaction-config.yml` references
- [x] 6.3 `AGENTS.md`: update any `.yml` references (if present)
- [x] 6.4 Grep the rest of `docs/` and root `*.md` files for `.yml` and update survivors

## 7. OpenSpec active specs

- [x] 7.1 `openspec/specs/context-compaction/spec.md`: rename `compaction-config.yml` → `compaction-config.yaml` in the "Compaction configuration" requirement and its scenarios
- [x] 7.2 `openspec/specs/vento-prompt-template/spec.md`: rename `current-status.yml` / `init-status.yml` → `.yaml` in the `status_data` scenario
- [x] 7.3 `openspec/specs/gitignore-config/spec.md`: update the `**/current-status.yml` pattern in the "Merged gitignore content" scenario

## 8. Verification

- [x] 8.1 Run `deno task test` (backend + frontend) — all must pass
- [x] 8.2 Run `deno test --allow-read --allow-write --allow-env --allow-net tests/plugins/` — plugin tests must pass
- [x] 8.3 Final repo-wide check: `rg "\.yml\b" --type-add 'all:*.{ts,js,vue,md,json,sh,yaml,css}' -tall . -g '!node_modules' -g '!openspec/changes/archive' -g '!openspec/changes/yml-to-yaml-extension'` plus `grep "\.yml" .gitignore` — no remaining `.yml` references in repo-owned files (excluding archived changes and the active change artifacts)
- [x] 8.4 Run `openspec validate yml-to-yaml-extension --strict` — must pass
- [ ] 8.5 Start the dev server (`./serve.sh`) and confirm a story loads, a chat round completes, and `current-status.yaml` is written correctly

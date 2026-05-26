## 1. Commit 1 — `chore(deno): codify fmt + lint configuration`

Config-only commit. No source changes. No CI changes. Cannot break the build.

- [x] 1.1 Add a top-level `fmt` block to `deno.json` using the exact `useTabs`/`indentWidth`/`lineWidth`/`singleQuote`/`semiColons`/`proseWrap` values from `design.md` Decision 1. Use the **extension-glob** `include` list (`**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`, `**/*.json`, `**/*.jsonc`, `**/*.yaml`, `**/*.yml`, `**/*.css`) and the comprehensive `exclude` list (`**/*.md`, `**/node_modules/`, `**/vendor/`, `reader-dist/`, `coverage/`, `coverage.lcov`, `playground/`, `themes/`, `helm/heart-reverie/templates/`, `openspec/changes/archive/`). The `helm/heart-reverie/templates/` exclusion is required because Helm chart templates contain Go template syntax that is not parseable as YAML and would cause `deno fmt` to error.
- [x] 1.2 Add a top-level `lint` block to `deno.json` with `rules.tags: ["recommended"]`, `rules.exclude: ["require-await", "no-import-prefix", "no-unversioned-import"]` (the latter two are excluded for cross-repo policy alignment with `HeartReverie_Plugins`; core source currently has zero direct `jsr:`/`npm:` imports so the exclusions are defensive — see `design.md` Decision 2), `include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]`, and the same comprehensive `exclude` paths as `fmt` minus the JSON/YAML/CSS-only entries (`**/node_modules/`, `**/vendor/`, `reader-dist/`, `coverage/`, `playground/`, `themes/`, `openspec/changes/archive/`).
- [x] 1.3 Add three new entries to the `tasks` block in `deno.json`: `"fmt": "deno fmt"`, `"fmt:check": "deno fmt --check"`, `"lint": "deno lint"`.
- [x] 1.4 Validate JSON: `deno task --help` SHALL list all tasks including the new ones without error.
- [x] 1.5 Commit with message `chore(deno): codify fmt + lint configuration`. Do NOT add the CI job in this commit. Do NOT run `deno fmt` write in this commit.

## 2. Commit 2 — `style: apply deno fmt baseline`

Mechanical reformat commit. No logic changes. Reviewable as pure `deno fmt` output.

- [x] 2.1 From a clean working tree at HEAD of commit 1, run `deno task fmt`. Expect a large but mechanical diff (the earlier 275-file baseline was measured against a directory-allow-list `include`; the new extension-glob `include` may move the file count up or down — `git diff --stat` is the authoritative measure on the implementer's branch).
- [x] 2.2 Run `git diff --stat` and confirm the changes are confined to paths permitted by `fmt.include` and not in `fmt.exclude`: no `**/*.md` files, no paths under `playground/`, `themes/`, `reader-dist/`, `coverage/`, `**/node_modules/`, `**/vendor/`, `helm/heart-reverie/templates/`, or `openspec/changes/archive/`. The active `openspec/config.yaml` and `openspec/changes/<active-change>/.openspec.yaml` are intentionally in scope.
- [x] 2.3 Spot-check a handful of files (at least one in `writer/`, one in `reader-src/src/`, one in `plugins/`, one in `tests/`) to confirm the diff is whitespace/wrapping/quote-style only — NO identifier renames, control-flow edits, or logic changes.
- [x] 2.4 Run `deno task fmt:check` — MUST exit 0.
- [x] 2.5 Run `deno task test` — MUST exit 0 (regression check: the reformat MUST NOT break any test).
- [x] 2.6 Commit with message `style: apply deno fmt baseline`. Single isolated commit; no other changes.

## 3. Commit 3 — `chore(deno): wire fmt + lint into CI`

Final commit. Lands only when both `deno task fmt:check` and `deno task lint` exit 0 locally.

### 3.1 Lint fixes and ignores (per `design.md` Decision 2)

- [x] 3.1.1 `require-await` (471 hits), `no-import-prefix`, and `no-unversioned-import`: already excluded in `deno.json` `lint.rules.exclude` from commit 1 — no source changes needed.
- [x] 3.1.2 `no-window` (17 hits in `plugins/` and `reader-src/`): **fix at source** by rewriting `window.*` references to `globalThis.*`. `globalThis` is semantically equivalent in these browser-and-Deno-compatible contexts and removes the need for 17 per-site `// deno-lint-ignore` comments. (The implementation pass rewrote 25 sites in total when combined with `no-window-prefix` below.)
- [x] 3.1.3 `no-window-prefix` (8 hits): **fix at source** by rewriting `window.<prefix>` to `globalThis.<prefix>`. Same justification as `no-window`.
- [x] 3.1.4 `no-control-regex` (7 hits): add `// deno-lint-ignore no-control-regex -- deliberate control-character sanitization` at each call site.
- [x] 3.1.5 `no-unused-vars` (4 hits): delete the unused binding, or rename with leading `_` if it documents an intentional ignore.
- [x] 3.1.6 `no-explicit-any` (3 hits): replace with a precise type or `unknown`. Where it sits inside a deliberate test cast (`as any`), narrow the cast or annotate with `// deno-lint-ignore no-explicit-any -- intentional test mock cast`.
- [x] 3.1.7 `prefer-const` (2 hits): run `deno lint --fix` for these; verify the diff is just `let` → `const`.
- [x] 3.1.8 `no-inner-declarations` (2 hits): hoist the declaration to module/function scope.
- [x] 3.1.9 Run `deno task lint` — MUST exit 0.
- [x] 3.1.10 Run `deno task fmt:check` — MUST still exit 0 after any source edits above (re-run `deno task fmt` if needed).
- [x] 3.1.11 Run `deno task test` — MUST exit 0.

### 3.2 Wire into CI

- [x] 3.2.1 In `.github/workflows/ci.yaml`, add a new job `fmt-lint` parallel to the existing `test` job. Reuse the same `actions/checkout@v6`, `denoland/setup-deno@v2` (with `deno-version: v2.x`), and `actions/cache@v5` (with the existing `~/.cache/deno` + `~/.deno` paths and `deno.lock`-keyed cache) steps as the `test` job.
- [x] 3.2.2 In the new `fmt-lint` job, add a step that runs `deno task fmt:check`.
- [x] 3.2.3 In the new `fmt-lint` job, add a step that runs `deno task lint`.
- [x] 3.2.4 Keep the same `on:` triggers as the rest of the workflow (`push` to `master`, `pull_request` against `master`, `workflow_dispatch`). Do NOT add a `needs:` dependency between `fmt-lint` and `test` — they SHALL run in parallel.

### 3.3 Document in AGENTS.md

- [x] 3.3.1 In the root `AGENTS.md` of the `HeartReverie/` subproject, add a `### Before finalizing a change` subsection at the end of the existing `## Code Style` section. It MUST state: contributors (human and AI) MUST run `deno task fmt` and `deno task lint` before declaring an implementation complete; CI runs both via `deno fmt --check` and `deno lint` in the `fmt-lint` job on every PR/push, and either command exiting non-zero marks the build red on the PR's checks list. It MUST also note that branch-protection rulesets that would turn a red build into a hard merge block are recommended but not part of this change (they require repo-admin action). It SHOULD additionally state a **suppression-hygiene** rule scoped to *new* suppressions: any newly added `// deno-lint-ignore <rule>` directive MUST include a trailing `-- <reason>` comment; this rule applies only to suppressions introduced going forward and does NOT retroactively require pre-existing untouched suppressions elsewhere in the tree to be cleaned up. Use the same subsection title and parallel wording as the sibling `HeartReverie_Plugins` repo's AGENTS.md.
- [x] 3.3.2 In the same subsection, note the scope: `deno fmt` and `deno lint` are configured against extension globs (`**/*.{ts,tsx,js,jsx,json,jsonc,yaml,yml,css}` for fmt; `**/*.{ts,tsx,js,jsx}` for lint) with a comprehensive `exclude` covering Markdown, user story data in `playground/`, prompt content in `themes/`, generated `reader-dist/`, `coverage/`, vendored code (`**/vendor/`), `**/node_modules/`, and `openspec/changes/archive/`. Markdown is intentionally never reformatted.
- [x] 3.3.3 In the same section, note the **Vue gap** (per `design.md` Decision 6): `deno fmt` does not format `.vue` SFCs and `deno lint` does not lint them; `vue-tsc` and Vitest cover Vue files. Style inside `<script setup>` blocks relies on review.
- [x] 3.3.4 Cross-reference: if the existing AGENTS.md has a "before committing" / "definition of done" style checklist, append the two commands there as well.

### 3.4 Land the commit

- [x] 3.4.1 Commit with message `chore(deno): wire fmt + lint into CI`.
- [x] 3.4.2 Push the branch and confirm the new CI `fmt-lint` job appears, runs, and passes alongside the existing `test` job.

## 4. Verify end-to-end

- [x] 4.1 From a clean checkout at the tip of commit 3, run `deno task fmt:check && deno task lint` — both MUST exit 0.
- [x] 4.2 On a throwaway local branch, introduce an intentional formatting issue (e.g., remove a trailing comma in a multi-line literal) and confirm `deno task fmt:check` exits non-zero with a clear file:line report. Revert.
- [x] 4.3 On a throwaway local branch, introduce an intentional lint violation (e.g., add `var x: any = 1` to a TS file under `writer/`) and confirm `deno task lint` exits non-zero. Revert.
- [x] 4.4 Confirm `deno fmt` did not modify any file under `playground/`, `themes/`, `openspec/changes/archive/`, `docs/` (`.md` excluded globally), `reader-dist/`, `coverage/`, `**/node_modules/`, or `**/vendor/` (`git status` + `git diff --name-only` after step 4.1).
- [x] 4.5 Run `openspec validate setup-fmt-lint-config --strict` and confirm it passes before archiving.

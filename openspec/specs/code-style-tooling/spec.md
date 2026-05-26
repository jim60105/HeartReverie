# code-style-tooling Specification

## Purpose
TBD - created by archiving change setup-fmt-lint-config. Update Purpose after archive.
## Requirements
### Requirement: deno.json SHALL declare an explicit fmt configuration that codifies the existing code style

The repository's `deno.json` SHALL contain a top-level `fmt` block that sets `useTabs: false`, `indentWidth: 2`, `lineWidth: 100`, `singleQuote: false`, `semiColons: true`, and `proseWrap: "preserve"`. The `fmt.include` list SHALL be an extension-glob list containing exactly `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`, `**/*.json`, `**/*.jsonc`, `**/*.yaml`, `**/*.yml`, and `**/*.css` (matching the sibling `HeartReverie_Plugins` repo). The `fmt.exclude` list SHALL exclude all Markdown files (`**/*.md`), `**/node_modules/`, `**/vendor/`, `reader-dist/`, `coverage/`, `coverage.lcov`, `playground/`, `themes/`, `helm/heart-reverie/templates/` (Helm chart templates use Go template syntax that is not parseable as YAML), and `openspec/changes/archive/`.

#### Scenario: deno fmt --check passes on a clean tree
- **WHEN** a contributor runs `deno fmt` on a clean checkout and then runs `deno fmt --check`
- **THEN** the command SHALL exit with code 0 and report no files needing changes

#### Scenario: deno fmt does not touch Markdown files
- **WHEN** `deno fmt` is invoked at the repository root
- **THEN** no file with the `.md` extension SHALL be modified, including files in `docs/`, `themes/`, `plugins/`, `playground/`, `openspec/`, and the repository root (`README.md`, `CHANGELOG.md`, `AGENTS.md`, `system.md`)

#### Scenario: deno fmt does not touch user story data
- **WHEN** `deno fmt` is invoked at the repository root
- **THEN** no file inside `playground/` SHALL be modified

#### Scenario: deno fmt does not touch generated or vendored output
- **WHEN** `deno fmt` is invoked at the repository root
- **THEN** no file inside `reader-dist/`, `coverage/`, `**/node_modules/`, `**/vendor/`, `helm/heart-reverie/templates/`, or `openspec/changes/archive/` SHALL be modified

#### Scenario: deno fmt covers the frontend bootstrap script and source-adjacent configs
- **WHEN** `deno fmt --check` is invoked at the repository root and one of `reader-src/public/theme-boot.js`, `reader-src/tsconfig.json`, or a file under `.github/workflows/` contains formatting drift
- **THEN** the command SHALL exit non-zero and identify the offending file

#### Scenario: deno fmt does NOT enforce .vue SFC formatting
- **WHEN** `deno fmt` is invoked at the repository root
- **THEN** no file with the `.vue` extension SHALL be modified, because Deno's stable formatter does not handle Vue Single-File Components; `.vue` formatting is explicitly out of scope for this capability

### Requirement: deno.json SHALL declare an explicit lint configuration scoped to source code

The repository's `deno.json` SHALL contain a top-level `lint` block. The `lint.rules.tags` array SHALL include `"recommended"`. The `lint.rules.exclude` array SHALL include exactly `"require-await"`, `"no-import-prefix"`, and `"no-unversioned-import"` (the codebase intentionally uses `async` signatures for interface conformance, and pins explicit-version `jsr:`/`npm:` specifiers as project policy; this exclusion list is aligned with the sibling `HeartReverie_Plugins` repo). The `lint.include` list SHALL contain exactly `**/*.ts`, `**/*.tsx`, `**/*.js`, and `**/*.jsx`. The `lint.exclude` list SHALL exclude `**/node_modules/`, `**/vendor/`, `reader-dist/`, `coverage/`, `playground/`, `themes/`, and `openspec/changes/archive/`.

#### Scenario: deno lint runs successfully
- **WHEN** a contributor runs `deno lint` at the repository root
- **THEN** the command SHALL execute against the configured `lint.include` paths and SHALL exit with code 0

#### Scenario: deno lint does not flag intentional async signatures
- **WHEN** `deno lint` is invoked and source files contain `async` functions without `await` (e.g., route handlers, plugin hooks, mock fetch responses)
- **THEN** the `require-await` rule SHALL NOT raise any diagnostic, because it is excluded in `lint.rules.exclude`

#### Scenario: deno lint does not flag explicit-version jsr:/npm: imports
- **WHEN** `deno lint` is invoked and source files contain direct `jsr:@scope/pkg@^x.y.z` or `npm:pkg@^x.y.z` import specifiers
- **THEN** the `no-import-prefix` and `no-unversioned-import` rules SHALL NOT raise any diagnostic, because they are excluded in `lint.rules.exclude`

#### Scenario: deno lint does not scan user story data or generated output
- **WHEN** `deno lint` is invoked
- **THEN** no file inside `playground/`, `themes/`, `reader-dist/`, `coverage/`, `**/node_modules/`, `**/vendor/`, or `openspec/changes/archive/` SHALL be scanned

#### Scenario: deno lint does NOT cover .vue SFCs
- **WHEN** `deno lint` is invoked at the repository root
- **THEN** no `.vue` file SHALL be linted, because Deno's linter does not parse Vue Single-File Components; Vue type/behaviour coverage is delegated to `vue-tsc` (run via `deno task build:reader`) and Vitest

### Requirement: deno.json SHALL expose fmt and lint as named tasks

The `deno.json` `tasks` block SHALL define three tasks: `fmt` (runs `deno fmt`), `fmt:check` (runs `deno fmt --check`), and `lint` (runs `deno lint`). Contributors SHALL be able to invoke each via `deno task <name>` from the repository root.

#### Scenario: Contributor formats the tree
- **WHEN** a contributor runs `deno task fmt`
- **THEN** the command SHALL execute `deno fmt` using the configuration from `deno.json` and SHALL exit with code 0 on success

#### Scenario: Contributor lints the tree
- **WHEN** a contributor runs `deno task lint`
- **THEN** the command SHALL execute `deno lint` using the configuration from `deno.json` and SHALL exit with code 0 when no lint violations are present

### Requirement: CI SHALL run fmt and lint on every push and pull request

The GitHub Actions CI workflow (`.github/workflows/ci.yaml`) SHALL include a job that runs `deno task fmt:check` followed by `deno task lint`. The job SHALL run on the same triggers as the existing `test` job (push to `master`, pull requests targeting `master`, and `workflow_dispatch`) and SHALL exit non-zero — marking the build red on the pull request's checks list — if either command exits non-zero. Whether a red build is also a hard merge block is governed by GitHub branch-protection rulesets, which are RECOMMENDED but are NOT part of this capability (they require repo-admin configuration and are explicitly out of scope here).

#### Scenario: CI marks the build red on a pull request with formatting drift
- **WHEN** a pull request is opened that contains a file not formatted according to `deno.json`'s `fmt` configuration
- **THEN** the CI `fmt-lint` job SHALL exit non-zero and SHALL be reported as a failing check on the pull request

#### Scenario: CI marks the build red on a pull request with lint violations
- **WHEN** a pull request is opened that introduces a lint violation under the configured rule set
- **THEN** the CI `fmt-lint` job SHALL exit non-zero and SHALL be reported as a failing check on the pull request

### Requirement: AGENTS.md SHALL document the fmt and lint contributor workflow

The root `AGENTS.md` SHALL contain a `### Before finalizing a change` subsection (under the existing `## Code Style` section) that instructs contributors (both human and AI agents) to run `deno task fmt` and `deno task lint` before finalizing any implementation, and that notes CI runs both checks (`deno fmt --check` and `deno lint`) on every PR/push with failures marking the build red. The subsection SHALL note that branch-protection rulesets that would turn a red build into a hard merge block are recommended but are not part of this change (they require repo-admin action). The subsection title and wording SHALL be parallel to the sibling `HeartReverie_Plugins` repo's AGENTS.md so contributors see a consistent workflow across both codebases. The subsection SHALL state that the configured set covers source files only and that Markdown is intentionally excluded. The subsection SHALL also state a **suppression-hygiene** rule scoped to *new* suppressions: any newly added `// deno-lint-ignore <rule>` directive MUST include a trailing `-- <reason>` comment explaining why; this rule applies only to suppressions introduced by changes going forward and does NOT retroactively require pre-existing untouched suppressions elsewhere in the tree to be cleaned up.

#### Scenario: Contributor reads AGENTS.md before submitting a change
- **WHEN** a contributor opens `AGENTS.md` at the repository root
- **THEN** they SHALL find a `### Before finalizing a change` subsection that names both `deno task fmt` and `deno task lint` as required pre-commit steps, names the CI commands (`deno fmt --check`, `deno lint`), states that failures mark the build red (without claiming the build is a hard merge block), notes that Markdown is excluded from the configured scope, and states the suppression-hygiene rule that newly added `// deno-lint-ignore` directives must carry a `-- <reason>` comment


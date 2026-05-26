## Why

The repository has **no `fmt` or `lint` configuration** in `deno.json` and **no fmt/lint task** in `deno task`, despite the code being written in a consistent house style (2-space indent, double quotes, semicolons, trailing commas in multi-line constructs). CI runs `test` and `build:reader` only — drift in formatting and lint hygiene is currently impossible to catch automatically. Codifying the existing style and wiring it into CI prevents future drift and gives contributors a single trusted command to run before opening a PR.

## What Changes

- Add an explicit `fmt` section to `deno.json` that codifies the **existing** style and restricts `deno fmt` to source code files only — Markdown (`*.md`), the `CHANGELOG.md`, lore content, story content, and generated/vendored output are excluded so prose files and user data are never reformatted.
- Add an explicit `lint` section to `deno.json` with the recommended rule set, scoped to source code only (excluding generated dist, vendored code, coverage output, `node_modules`, and `playground/`).
- Add two new tasks: `deno task fmt` (formats) and `deno task lint` (lints). Add `deno task fmt:check` for CI use (non-mutating verification).
- Add a `fmt-lint` job to `.github/workflows/ci.yaml` that runs `deno fmt --check` and `deno lint` on every push and PR. The job runs in CI on every PR/push and a failing run marks the build red on the PR's checks list; turning a red build into a hard merge block requires branch-protection rulesets, which are recommended but are **not** part of this change (they require repo-admin action).
- Update `AGENTS.md` with a "Code style & lint" section instructing contributors (human and AI) to run `deno task fmt` and `deno task lint` before finalizing any implementation, and noting that CI enforces both.

## Capabilities

### New Capabilities
- `dev-tooling-format-lint`: Repository-wide formatting and lint policy — what `deno fmt`/`deno lint` cover, how they are configured, and how they are enforced (locally via `deno task` and in CI).

### Modified Capabilities
<!-- None. This is a tooling/DX addition; no existing functional spec changes its requirements. -->

## Impact

- **Config**: `deno.json` — new top-level `fmt` and `lint` keys; two new entries in `tasks`.
- **CI**: `.github/workflows/ci.yaml` — new `fmt-lint` job that runs `deno fmt --check` and `deno lint` in CI on every PR/push; either command exiting non-zero marks the build red on the PR's checks list. Branch-protection rulesets that would turn a red build into a hard merge block are recommended but are **not** enabled today and are out of scope for this change (they require repo-admin action).
- **Docs**: `AGENTS.md` — new "Code style & lint" section under the existing tooling/workflow guidance.
- **Codebase**: A one-time `deno fmt` run produces a substantial normalization diff (see "Measured drift" below) — the codebase has never been run through `deno fmt`. The diff is purely whitespace/quote/paren-grouping and contains **no logic changes**. Because the project is pre-release with no external users, no migration or backward-compat concerns apply.
- **No runtime impact**: No production code, dependencies, or APIs change.

## Measured drift (verified against current `master`)

Running the proposed config (see `design.md` Decisions 1 & 2) against the tree as-is:

- **`deno fmt --check`**: **275 files** need formatting out of 458 checked. Drift is overwhelmingly whitespace/wrapping (Deno's formatter rewrites multi-line chained expressions and parenthesizes for clarity).
- **`deno lint`**: **514 diagnostics** in 390 files, broken down by rule:
  | Rule | Count | Where |
  |---|---:|---|
  | `require-await` | 471 | `tests/writer` (296), `reader-src/src` (166), other (9) |
  | `no-window` | 17 | `plugins/` (13), `reader-src/` (4) |
  | `no-window-prefix` | 8 | `plugins/` (7), `reader-src/` (1) |
  | `no-control-regex` | 7 | `reader-src/src` (3), `writer/lib` (2), `writer/routes` (2) |
  | `no-unused-vars` | 4 | `reader-src/src/**/__tests__` (3), `tests/writer` (1) |
  | `no-explicit-any` | 3 | tests / plugins |
  | `prefer-const` | 2 | `plugins/reading-progress` |
  | `no-inner-declarations` | 2 | `plugins/reading-progress`, `tests/writer` |

> **Note on baseline numbers.** The counts above were measured against an earlier directory-allow-list `include` configuration. The final config (see `design.md` Decision 1, post cross-repo alignment) switches to extension globs (`**/*.{ts,tsx,js,jsx,json,jsonc,yaml,yml,css}`) with a comprehensive `exclude`. The implementer SHALL re-run `deno fmt --check` and `deno lint` against the glob-based config before commit 2 and record any deltas. Order-of-magnitude expectations remain the same: hundreds of fmt edits dominated by whitespace, and ~514 lint diagnostics dominated by `require-await` (which is now excluded by config alongside `no-import-prefix` and `no-unversioned-import`).

Because of these numbers, **landing the config and CI gate in a single commit would break `master`'s CI immediately**. The rollout is split into three sequential commits (see `tasks.md`):

1. `chore(deno): codify fmt + lint configuration` — config only, no enforcement.
2. `style: apply deno fmt baseline` — bulk `deno fmt` output across affected source files (~275 files, no logic changes).
3. `chore(deno): wire fmt + lint into CI` — lint fixes / justified rule exclusions, CI job, AGENTS.md note. Only lands once `deno fmt --check && deno lint` both exit 0.

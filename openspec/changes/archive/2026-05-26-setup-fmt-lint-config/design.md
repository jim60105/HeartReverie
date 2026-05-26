## Context

The repository is a Deno-based monorepo with two main TypeScript surfaces (`writer/` backend on Deno + Hono, `reader-src/` Vue 3 SPA bundled with Vite), a `plugins/` directory of TS modules, `scripts/` for build/coverage tooling, and `tests/` with Deno's test runner. Markdown is a first-class **content** format — `playground/` holds user story data, `themes/` and `plugins/*` ship Markdown prompt templates, and `docs/` + `openspec/` hold prose docs. The codebase **already has** a consistent style; we just lack the config to enforce it.

Investigation summary:

- `deno.json` has `compilerOptions` and `tasks` but **no `fmt` or `lint` block** at all.
- No `.editorconfig`, no `.prettierrc*`, no ESLint config, no Husky/lefthook/pre-commit configs.
- CI (`.github/workflows/ci.yaml`) currently runs only `deno task build:reader`, `deno task test`, and the coverage job. **No formatting or lint check.**
- Observed style across `writer/`, `reader-src/src/`, `scripts/`, and `*.vue` files:
  - **Indent**: 2 spaces (no tabs found in source files).
  - **Quotes**: double quotes dominate (≈10,736 vs ≈576 single quotes in `writer/` + `reader-src/src`); single quotes appear mostly in `'use strict'`-style strings or generated/vendored code.
  - **Semicolons**: present everywhere.
  - **Trailing commas**: used in multi-line object/array/parameter lists (see `StorySelector.vue`, `app.ts`).
  - **Line length**: most lines well under 100; a few function signatures push 100–172 cols.

These align with Deno's defaults except for `singleQuote` (Deno default is `false` already, matching us) and `lineWidth` (Deno default is `80`). To minimize churn, we'll set `lineWidth: 100` to accommodate the existing wider lines without forcing a sweeping reflow.

**Cross-repo alignment.** This proposal is coordinated with the sibling `HeartReverie_Plugins` repo's `setup-deno-fmt-lint` change. Both repos pin **identical** fmt/lint option values (including `lineWidth: 100`, glob-based `include`, and a unified `lint.rules.exclude` triple) so that contributors, editors, and CI behave the same across both codebases. Per-repo divergence is limited to physical paths that only exist in one repo (e.g. `playground/`, `themes/`, `reader-dist/` exist only in core; `.forgejo/workflows/` exists only in plugins).

## Goals / Non-Goals

**Goals:**
- Codify the existing style explicitly in `deno.json` so `deno fmt` is a no-op (or near-no-op) on the current code.
- Make `deno fmt` only touch **source code files** — never Markdown, never the user-data `playground/`, never generated output (`reader-dist/`, `coverage/`, `node_modules/`).
- Wire `deno fmt --check` + `deno lint` into CI so drift is caught at PR time.
- Document the contributor workflow in `AGENTS.md`: run `deno task fmt && deno task lint` before declaring a task done.

**Non-Goals:**
- Reformatting prose/Markdown. We rely on author discipline for prose.
- Introducing Prettier, ESLint, EditorConfig, or any non-Deno tool.
- Adding pre-commit/Husky hooks (out of scope; CI is sufficient).
- Adopting a Vue-aware linter (e.g., `eslint-plugin-vue`) or enabling `deno fmt --unstable-component` for `.vue` SFCs. See "Vue lint/fmt gap" below.

## Decisions

### Decision 1 — `fmt` configuration values

```jsonc
"fmt": {
  "useTabs": false,
  "lineWidth": 100,
  "indentWidth": 2,
  "singleQuote": false,
  "semiColons": true,
  "proseWrap": "preserve",
  "include": [
    "**/*.ts",
    "**/*.tsx",
    "**/*.js",
    "**/*.jsx",
    "**/*.json",
    "**/*.jsonc",
    "**/*.yaml",
    "**/*.yml",
    "**/*.css"
  ],
  "exclude": [
    "**/*.md",
    "**/node_modules/",
    "**/vendor/",
    "reader-dist/",
    "coverage/",
    "coverage.lcov",
    "playground/",
    "themes/",
    "helm/heart-reverie/templates/",
    "openspec/changes/archive/"
  ]
}
```

**Rationale:**
- `lineWidth: 100` — matches what the code already does (most lines fit; a small number exceed 80). Setting `80` would force a large reflow with no real benefit. **Cross-repo alignment:** identical to the plugins repo (`setup-deno-fmt-lint`); since `lineWidth` is a *maximum*, raising the plugins repo's previous 80 cap to 100 causes zero reflow in plugins while allowing core's existing >80 lines to stay intact.
- `singleQuote: false`, `semiColons: true`, `indentWidth: 2`, `useTabs: false` — verified from sampling actual source.
- `proseWrap: "preserve"` — defensive; Markdown is excluded entirely anyway, but this preserves any prose inside JSDoc/comments.
- **`include` uses extension globs** (not a directory allow-list). This is a **coordinated cross-repo decision** with the plugins repo: both codebases use the same `**/*.{ts,tsx,js,jsx,json,jsonc,yaml,yml,css}` glob set so the configuration is byte-for-byte equivalent across repos. The previous directory allow-list was safer-by-default but caused two real problems: (a) every new top-level source directory required a config update, and (b) it diverged from the plugins repo's idiom and obscured cross-repo review. Safety is preserved via a comprehensive `exclude` list (below) rather than via a narrow `include`.
- **Covered files under the new globs** (verified against the current tree): `writer/**/*.ts`, `reader-src/src/**/*.{ts,vue→excluded by Deno,…}`, `reader-src/public/theme-boot.js` (via `**/*.js`), `reader-src/tsconfig.json` and `reader-src/*.ts` (via `**/*.json` and `**/*.ts`), `plugins/**`, `scripts/**`, `tests/**`, `.github/workflows/*.yaml` (via `**/*.yaml`), `deno.json` (via `**/*.json`), and `openspec/config.yaml` + per-change `.openspec.yaml` (via `**/*.yaml`, with archived changes excluded). The previous `reader-src/*.html` entry is dropped because `deno fmt` does not format HTML in its stable channel — that line was an effective no-op.
- **`exclude` is comprehensive** and explicitly guards `playground/` (user story data), `themes/` (prompt content), `reader-dist/` (generated SPA build), `coverage/` + `coverage.lcov`, `**/node_modules/`, `**/vendor/`, `helm/heart-reverie/templates/` (Helm chart templates contain Go template syntax that is not parseable as YAML and would crash `deno fmt`), and `openspec/changes/archive/`. `**/*.md` is excluded outright so Markdown is never reformatted. `openspec/` itself is **not** wholesale-excluded any more (only `openspec/changes/archive/`); the OpenSpec yaml files in `openspec/config.yaml` and active change directories are now in scope, matching plugins.

### Decision 2 — `lint` configuration values

```jsonc
"lint": {
  "rules": {
    "tags": ["recommended"],
    "exclude": ["require-await", "no-import-prefix", "no-unversioned-import"]
  },
  "include": [
    "**/*.ts",
    "**/*.tsx",
    "**/*.js",
    "**/*.jsx"
  ],
  "exclude": [
    "**/node_modules/",
    "**/vendor/",
    "reader-dist/",
    "coverage/",
    "playground/",
    "themes/",
    "openspec/changes/archive/"
  ]
}
```

**Cross-repo alignment for `lint.rules.exclude`.** The exclusion list is the **union** of both repos' justified exclusions, applied uniformly so the lint contract is identical across core and plugins:

- `require-await` — both repos use `async` signatures for interface/hook conformance (route handlers, plugin hooks, mock fetch responses). See the measured baseline below.
- `no-import-prefix` and `no-unversioned-import` — both repos pin explicit-version `jsr:@std/...@^x.y.z` / `npm:pkg@^x.y.z` specifiers as project policy. In **core**, all source imports go through the `imports` map in `deno.json` (verified at proposal time: zero direct `from "jsr:…"` / `from "npm:…"` statements in source under `writer/`, `reader-src/src/`, `plugins/`, `scripts/`, `tests/`); the two rules therefore produce zero diagnostics on the core source today, but excluding them defensively keeps the policy explicit and prevents future drift if a contributor adds a direct prefixed import — and it keeps the configuration byte-for-byte identical to the plugins repo, simplifying cross-repo review.

> **Note on `no-import-prefix` / `no-unversioned-import` exclusions in core.** Core currently routes all `jsr:` / `npm:` imports through the `imports` map (zero direct specifiers in source today), so these two rule exclusions have **nothing to suppress in core right now** — they exist purely for *symmetry* with the plugins repo, not as active enforcement carve-outs. If core policy ever diverges to require import-map-only imports (i.e. wanting these rules to actively flag a contributor who adds a direct prefixed import), re-enable the two rules in core's `lint.rules.exclude` (drop them from the array) without changing the plugins repo.

`lint.include` uses extension globs (matching the plugins repo) instead of a directory allow-list; lint isn't applicable to JSON/YAML/CSS so those globs are omitted by design.

**Per-rule decisions** for diagnostics that remain in the recommended ruleset (driven by the measured 514-diagnostic baseline; see `proposal.md` "Measured drift"):

| Rule | Count | Decision | Rationale |
|---|---:|---|---|
| `require-await` | 471 | **Exclude globally** via `lint.rules.exclude` | 462 of 471 hits are in `tests/writer` and `reader-src/src` and stem from `async () => ({...})` mocks and `async` handlers that match an externally-defined async signature (route handlers, plugin hooks, fake `fetch` responses, etc.). Removing `async` would break the interface contract. The remaining ~9 production hits in `writer/` are the same pattern at the route/hook boundary. The codebase intentionally uses `async` for signature conformance; the rule fights the architecture. |
| `no-window` | 17 | **Fix at source** by rewriting `window.*` → `globalThis.*` | All 17 sites reference globals that are universally available under both `globalThis` (Deno) and `window` (browser); `globalThis` is semantically equivalent in these contexts. Rewriting at the source removes the need for 17 per-site `// deno-lint-ignore` comments and keeps the call sites readable. (The implementation pass rewrote 25 `window.*`/`window.<prefix>` sites in total across both rules to `globalThis.*` — see row below.) |
| `no-window-prefix` | 8 | **Fix at source** by rewriting `window.<prefix>` → `globalThis.<prefix>` | Same justification as `no-window`: `globalThis` is the correct cross-runtime global and the rewrite eliminates per-site noise. Together with `no-window`, 25 sites were rewritten across `plugins/` and `reader-src/`. |
| `no-control-regex` | 7 | **Fix inline** with `// deno-lint-ignore no-control-regex` + reason | All seven sites are deliberate control-character sanitization regexes in input validation paths. |
| `no-unused-vars` | 4 | **Fix inline** (delete or prefix with `_`) | Genuine lint debt, trivial to fix. |
| `no-explicit-any` | 3 | **Fix inline** (replace with proper type or `unknown`; ignore only in test mocks where `any` is part of the cast) | Small, deliberate. |
| `prefer-const` | 2 | **Fix inline** (auto-fixable via `deno lint --fix`) | Trivial. |
| `no-inner-declarations` | 2 | **Fix inline** (hoist or restructure) | Trivial. |

**Rationale for the overall strategy:**
- Only `require-await` is excluded outright for diagnostic reasons; `no-import-prefix` and `no-unversioned-import` are excluded for cross-repo policy alignment and currently match zero source sites in core.
- Diagnostic exclusions are recorded in `deno.json` (`lint.rules.exclude`) rather than scattered as ignore comments — 471 `require-await` ignore comments would be worse than one config line plus this design note.
- `.vue` files: Deno lint does not natively understand `.vue` SFCs; they are skipped automatically. Vue type-checking already happens via `vue-tsc` inside `deno task build:reader` and via Vitest. This is accepted; see Decision 6.

### Decision 3 — `deno task` entries

```jsonc
"fmt": "deno fmt",
"fmt:check": "deno fmt --check",
"lint": "deno lint"
```

`fmt:check` exists specifically for CI; `fmt` is the contributor-facing mutating command.

### Decision 4 — CI gating

Add a third job `fmt-lint` to `.github/workflows/ci.yaml`, parallel to `test`, running `deno task fmt:check` then `deno task lint`. Run on the same triggers (push to `master`, PRs, `workflow_dispatch`). Do not make `test` depend on it; they run in parallel for fastest feedback.

### Decision 5 — Where to document for contributors

Add a new `### Before finalizing a change` subsection to the existing `## Code Style` section in the root `AGENTS.md`. The subsection MUST:

- Name the exact commands contributors run locally (`deno task fmt`, `deno task lint`).
- Name the exact CI commands (`deno fmt --check`, `deno lint`) and state that both run in CI on every PR/push and that either command exiting non-zero marks the build red on the PR's checks list. Note that branch-protection rulesets that would turn a red build into a hard merge block are recommended but not part of this change (they require repo-admin action).
- Note the scope: source code only (`.ts/.tsx/.js/.jsx/.json/.jsonc/.yaml/.yml/.css`); Markdown is intentionally excluded.
- Apply to both human and AI contributors.

**Cross-repo alignment:** the plugins repo uses the same subsection title (`### Before finalizing a change`) and identical wording, so contributors see the same workflow in either codebase. Single source of truth — no duplication into subdirectory READMEs.

### Decision 6 — Vue SFC formatting/linting is out of scope

`deno fmt` does **not** format `.vue` Single-File Components by default (it requires the experimental `--unstable-component` flag, which is not stable enough to gate CI on). `deno lint` does **not** lint `.vue` SFCs at all. This change therefore does **not** enforce formatting or linting inside `.vue` files.

Coverage for `.vue` files comes from:
- **Type checking**: `vue-tsc --noEmit` runs as part of `deno task build:reader` and the existing `test` job.
- **Runtime behaviour**: Vitest + `@vue/test-utils` in `tests/frontend` / `reader-src/src/**/__tests__`.

**Accepted gap:** `<script setup lang="ts">` blocks are not formatted by `deno fmt` and not linted by `deno lint`. Contributors must rely on house style and review.

**Future work** (not blocking this change):
- Evaluate `deno fmt --unstable-component` once it stabilises.
- Evaluate `eslint-plugin-vue` (or equivalent) if `.vue` style drift becomes a real problem.

### Decision 7 — Rollout sequencing

Because the measured baseline produces 275 fmt-drift files and 514 lint diagnostics (see `proposal.md` "Measured drift"), shipping the configuration, the bulk reformat, and the CI gate in a single commit would break `master`'s CI on the merge commit. The change ships as **three sequential commits**, mirroring the plugins repo's `setup-fmt-lint-config` rollout:

1. **`chore(deno): codify fmt + lint configuration`** — adds `fmt`, `lint`, and the three `tasks` entries to `deno.json` only. No CI changes, no source changes. CI continues to run `test` and `build:reader` only, so this commit cannot break the build.
2. **`style: apply deno fmt baseline`** — runs `deno fmt` once and commits the resulting whitespace/wrapping diff across the ~275 affected files. No logic changes. This commit is mechanically reviewable (diff is pure `deno fmt` output).
3. **`chore(deno): wire fmt + lint into CI`** — applies the per-rule lint fixes from Decision 2, adds the `fmt-lint` job to `.github/workflows/ci.yaml`, and updates `AGENTS.md`. This commit lands only after `deno task fmt:check && deno task lint` both exit 0 locally.

## Risks / Trade-offs

- **Risk**: Initial `deno fmt` write produces a noisy diff (275 files) that obscures real changes in adjacent PRs.
  → **Mitigation**: Land the one-time `deno fmt` as an isolated commit titled `style: apply deno fmt baseline` (Decision 7, commit 2) so the diff is mechanically reviewable and subsequent diffs stay clean.
- **Risk**: `deno lint --recommended` floods the tree with 514 diagnostics (most of them `require-await` on intentionally-async signatures).
  → **Mitigation**: Per-rule decisions in Decision 2 — exclude `require-await` globally with justification, rewrite the 25 `no-window`/`no-window-prefix` sites at source from `window.*` to `globalThis.*` (semantically equivalent here; removes per-site noise), and fix the remaining diagnostics inline (annotated `// deno-lint-ignore -- <reason>` for deliberate control-char regexes and intentional test mock casts; real fixes for `no-unused-vars` / `prefer-const` / `no-inner-declarations`). The CI gate (commit 3) lands only once `deno lint` exits 0.
- **Risk**: `.vue` files are not formatted or linted (Decision 6).
  → **Mitigation**: Accepted gap. `vue-tsc --noEmit` (already in `build:reader`) and Vitest cover Vue files. Future work tracked in Decision 6.
- **Trade-off**: Extension-glob `include` means every new `.ts/.js/.json/.yaml/.css` file in the tree is in scope by default. This is intentional — we'd rather over-include source by default and rely on a comprehensive `exclude` for known content directories (`playground/`, `themes/`, generated output, vendored code, archived specs). It also matches the plugins repo's idiom verbatim.
- **Trade-off**: Excluding `require-await` globally weakens lint coverage for the few production sites where it might catch a real bug. Accepted because the 471-to-9 ratio of intentional-mock to production hits makes the rule far more noise than signal here.

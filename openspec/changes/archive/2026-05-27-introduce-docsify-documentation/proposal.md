## Why

The `HeartReverie/docs/` directory is currently a flat collection of long-form Markdown files (`plugin-system.md` ~84KB / 1474 lines, `prompt-template.md` ~27KB / 446 lines, plus four shorter docs) that are read directly on GitHub. There is no landing page, no navigation, no search, and no way to discover what exists without `ls`. The two largest files are so long that reviewers, AI agents, and human readers all struggle to locate a specific subtopic; the table of contents lives only inside one giant document. The project is pre-release with zero external users, so this is the right moment to restructure the docs once — without any backward-compat or redirect concerns — into a small static site that can grow alongside the engine and the plugin SDK.

[docsify](https://docsify.js.org) is a runtime-rendered Markdown site (no build step, no Node dependency added to the runtime container) that lets us keep authoring in plain `.md`, split long topics into focused subpages, and ship a navigable, searchable site straight from the `docs/` folder. Adopting it now gives contributors a clear information architecture for future docs and gives readers a usable starting point ("how do I run this? where is the plugin manifest schema?") instead of a wall of files.

## What Changes

- Initialize a docsify site inside `HeartReverie/docs/`:
  - Add `index.html` (the docsify SPA bootstrap with the `docsify` runtime loaded from a pinned CDN URL, plus the `search`, `copy-code`, `pagination`, and `prism` (markdown/bash/json/typescript/yaml) plugins).
  - Add `.nojekyll` so GitHub Pages serves underscore-prefixed files (`_sidebar.md`, etc.) as-is.
  - Add `_sidebar.md` (global navigation tree), `_navbar.md` (top-bar links to repo / release / license), and `_coverpage.md` (landing splash with project tagline and a "Get Started" link).
  - Add `README.md` inside `docs/` as the docsify homepage (overview of the project, what's in the site, and where to go next).
- Replace the flat doc set with a folder hierarchy that matches the docsify sidebar. Concretely:
  - `docs/getting-started/` — `installation.md` (container via `scripts/podman-build-run.sh`, Helm pointer), `configuration.md` (env vars, passphrase, LLM endpoint), `first-story.md` (create a story directory, open the reader/writer).
  - `docs/guides/` — `writing-stories.md`, `reader-ui.md`, `writer-ui.md`, `tools-menu.md`, `template-editor.md`.
  - `docs/plugin-system/` — **split** the current `plugin-system.md` into: `overview.md`, `manifest.md`, `discovery-and-loading.md`, `prompt-fragments.md`, `strip-tags.md`, `hooks.md`, `frontend-render.md`, `frontend-styles.md`, `action-buttons.md`, `settings.md`, `custom-api-routes.md`, `api-endpoints.md`, `security.md`, `external-plugins.md`, `authoring-guide.md`, `builtin-catalog.md`, `hook-inspector.md`.
  - `docs/prompt-template/` — **split** the current `prompt-template.md` into: `overview.md`, `variables.md`, `vento-syntax.md`, `editing-in-ui.md`, `build-pipeline.md`, `lore-rendering.md`, `template-editor.md`, `lore-in-template-editor.md`.
  - `docs/lore-codex/` — `overview.md`, `directory-structure.md`, `chapter-format.md`, `tagging.md`, `template-variables.md`, `api.md` (sourced from the existing `lore-codex.md`).
  - `docs/deployment/` — `helm.md` (sourced from `helm-deployment.md`), `ci-cross-repo-trigger.md`.
  - `docs/migrations/` — `hook-inspector.md` (sourced from `migration-hook-inspector.md`).
- Adjust the converted Markdown for docsify conventions: replace intra-file anchor links (`#動作按鈕action-buttons`) with cross-file relative links (`plugin-system/action-buttons.md`), normalize heading levels so each subpage starts at `#` (H1) for its own title, and rewrite any path references that assumed the old single-file layout. Content meaning MUST remain faithful — only restructure, re-link, and split.
- Delete the original loose files (`docs/plugin-system.md`, `docs/prompt-template.md`, `docs/lore-codex.md`, `docs/helm-deployment.md`, `docs/ci-cross-repo-trigger.md`, `docs/migration-hook-inspector.md`) once their content has been migrated. The project is pre-release with no external users — no redirects, stubs, or compat shims are required.
- Update `HeartReverie/README.md` to add a short "📚 Documentation" section with two lines: how to browse the docs locally (`npx docsify-cli serve docs` from `HeartReverie/`) and a link to the published GitHub Pages site. Update the repo-root `AGENTS.md` and `HeartReverie/AGENTS.md` doc-pointer lists to reference the new folder layout (and the homepage `docs/README.md`) instead of the flat files.
- Configure `deno.json` `fmt.exclude` and `lint.exclude` to keep `docs/` out of scope as today (Markdown is already globally excluded from fmt; the new `docs/index.html` and any docsify JS are pulled from a CDN at runtime so no local JS/HTML files outside the existing exclusions are introduced for fmt to touch — but the new `docs/index.html` SHALL be added to `fmt.exclude` defensively).
- Add a GitHub Actions workflow at `HeartReverie/.github/workflows/docs-pages.yaml` that publishes the `docs/` directory of the **`jim60105/HeartReverie`** repository to GitHub Pages on every push to `master` that touches `docs/**`. (The `HeartReverie/` subdirectory of this workspace is in fact a standalone git repository — `git remote -v` resolves to `https://github.com/jim60105/HeartReverie.git` — so all paths inside the workflow are repo-relative, *not* workspace-relative.) The published URL will be the standard project-pages URL `https://jim60105.github.io/HeartReverie/`. This is the chosen production hosting model (see design.md Decision 4); it requires only a one-time repo-admin step (enabling Pages with "GitHub Actions" as the source) and after that is fully automated.
- Copy `HeartReverie/assets/heart.webp` (and any future shared visual assets) into `HeartReverie/docs/assets/` so that the same asset path resolves under both `npx docsify-cli serve docs` (where `docs/` is the web root) and the GitHub Pages deploy (where the Pages artifact root is `docs/`). The `_coverpage.md` reference uses `assets/heart.webp` (no `..` prefix); see design.md Decision 8.

## Capabilities

### New Capabilities
- `docs-site`: The docsify-based documentation site shipped under `HeartReverie/docs/` — its on-disk layout (sidebar, navbar, coverpage, homepage, index.html bootstrap), the folder hierarchy of subpages, the local preview workflow (`npx docsify-cli serve docs`), and the GitHub Pages publishing workflow that serves it in production.

### Modified Capabilities
<!-- None. The existing docs are not specified by any current capability; they are loose files. -->

## Impact

- **New files** under `HeartReverie/docs/`: `index.html`, `.nojekyll`, `README.md`, `_sidebar.md`, `_navbar.md`, `_coverpage.md`, and the per-section subdirectories listed above (`getting-started/`, `guides/`, `plugin-system/`, `prompt-template/`, `lore-codex/`, `deployment/`, `migrations/`) with their constituent `.md` files.
- **Deleted files** under `HeartReverie/docs/`: `plugin-system.md`, `prompt-template.md`, `lore-codex.md`, `helm-deployment.md`, `ci-cross-repo-trigger.md`, `migration-hook-inspector.md` (content migrated into the new layout; no redirects since pre-release).
- **`HeartReverie/README.md`**: new "📚 Documentation" subsection with the local-preview command and the GitHub Pages URL.
- **`AGENTS.md` (repo root) and `HeartReverie/AGENTS.md`**: doc-pointer paragraphs updated to reference the new folder layout and homepage.
- **`HeartReverie/deno.json`**: add `docs/index.html` to `fmt.exclude` defensively (Markdown is already excluded globally; HTML is not currently in scope for `deno fmt`, but the explicit exclusion documents intent and future-proofs the config).
- **`HeartReverie/.github/workflows/docs-pages.yaml`** (new): publish-to-Pages workflow inside the `jim60105/HeartReverie` repo, scoped to `docs/**` paths (repo-relative).
- **`HeartReverie/docs/assets/heart.webp`** (new): copy of the existing `HeartReverie/assets/heart.webp` placed inside the docs site so it is part of the Pages artifact and the local-preview web root. The duplication is ~unavoidable (docsify-cli refuses to serve paths outside its root) and is intentional; the binary is a single ~tens-of-KB image.
- **No runtime / no Deno deps / no container changes**: docsify is loaded from a CDN at view time; no Node, npm, or build step is added to the application image. `npx docsify-cli serve docs` is a *contributor* convenience that requires only a one-shot `npx` invocation — no entry is added to `package.json` (there is no `package.json` at this layer) or to `deno.json` tasks.
- **No API / no backend / no plugin behavior changes**.

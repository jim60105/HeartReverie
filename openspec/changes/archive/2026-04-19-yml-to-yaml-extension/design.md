## Context

The codebase historically used `.yml` for state files (`init-status.yml`, `current-status.yml`), plugin config (`compaction-config.yml`), and GitHub Actions workflow files. The official YAML spec recommends `.yaml`, and some tooling (editors, linters, schemas) defaults to `.yaml`. The project has no external users, so a clean rename is feasible without any compatibility shim.

## Goals / Non-Goals

**Goals:**
- Unify on the `.yaml` extension everywhere in the repository.
- Update all string literals in code that construct or match these filenames.
- Keep the change mechanical, low-risk, and reviewable as a single find-and-replace pass.

**Non-Goals:**
- Any YAML content or schema change.
- Any compatibility fallback that reads `.yml` files alongside `.yaml`.
- Editing archived OpenSpec changes (those remain historical records).
- Touching third-party or dependency files that happen to use `.yml`.

## Decisions

### Decision 1: Hard rename, no fallback

Update every code path in a single change so that `.yml` simply no longer exists in the repo. No dual-read logic, no migration window.

**Rationale:** There are zero external users, fallback code would become dead weight immediately, and a single atomic rename is trivial to review. Keeping the codebase free of legacy-support branches matches existing project style.

**Alternative considered:** Read both `.yaml` and `.yml` in the plugin config loader and state file loader. Rejected — unnecessary complexity for a project with no legacy data in the wild.

### Decision 2: Scope limited to repo-owned files

Only files inside this repository are renamed. The File System Access API directories the user opens in the browser contain story data that belongs to the user, but for this project the only committed story data lives under `playground/` and is treated as test data we own.

**Rationale:** Anything outside the repo cannot be renamed by a code change, and we have no external users to migrate.

### Decision 3: Mechanical find-and-replace pattern

Use a literal substring replacement of `.yml` → `.yaml` constrained to:
1. File renames: `git mv` for each file currently ending in `.yml`.
2. Source literals: string constants inside `.ts` files that reference these filenames.
3. Documentation: markdown references to the filenames.
4. The gitignore pattern.

No regex ambiguity because every occurrence in this codebase refers to one of the known files listed in the proposal's Impact section.

## Risks / Trade-offs

- **Risk**: A contributor working on a feature branch that references `.yml` filenames will have merge conflicts. → **Mitigation**: Coordinate the rename as a single merged PR; announce in the project channel.
- **Risk**: An external script or reverse proxy relying on the old workflow filenames (e.g., GitHub Actions re-run links). → **Mitigation**: GitHub resolves workflows by file path, so existing run history continues to point to the new filename after rename; no practical regression.
- **Risk**: Users who already have a local `playground/` directory with their own `current-status.yml` files. → **Mitigation**: The playground data is gitignored, so only local files are affected. Documented in the tasks as a manual step for any existing local install (rename locally). Since there are no external users, the impact is limited to maintainers.

## Migration Plan

1. Land the rename PR atomically (file renames + code + docs + specs).
2. For anyone with a local checkout containing `current-status.yml` files outside version control, rename them manually to `.yaml` after pulling.
3. No rollback plan needed beyond `git revert`.

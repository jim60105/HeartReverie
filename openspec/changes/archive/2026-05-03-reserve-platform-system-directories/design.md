## Context

HeartReverie treats underscore-prefixed directories as system-reserved and filters them out from story listings and lore scope traversal. However, platform-generated directories can still appear in mounted volumes, such as Linux `lost+found`, Windows `$RECYCLE.BIN` / `System Volume Information`, and macOS `.Spotlight-V100` / `.Trashes` / `.fseventsd`. If these appear under `playground/` or series directories, current filtering/validation paths can treat them as user content.

The change is backend-only but cross-cutting across route handlers and shared path validation. We need one consistent reserved-directory rule used by both listing paths and parameter validation to avoid drift.

## Goals / Non-Goals

**Goals:**
- Reserve known cross-platform system directory names for series/story discovery and validation.
- Keep story-selector API responses free of filesystem metadata directories.
- Ensure lore tag aggregation never traverses reserved platform directories as pseudo-series or pseudo-story paths.
- Preserve current reserved-name behavior for underscore-prefixed names.

**Non-Goals:**
- No migration of existing user data directories.
- No compatibility shim for existing stories matching any newly reserved platform directory literal.
- No frontend feature changes beyond receiving cleaner API data.

## Decisions

1. **Promote a shared reserved-directory predicate in backend code**
   - Decision: Centralize reserved-name checks (underscore prefix + explicit platform-literal set) in a reusable helper used by route filtering and parameter validation.
   - Rationale: Prevent duplicated one-off conditions and guarantee consistent behavior across `/api/stories`, lore scanning, and any endpoint validating `:series`/`:name`.
   - Alternatives considered:
     - Inline per-route checks: rejected due to long-term drift risk.
     - Regex-only validation in each route: rejected because exact-name and prefix rules are clearer as explicit predicate logic.

2. **Treat platform names as an explicit reserved literal set**
   - Decision: Reserve an exact, case-sensitive literal set: `lost+found`, `$RECYCLE.BIN`, `System Volume Information`, `.Spotlight-V100`, `.Trashes`, `.fseventsd`.
   - Rationale: Captures common platform/system directories without broad pattern matching that could block legitimate user names.
   - Alternatives considered:
      - Reserve broad pattern families (e.g., all names with spaces, dots, or `$`): rejected as unnecessarily breaking.
      - Reserve by case-insensitive matching: rejected for now to keep behavior explicit and minimally invasive.

3. **Expand backend tests to cover listing + validation + lore traversal**
   - Decision: Add or update tests in stories/lore route suites and validation tests.
   - Rationale: This bug surfaced through environment-specific filesystem behavior; tests must codify expected filtering to prevent regression.
   - Alternatives considered:
     - Rely only on manual verification: rejected as insufficiently durable.

## Risks / Trade-offs

- **[Risk] Existing local data intentionally named as one of the reserved literals becomes inaccessible via series/story APIs** → **Mitigation:** Explicitly treat this as acceptable due to pre-release status and no backward-compatibility requirement.
- **[Risk] New helper usage misses one endpoint path** → **Mitigation:** update shared validation path and add targeted test coverage for reserved-name rejection.
- **[Trade-off] Slightly stricter naming policy** → **Mitigation:** Keep policy narrow (exact literal + existing underscore rule) and document it in specs/tests.

## Migration Plan

No runtime migration is required. Deploy code and tests together; behavior changes take effect immediately on next rollout.

Rollback is straightforward: revert the change set to restore prior filtering rules.

## Open Questions

None.

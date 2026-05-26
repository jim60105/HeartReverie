## Context

`resolveTemplatePath()` in `writer/routes/templates-path.ts` is the gatekeeper for `GET /api/templates/source` (and all sibling template-channel routes). For `plugin:<name>:<rel>` it performs several defense-in-depth checks: traversal rejection, forbidden-extension rejection, dotfile-segment rejection, then resolves under the plugin's directory and confirms containment.

Two of those checks are too strict and reject legitimate inputs:

1. The dotfile-segment check splits `relativeFile` on `/` and rejects any segment whose first char is `.`. Plugin manifests, per the documented convention in `docs/plugin-system.md:167, 1324, 1351` and `docs/prompt-template.md:188`, write paths like `"./T-task.md"`. After splitting, `"."` is itself a dotfile segment, so the check rejects every manifest-style path.
2. The `..` check uses substring `includes("..")`, which over-matches benign file names containing two consecutive dots.

The codebase already has the right pattern: `writer/lib/plugin-validators-frontend-imports.ts:58-65` strips leading `./` repeatedly, then splits on `/`, then rejects segments equal to `..` or starting with `.` — this is the direct precedent for the dotfile-segment check. `writer/lib/plugin-validators-frontend-styles.ts` shares only the leading-`./` normalization pattern (no dotfile-segment check). Aligning the templates-path resolver with the `frontend-imports.ts` validator fixes the bug and improves codebase consistency.

The bug has been runtime-verified: clicking any of the **11 plugin fragments** in `/settings/template-editor` currently produces the toast **"載入模板失敗：Plugin path contains dotfile segment"**. The count breaks down as **9 fragments shipped by `HeartReverie_Plugins` plus 2 built-in fragments under `HeartReverie/plugins/` (`context-compaction`, `start-hints`)**.

## Goals / Non-Goals

**Goals:**
- Make `plugin:<name>:./<rel>` template paths resolve successfully via `GET /api/templates/source`, restoring read-only viewing of plugin fragments in the template editor.
- Keep all true defense-in-depth rejections (dotfiles, parent traversal, forbidden script-y extensions, plugin-directory containment) working unchanged.
- Align the plugin-fragment validation pattern with the existing frontend-imports / frontend-styles validators so there is one normalization idiom in the codebase.

**Non-Goals:**
- No change to plugin manifest schema, the `promptFragments[].file` field, or the documented `./snippet.md` convention.
- No change to `HeartReverie_Plugins` — manifests there already follow the documented convention.
- No relaxation of the `PUT /api/templates` `403` policy for plugin paths.
- No change to the forbidden-extension list (`.js`, `.mjs`, `.cjs`, `.html`, `.htm`, `.svg`).
- No change to the `lore:` or `system` branches of `resolveTemplatePath()`.

## Decisions

### 1. Normalize leading `./` before the dotfile-segment check (mirror frontend-imports validator)

Apply the exact normalization loop already used in `plugin-validators-frontend-imports.ts:58-65`:

```ts
let normalized = parsed.relativeFile;
while (normalized.startsWith("./")) {
  normalized = normalized.slice(2);
}
```

Then run the dotfile-segment check against `normalized`. **Why a loop and not a single `replace`** — to defensively collapse `././foo.md` to `foo.md`, exactly matching prior art. **Why not just filter out `"."` segments** — keeping the same idiom as `frontend-imports.ts` trumps micro-cleverness; future readers and future fixes apply uniformly.

**Sub-decision 1a — empty-path rejection after normalization.** After the strip loop, if `normalized.length === 0` (input was `./`, `././`, or any all-`./` sequence), return `{ status: 400, detail: "Plugin path is empty" }` **before** the dotfile-segment check. This prevents `resolve(dir, "")` from returning the plugin directory itself and causing a downstream `Deno.readTextFile(directory)` 500.

**Sub-decision 1b — backslash-separated paths remain rejected.** Plugin-fragment paths are forward-slash-only per Node convention and the rest of the codebase. The strip loop only matches the literal prefix `"./"`, so an input like `.\\foo.md` is **not** normalized and continues to be rejected by the dotfile-segment check (its first segment is `.\\foo.md`, which starts with `.`). The existing split on `/[\\/]/` at `templates-path.ts:204` further ensures backslash-separated components are tokenized and individually checked. No additional logic is needed; this sub-decision exists to make the behavior explicit.

**Sub-decision 1c — interior `./` markers remain rejected.** Only **leading** current-dir markers are stripped. Inputs like `sub/./foo.md` retain the interior `.` segment, which the dotfile-segment check rejects with `400`. This matches `plugin-validators-frontend-imports.ts` behavior exactly and avoids any ambiguity about partial normalization.

**Alternative considered**: `split(/[\\/]/).filter(s => s !== "" && s !== ".")`. Rejected because (a) it diverges from the frontend-imports pattern, and (b) silently dropping empty segments masks malformed paths like `foo//bar.md` that arguably deserve a 400 — leaving them to fail later in `resolve()`+`isPathContained` is less clear than just stripping the documented `./` prefix and otherwise checking segments as-written.

### 2. Tighten `..` rejection to segment-equals

Replace `parsed.relativeFile.includes("..")` with a segment-equals check on the normalized path's split, again mirroring `plugin-validators-frontend-imports.ts:58-65`:

```ts
const segments = normalized.split(/[\\/]/);
if (segments.some((s) => s === "..")) {
  return { ok: false, err: { status: 400, detail: "Plugin path contains .." } };
}
```

**Why**: substring matching rejects benign names like `foo..bar.md` (compound dot is unusual but legal on every filesystem the engine targets). Segment-equals is the correct semantic check, and `isPathContained()` after `resolve()` remains the ultimate safety net against any escape attempt.

**Alternative considered**: keep substring `includes("..")`. Rejected for consistency with `plugin-validators-frontend-imports.ts` and because the post-resolve containment check is the actual security boundary.

### 3. Use the normalized path for `resolve()`

Pass `normalized` (not the original `parsed.relativeFile`) into `resolve(dir, ...)`. `resolve("/plugins/foo", "./bar.md")` already produces the correct absolute path, so this is cosmetic; but it keeps any downstream logging / error messages clean and matches what the validator already considered "safe input."

### 4. Test surface

Add scenarios to the existing route test modules: **`tests/writer/routes/templates-coverage.test.ts`** (existing plugin-fragment cases live around lines 218–286) and **`tests/writer/routes/templates_test.ts`**. Coverage:

- **Accepted**: `./foo.md`, `./sub/bar.md`, `foo.md`, `sub/bar.md`, `foo..bar.md` (compound dot, edge case enabled by Decision 2), `././foo.md`.
- **Rejected (400, empty)**: `./`, `././` (Sub-decision 1a).
- **Rejected (400, dotfile)**: `.env`, `./.env`, `sub/.env`, `foo/.git/bar.md`, `.\\foo.md` (Sub-decision 1b), `sub/./foo.md` (Sub-decision 1c).
- **Rejected (400, traversal)**: `..`, `../escape.md`, `foo/../bar.md`.
- **Rejected via existing extension rule (400)**: `./handler.js`, `./page.html` (regression guard, already covered but worth keeping after the normalization change).

Tests SHOULD exercise `resolveTemplatePath()` directly (unit) where feasible, and end-to-end against `GET /api/templates/source?templatePath=plugin:<known-plugin>:./<fragment>` where a fixture plugin is available.

## Risks / Trade-offs

- **Risk**: A malformed manifest writes `"../../etc/passwd"` and the `..` segment-equals check passes a different traversal vector. → **Mitigation**: `..` as a standalone segment is still rejected (`["..", "..", "etc", "passwd"]` trips the check). For any exotic encoding that survives normalization, `isPathContained(dir, resolve(dir, normalized))` at line 212 is the authoritative containment gate and remains unchanged.
- **Risk**: Plugin author writes a fragment under a real dotfile directory (e.g. `.config/snippet.md`) and finds it rejected. → **Mitigation**: This is intentional, documented, and unchanged. Plugin fragments must live under non-dotfile paths; the proposal does not relax this rule.
- **Trade-off**: Allowing `foo..bar.md` is a behavior change at the edges. No plugin in the ecosystem uses such names, and the change is the right semantic; the substring check was over-broad.

## Migration Plan

No migration required. The change is a server-side bug fix in a validation function; no data model, manifest, or API shape changes. Roll forward by deploying the engine container; no plugin updates needed. Rollback = revert the single source file and its test.

## Open Questions

None blocking. At implementation time, confirm the exact test file path (the existing test layout may use a different module name) and follow the project's `error-handling-conventions` spec for any new log lines introduced.

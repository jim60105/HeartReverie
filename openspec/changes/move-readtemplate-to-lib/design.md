## Context

All paths are relative to the `HeartReverie/` repo root.

The codebase follows a clean layering rule: `writer/routes/` (Hono handlers) depend on `writer/lib/` (pure backend libraries), never the reverse. There is exactly one violation:

- `writer/lib/chat-shared.ts` imports `readTemplate` from `writer/routes/prompt.ts` (the line reads `import { readTemplate } from "../routes/prompt.ts";`). This is the **only** `lib → routes` import in the tree (verifiable via `grep -rn 'from "../routes/' writer/lib/`).

The function being imported is pure file logic:

```ts
/** Read the custom prompt file; fall back to system.md only when the custom file does not exist. */
export async function readTemplate(
  config: { PROMPT_FILE: string; ROOT_DIR: string },
): Promise<{ content: string; source: "custom" | "default" }> {
  try {
    const content = await Deno.readTextFile(config.PROMPT_FILE);
    return { content, source: "custom" };
  } catch (err: unknown) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
    const content = await Deno.readTextFile(join(config.ROOT_DIR, "system.md"));
    return { content, source: "default" };
  }
}
```

It uses only `Deno.readTextFile` and `join` from `@std/path` — no Hono, no route context. It lives in `routes/prompt.ts` only for historical reasons; the prompt GET/PUT route handlers in that file also call it.

The repo already uses a move-then-re-export pattern (e.g. `writer/lib/story.ts` re-exports helpers), so the import-stability approach is idiomatic here.

Constraints: TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`), double quotes, semicolons, JSDoc on exported functions, AGPL-3.0-or-later header on every source file. Pre-release, 0 users — no backward-compatibility or migration concerns beyond keeping in-repo importers compiling.

## Goals / Non-Goals

**Goals:**

- Eliminate the sole `lib → routes` import so `writer/lib/` depends on nothing in `writer/routes/`.
- Give `readTemplate` a correct home in `lib` (`writer/lib/prompt-file.ts`).
- Keep import sites stable via a re-export, so the prompt route handlers and any external importer need no change.
- Zero behavior change: the function moves verbatim (signature, fallback semantics, JSDoc).

**Non-Goals:**

- Any change to `readTemplate`'s behavior, inputs, outputs, or the prompt-file fallback semantics.
- Any change to the rest of `routes/prompt.ts` (the GET/PUT handlers' logic).
- Dropping the re-export in this change (it is kept for at least one release; removal is deferred).
- Adding new tests (existing prompt-route + chat tests are the regression net).

## Decisions

### Decision: New module `writer/lib/prompt-file.ts` holds the function

Create `writer/lib/prompt-file.ts` with the standard 15-line AGPL header, the `join` import from `@std/path`, and the `readTemplate` function moved verbatim (JSDoc included).

**Alternative considered:** place it in an existing lib module (e.g. `writer/lib/story.ts` or `template.ts`). Rejected — `prompt-file.ts` is a focused, single-responsibility name matching the module's purpose, consistent with the project's "one clear purpose identifiable from its filename" convention.

### Decision: Re-export from the old location for import stability

In `writer/routes/prompt.ts`, delete the function body and add, near the top, `export { readTemplate } from "../lib/prompt-file.ts";`. The route handlers in that file keep calling `readTemplate` through the re-export with no further edits.

**Alternative considered:** update every importer and drop the symbol from `routes/prompt.ts` immediately. Rejected for this change — the re-export is the lowest-risk path (the plan keeps it for at least one release) and matches the existing move-then-re-export idiom. External-importer removal is deferred maintenance.

### Decision: `chat-shared.ts` imports directly from `lib`

Change `writer/lib/chat-shared.ts` to `import { readTemplate } from "./prompt-file.ts";`. This is the edit that actually removes the layering violation — `chat-shared.ts` no longer reaches into `routes/`.

### Decision: Update test imports for clarity (optional, covered by re-export)

Any `tests/` file importing `readTemplate` (found via `grep -rn "readTemplate" writer/ tests/ scripts/ --include="*.ts"`) may switch to `writer/lib/prompt-file.ts`. The re-export keeps the old path working, so this is a clarity improvement, not a correctness requirement.

## Risks / Trade-offs

- **[An importer lives outside `writer/`/`tests/` and relies on the routes path in a way the re-export doesn't cover]** → The pre-move grep sweep (`grep -rn "readTemplate" writer/ tests/ scripts/ --include="*.ts"`) surfaces all importers before touching code; a hit outside the expected set is a STOP condition (report, do not improvise).
- **[Live `readTemplate` differs from the documented excerpt (drift)]** → Run the drift check (`git diff` on `chat-shared.ts` and `routes/prompt.ts` since the plan's base commit) first; on mismatch, treat as a STOP condition.
- **[Re-export indirection adds a hop]** → Negligible; it is removed in a future cleanup once all importers are confirmed migrated.

## Migration Plan

No runtime migration. Sequence: (1) create `writer/lib/prompt-file.ts`; (2) add the re-export in `routes/prompt.ts` and update `chat-shared.ts` + any test imports; (3) run `deno check writer/server.ts`, `deno task test:backend`, then `deno task fmt` / `deno task lint`. Rollback is a trivial revert (move the function back, drop the new file). No container/runtime feature is added, so the workspace integration-verification protocol is satisfied by the green backend test suite (no new endpoint or runtime path to exercise).

This change is **independent** of the other three advisor changes; it touches only backend `lib`/`routes` files and shares no files with `extract-ws-request-wrapper` (007), `unify-frontend-apierror` (009), or `pending-plugin-inits-weakmap` (010).

## Open Questions

None. This is intended to be a trivially-green mechanical diff; anything non-trivial means something unexpected is coupled to the routes module and should be reported.

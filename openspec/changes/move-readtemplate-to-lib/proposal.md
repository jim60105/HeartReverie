## Why

`writer/lib/chat-shared.ts` — the core chat execution module — imports `readTemplate` from `writer/routes/prompt.ts`. It is the **only** `lib → routes` import in the codebase, inverting the otherwise-clean "routes depend on lib, never the reverse" layering direction. Because of it, unit tests of the chat core transitively pull in a Hono route module, and any future route refactor can silently break chat. The function itself is pure file logic with no Hono dependency, so it belongs in `lib`.

## What Changes

- Add a new backend library module `writer/lib/prompt-file.ts` containing the `readTemplate` function moved **verbatim** (same signature, same fallback behavior, JSDoc preserved) from `writer/routes/prompt.ts`, with the AGPL-3.0-or-later header.
- Update `writer/lib/chat-shared.ts` to import `readTemplate` from `./prompt-file.ts` instead of `../routes/prompt.ts`, eliminating the sole `lib → routes` import.
- Re-export `readTemplate` from `writer/routes/prompt.ts` (`export { readTemplate } from "../lib/prompt-file.ts";`) so the existing GET/PUT route handlers and any external importers keep working with no call-site change.
- Update any test imports of `readTemplate` to point at the new `lib` path for clarity (optional, covered by the re-export otherwise).
- This is a pure structural move: **no behavior change** to `readTemplate`, its inputs, outputs, or the prompt-file fallback semantics.

## Capabilities

### New Capabilities
_None._ This is a structural module move; no new top-level capability is introduced.

### Modified Capabilities
- `backend-refactor`: Add a layering-direction invariant requirement — `writer/lib/` modules SHALL NOT import from `writer/routes/`; the `readTemplate` prompt-file helper SHALL live in `lib` and be consumed there directly.
- `file-based-prompt-storage`: Add a requirement fixing the canonical home of the `readTemplate` prompt-file read-with-fallback helper at `writer/lib/prompt-file.ts`, with a stability re-export from `writer/routes/prompt.ts`; the read-with-fallback behavior is unchanged.
- `typescript-type-system`: Add a requirement asserting the `readTemplate` signature and the `lib`-internal import path convention are preserved across the move.

## Impact

- **Backend code**: new file `writer/lib/prompt-file.ts`; edits to `writer/routes/prompt.ts` (delete function body, add re-export) and `writer/lib/chat-shared.ts` (import path). No change to the prompt GET/PUT route handlers' logic.
- **Tests**: any `tests/` files importing `readTemplate` may switch to the `lib` path; existing prompt-route and chat tests are the regression net (no new tests).
- **Layering**: `grep -rn 'from "../routes/' writer/lib/` returns zero matches after the change.
- **No external API, dependency, or runtime behavior impact.** No migration concerns (pre-release, 0 users).

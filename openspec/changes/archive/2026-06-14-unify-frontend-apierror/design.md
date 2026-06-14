## Context

All paths are relative to the `HeartReverie/` repo root.

The backend emits RFC 9457 Problem Details (`type`, `title`, `status`, `detail`) everywhere. The frontend parses it **three** different ways:

1. **`reader-src/src/lib/api.ts` (~lines 44–55)** — the shared `apiFetch` throws a plain `Error` carrying only `detail`, discarding `type`/`status`/`title`:

   ```ts
   const res = await fetch(url, { ...rest, headers });
   if (!res.ok && throwOnError) {
     const body = await res.json().catch(() => ({}));
     const detail = (body as { detail?: string }).detail;
     throw new Error(detail ?? errorMessage ?? (res.statusText || `Request failed: ${url}`));
   }
   return res;
   ```

2. **`reader-src/src/lib/template-api.ts`** — defines `class TemplateApiError extends Error` (~line 159) and a `parseError(res)` helper (~lines 177–196); every template call (`:206, :219, :234, :245, …`) uses `throwOnError: false` + `if (!res.ok) throw await parseError(res);`. It opts out of the shared client precisely because `apiFetch` is too lossy.

3. **`reader-src/src/composables/useChatApi.ts` (~lines 620–641, post-007 the line numbers shift — find via `grep -n "problemType" …`)** — `runPluginPrompt`'s HTTP fallback hand-parses the body a third time to recover the `type` slug as `err.code`:

   ```ts
   if (!res.ok) {
     let detail = `HTTP ${res.status}`;
     let problemType: string | undefined;
     try {
       const problem = await res.json() as { detail?: string; title?: string; type?: string };
       detail = problem?.detail ?? problem?.title ?? detail;
       problemType = problem?.type;
     } catch { /* Body not JSON */ }
     errorMessage.value = detail;
     const err = new Error(detail) as Error & { code?: string };
     if (problemType) err.code = problemType;
     throw err;
   }
   ```

Two cross-cutting compatibility facts constrain the change:

- Many catch sites across components/composables match on `err.message`. `ApiError.message` MUST stay byte-identical (detail-first) so those keep working with no edits.
- The `Error & { code }` rethrow in `runPluginPrompt` is a **documented cross-repo plugin contract** (plugin handlers branch on `err.code`); it MUST be preserved exactly.

Constraints: TS strict, double quotes, semicolons; tests via Vitest (`deno task test:frontend`); `vue-tsc` runs inside `deno task build:reader`. Pre-release, 0 users — no migration concerns.

## Goals / Non-Goals

**Goals:**

- One structured `ApiError` class carries `message` (detail-first, unchanged), `status`, `type?`, `title?`, and `body?` for every non-2xx response from the shared client.
- Remove the two re-implementations: `template-api.ts`'s `parseError`/opt-out and `useChatApi`'s third parser.
- Preserve `.message` byte-compatibility on every path so message-matching consumers need no edits.
- Preserve `TemplateApiError`'s public field names and the `Error & { code }` rethrow contract.

**Non-Goals:**

- No backend change.
- No rewrite of catch sites to use `status`/`type` — that is deferred incremental follow-up. Consumers keep matching on `.message`.
- No change to `TemplateApiError`'s consumer-visible field names.
- No change to the `runPluginPrompt` cross-repo `err.code` contract.

## Decisions

### Decision: Add `ApiError` and throw it from `apiFetch`

Add a structured class (in `api.ts`, or `errors.ts` if the file's current contents make that a better home — check first):

```ts
/** Structured RFC 9457 error thrown by apiFetch on non-2xx responses. */
export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    message: string,                 // detail-first human string (unchanged contract)
    public readonly status: number,
    public readonly type?: string,   // problem `type` slug
    public readonly title?: string,
    public readonly body?: unknown,   // raw parsed body when JSON
  ) {
    super(message);
  }
}
```

Change the `apiFetch` throw site to parse `type`/`title`/`status`/`body` alongside `detail` and throw `new ApiError(detail ?? errorMessage ?? …, res.status, type, title, body)`. **The `message` computation must remain byte-identical to today's logic** — the only change is the richer object that carries it, not the string.

### Decision: Collapse `template-api.ts` onto `ApiError`

Make `TemplateApiError` a **subclass** of `ApiError` preserving its existing public field names (map them in the constructor — check the class definition at `template-api.ts:159` for exact fields). Switch template calls from `throwOnError: false` + `parseError` to plain default-throwing `apiFetch`, catching `ApiError` and rethrowing as `TemplateApiError` **only if** a field mapping is needed; if the fields align 1:1 and no consumer constructs a `TemplateApiError` separately and checks `instanceof TemplateApiError` against it, an alias (`export { ApiError as TemplateApiError }`) is acceptable. Delete `parseError`.

**Decision driver:** the choice between subclass and alias is gated by the Step-0 consumer sweep (`grep -rn "instanceof TemplateApiError\|err.code\|\.message ===" reader-src/src/ --include="*.ts" --include="*.vue" | grep -v __tests__`). Each hit is a compatibility constraint; if any consumer does `instanceof TemplateApiError` against a separately-constructed instance, use the subclass, not the alias.

### Decision: Drop the third parser in `useChatApi.runPluginPrompt`

Replace the manual `!res.ok` parsing block in the HTTP fallback with `throwOnError: true` (default) and a catch that derives the `code` from `ApiError.type`, preserving the rethrown shape:

```ts
} catch (err: unknown) {
  if (err instanceof ApiError) {
    errorMessage.value = err.message;
    const e = new Error(err.message) as Error & { code?: string };
    if (err.type) e.code = err.type;
    throw e;
  }
  // …existing non-ApiError handling…
}
```

The `Error & { code }` rethrow shape is the documented plugin-handler contract and is preserved verbatim — only the **source** of `code` changes (from the hand-parsed `problemType` to `ApiError.type`).

### Decision: Two new tests pin the contract

In the api test file: (1) non-2xx with a problem body → thrown `ApiError` has `status`, `type`, and `message === detail`; (2) non-2xx with a non-JSON body → `ApiError` with the fallback message and `type === undefined`. Existing template-api and chat suites are the compatibility net.

## Risks / Trade-offs

- **[Step-0 sweep finds >8 catch sites needing edits to keep behavior]** → STOP and report with the list; the migration would be bigger than planned. The `.message`-byte-compat decision is specifically designed to keep this number at zero, but the sweep is the gate.
- **[`TemplateApiError` fields can't map onto `ApiError` without renaming a consumer-visible field]** → STOP and report; the unification is blocked.
- **[Drift in any of the three parsers vs the documented excerpts]** → Run the drift check (`git diff` on `api.ts`, `template-api.ts`, `useChatApi.ts` since the plan's base commit) first; on mismatch, STOP.
- **[`.message` accidentally changes byte-for-byte]** → Reviewer focus is `.message` byte-compatibility on **every** path; the existing api/template/chat tests assert on `.message` and are the net.

## Migration Plan

1. Add `ApiError`; throw it from `apiFetch` with byte-identical `message`. Verify existing api tests pass.
2. Collapse `template-api.ts` onto `ApiError` (subclass or alias per the sweep); delete `parseError`. Verify template-api tests pass and `grep -n "parseError" template-api.ts` is empty.
3. Drop the third parser in `runPluginPrompt`; derive `code` from `ApiError.type`. Verify chat tests pass and `grep -n "problemType" useChatApi.ts` is empty.
4. Full gates: `deno task build:reader && deno task test:frontend && deno task fmt && deno task lint`.

This is a frontend-only refactor with no new runtime endpoint or backend path, so the green frontend suite + `vue-tsc` build is the verification surface; no container exercise is required for this change specifically.

Rollback is a revert of the three frontend files and the new tests.

## Dependency Ordering

- **This change DEPENDS ON `extract-ws-request-wrapper` (Plan 007).** Both edit `useChatApi.ts`; **007 MUST land first** so this change rebases onto the consolidated `wsRequest` wrapper and the relocated `runPluginPrompt` HTTP fallback rather than conflicting with the pre-refactor four copies. If 007 hasn't landed and `useChatApi.ts` conflicts, that is a STOP condition — run 007 first.
- `move-readtemplate-to-lib` (006) and `pending-plugin-inits-weakmap` (010) are **independent** (backend-only, no shared files).

## Open Questions

- Subclass vs alias for `TemplateApiError` — resolved at implementation time by the Step-0 `instanceof TemplateApiError` sweep result.
- Whether `ApiError` lives in `api.ts` or `errors.ts` — resolved by inspecting `reader-src/src/lib/errors.ts`'s current contents.

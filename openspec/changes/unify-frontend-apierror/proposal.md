## Why

The backend speaks RFC 9457 Problem Details everywhere, but the frontend currently has three competing parsers for it: `apiFetch` throws a plain `Error` carrying only `detail` (discarding `type`/`status`/`title`); `template-api.ts` opts out of the shared client via `throwOnError: false` and runs its own `parseError` → `TemplateApiError`; and `useChatApi.runPluginPrompt` hand-parses the body a third time to recover the `type` slug as `err.code`. The two biggest consumers bypass the shared client precisely because it is too lossy. One structured error class removes both re-implementations and gives every caller `status`/`type`/`title` without ad-hoc parsing.

## What Changes

- Add a structured `ApiError extends Error` class (in `reader-src/src/lib/api.ts`, or `reader-src/src/lib/errors.ts` if it fits better there) carrying `message` (the detail-first human string, **byte-identical to today's logic**), `status: number`, optional `type?: string` (problem `type` slug), optional `title?: string`, and optional `body?: unknown` (raw parsed JSON body).
- Make `apiFetch` parse `type`/`title`/`status`/`body` alongside `detail` and throw `ApiError` on non-2xx responses. The `.message` string SHALL remain unchanged so existing `err.message`-matching consumers keep working with no edits.
- Collapse `template-api.ts` onto `ApiError`: make `TemplateApiError` a subclass (or alias) of `ApiError` preserving its existing public field names, switch template calls from `throwOnError: false` + `parseError` to the default-throwing `apiFetch`, and delete `parseError`.
- Drop the third parser in `useChatApi.runPluginPrompt`'s HTTP fallback: replace the manual `!res.ok` body parsing with default-throwing `apiFetch` and a catch that reads `err instanceof ApiError ? err.type : undefined` to populate the `code` property — **preserving** the documented `Error & { code }` rethrow contract that cross-repo plugin handlers branch on.
- Add two tests: a non-2xx problem body yields an `ApiError` with `status`, `type`, and `message === detail`; a non-2xx non-JSON body yields an `ApiError` with the fallback message and `type === undefined`.
- This is a **frontend-only refactor**; no backend change, and no consumer rewrite to `status`/`type` (that is deferred follow-up). `.message` byte-compatibility is preserved on every path.
- Implementation SHALL stop and report (rather than force the change) if the consumer sweep finds widespread `.message`-matching catch-site fallout (more than 8 catch sites that would need edits to keep behavior), or if `TemplateApiError`'s fields cannot be mapped onto `ApiError` without a consumer-visible field rename (mirrors plan 009's STOP condition).

## Capabilities

### New Capabilities
_None._ The structured error type formalizes the existing problem-details contract on the frontend; it introduces no new top-level capability.

### Modified Capabilities
- `error-handling-conventions`: Add requirements defining the single frontend `ApiError` structured-error contract — `apiFetch` SHALL throw `ApiError` on non-2xx with `status`/`type`/`title`/`body` populated and a `detail`-first `message`; the three competing problem-details parsers SHALL be eliminated.
- `template-editor`: Add a requirement that `TemplateApiError` is unified onto `ApiError` (subclass or alias) with its existing public field names preserved and `parseError` removed, so template-editor consumers keep working unchanged.
- `vue-component-architecture`: Add a requirement that `useChatApi.runPluginPrompt`'s HTTP fallback no longer hand-parses problem details and instead derives the `code` slug from `ApiError.type`, preserving the `Error & { code }` rethrow contract for plugin handlers.

## Impact

- **Frontend code**: `reader-src/src/lib/api.ts` (add + throw `ApiError`), `reader-src/src/lib/template-api.ts` (collapse onto `ApiError`, delete `parseError`), `reader-src/src/composables/useChatApi.ts` (drop the third parser), possibly `reader-src/src/lib/errors.ts` (if `ApiError` lives there).
- **Tests**: api test file gains 2 new tests; template-api and chat suites are the compatibility net.
- **Compatibility constraint**: `ApiError.message` MUST equal the previous human string (detail-first) so message-matching catch sites elsewhere keep working; `TemplateApiError`'s consumer-visible field names MUST be preserved; the `Error & { code }` rethrow in `runPluginPrompt` is a **cross-repo plugin contract** and MUST NOT change.
- **Dependency ordering**: **Depends on `extract-ws-request-wrapper` (Plan 007)** — both edit `useChatApi.ts`; 007 MUST land first to avoid conflicts. `move-readtemplate-to-lib` and `pending-plugin-inits-weakmap` are independent.
- No backend change, no migration concerns (pre-release, 0 users).

## 1. Pre-flight

- [x] 1.1 Confirm dependency: `extract-ws-request-wrapper` (Plan 007) has landed. If 007 hasn't landed and `useChatApi.ts` conflicts, STOP — run 007 first.
- [x] 1.2 Run the drift check: `git -C HeartReverie diff --stat <base>..HEAD -- reader-src/src/lib/api.ts reader-src/src/lib/template-api.ts reader-src/src/composables/useChatApi.ts`. On any mismatch with the documented excerpts, STOP and report.
- [x] 1.3 Read `template-api.ts:159` (the `TemplateApiError` class) fully and record its public field names — they are the compatibility contract for template consumers.
- [x] 1.4 SWEEP RESULT (4 hits, 0 needing edits): `TemplateEditorPage.vue:150` and `:351` do `instanceof TemplateApiError` against template-client-thrown instances → `TemplateApiError` kept as a real `ApiError` subclass (not alias). `useChatApi.ts:617` and `:692` set `err.code` — `:617` is the WS `onError` path (consumes structured `msg.problem`, NOT a Response body; left unchanged) and `:692` is the HTTP-fallback hand-parser this change removes. No `.message ===` exact-match catch sites exist, and `.message` stays byte-identical, so zero catch sites need edits. Well under the 8-site STOP threshold.
- [x] 1.5 DECISION: `ApiError` lives in `reader-src/src/lib/api.ts` (alongside `apiFetch`, which throws it). `errors.ts` is a tiny generic `errorMessage()` utility and is not the natural home for an HTTP-client error class.

## 2. Add ApiError and throw it from apiFetch

- [x] 2.1 Add `export class ApiError extends Error` (in `api.ts` or `errors.ts`) with `override readonly name = "ApiError"` and constructor params `message: string`, `public readonly status: number`, `public readonly type?: string`, `public readonly title?: string`, `public readonly body?: unknown`.
- [x] 2.2 Change the `apiFetch` non-2xx throw site to parse `type`/`title`/`status`/`body` alongside `detail` and throw `new ApiError(detail ?? errorMessage ?? (res.statusText || \`Request failed: ${url}\`), res.status, type, title, body)`. The `message` computation MUST remain byte-identical to the prior logic.
- [x] 2.3 Verify: `deno task test:frontend` → existing api tests pass (they assert on `.message`, which is unchanged).

## 3. Collapse template-api.ts onto ApiError

- [x] 3.1 SUBCLASS chosen (sweep found `instanceof TemplateApiError`): `TemplateApiError extends ApiError`, preserving `status`/`detail`/`expressions`/`body` and `.message` (`detail ?? title ?? \`HTTP <status>\``). The pre-existing local `interface ApiError` in template-api.ts (which collided with the new class name) was removed; `detail`/`expressions` are now derived from `ApiError.body`.
- [x] 3.2 If `TemplateApiError`'s fields cannot be mapped onto `ApiError` without renaming a consumer-visible field, STOP and report.
- [x] 3.3 Switch every template call from `throwOnError: false` + `parseError` to the default-throwing `apiFetch`; delete the `parseError` helper.
- [x] 3.4 Verify: `deno task test:frontend` → template-api tests pass; `grep -n "parseError" reader-src/src/lib/template-api.ts` → no matches.

## 4. Drop the third parser in useChatApi.runPluginPrompt

- [x] 4.1 Replace the manual `!res.ok` parsing block in `runPluginPrompt`'s HTTP fallback (find via `grep -n "problemType" …`) with default `throwOnError: true` and a catch that, on `err instanceof ApiError`, sets `errorMessage.value = err.message` and rethrows `new Error(err.message) as Error & { code?: string }` with `e.code = err.type` when `err.type` is set. Preserve the `Error & { code }` cross-repo plugin contract.
- [x] 4.2 Verify: `deno task test:frontend` → chat tests pass; `grep -n "problemType" reader-src/src/composables/useChatApi.ts` → no matches.

## 5. Add ApiError tests

- [x] 5.1 Locate the api test file (`ls reader-src/src/lib/__tests__/ 2>/dev/null || grep -rn "apiFetch" reader-src/src --include="*.test.ts" -l`).
- [x] 5.2 Add a test: non-2xx with a problem body → thrown `ApiError` has `status`, `type`, and `message === detail`.
- [x] 5.3 Add a test: non-2xx with a non-JSON body → `ApiError` with the fallback message and `type === undefined`.

## 6. Verification gates

- [x] 6.1 `deno task build:reader` → exit 0.
- [x] 6.2 `deno task test:frontend` → all pass, including the 2 new ApiError tests.
- [x] 6.3 `deno task fmt` and `deno task lint` → exit 0.
- [x] 6.4 `grep -rn "parseError" reader-src/src/lib/` → no matches; `grep -n "problemType" reader-src/src/composables/useChatApi.ts` → no matches.
- [x] 6.5 Reviewer check: `.message` byte-compatibility verified on every path; no files outside the in-scope list modified (`git status`).

## 7. Done criteria

- [x] 7.1 `grep -rn "parseError" reader-src/src/lib/` returns no matches.
- [x] 7.2 `grep -n "problemType" reader-src/src/composables/useChatApi.ts` returns no matches.
- [x] 7.3 `deno task test:frontend` exits 0 including 2 new ApiError tests.
- [x] 7.4 `deno task build:reader` exits 0.
- [x] 7.5 `deno task fmt` and `deno task lint` exit 0.
- [x] 7.6 No files outside the in-scope list modified.

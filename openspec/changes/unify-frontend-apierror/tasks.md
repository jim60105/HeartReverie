## 1. Pre-flight

- [ ] 1.1 Confirm dependency: `extract-ws-request-wrapper` (Plan 007) has landed. If 007 hasn't landed and `useChatApi.ts` conflicts, STOP — run 007 first.
- [ ] 1.2 Run the drift check: `git -C HeartReverie diff --stat <base>..HEAD -- reader-src/src/lib/api.ts reader-src/src/lib/template-api.ts reader-src/src/composables/useChatApi.ts`. On any mismatch with the documented excerpts, STOP and report.
- [ ] 1.3 Read `template-api.ts:159` (the `TemplateApiError` class) fully and record its public field names — they are the compatibility contract for template consumers.
- [ ] 1.4 Sweep error-matching consumers: `grep -rn "instanceof TemplateApiError\|err.code\|\.message ===" reader-src/src/ --include="*.ts" --include="*.vue" | grep -v __tests__`. Record every hit as a compatibility constraint. If >8 catch sites would need edits to keep behavior, STOP and report with the list.
- [ ] 1.5 Inspect `reader-src/src/lib/errors.ts` to decide whether `ApiError` belongs there or in `api.ts`.

## 2. Add ApiError and throw it from apiFetch

- [ ] 2.1 Add `export class ApiError extends Error` (in `api.ts` or `errors.ts`) with `override readonly name = "ApiError"` and constructor params `message: string`, `public readonly status: number`, `public readonly type?: string`, `public readonly title?: string`, `public readonly body?: unknown`.
- [ ] 2.2 Change the `apiFetch` non-2xx throw site to parse `type`/`title`/`status`/`body` alongside `detail` and throw `new ApiError(detail ?? errorMessage ?? (res.statusText || \`Request failed: ${url}\`), res.status, type, title, body)`. The `message` computation MUST remain byte-identical to the prior logic.
- [ ] 2.3 Verify: `deno task test:frontend` → existing api tests pass (they assert on `.message`, which is unchanged).

## 3. Collapse template-api.ts onto ApiError

- [ ] 3.1 Make `TemplateApiError` a subclass of `ApiError` preserving its existing public field names (map them in the constructor). If the fields align 1:1 AND the task-1.4 sweep found no `instanceof TemplateApiError` against a separately-constructed instance, instead alias: `export { ApiError as TemplateApiError }`.
- [ ] 3.2 If `TemplateApiError`'s fields cannot be mapped onto `ApiError` without renaming a consumer-visible field, STOP and report.
- [ ] 3.3 Switch every template call from `throwOnError: false` + `parseError` to the default-throwing `apiFetch`; delete the `parseError` helper.
- [ ] 3.4 Verify: `deno task test:frontend` → template-api tests pass; `grep -n "parseError" reader-src/src/lib/template-api.ts` → no matches.

## 4. Drop the third parser in useChatApi.runPluginPrompt

- [ ] 4.1 Replace the manual `!res.ok` parsing block in `runPluginPrompt`'s HTTP fallback (find via `grep -n "problemType" …`) with default `throwOnError: true` and a catch that, on `err instanceof ApiError`, sets `errorMessage.value = err.message` and rethrows `new Error(err.message) as Error & { code?: string }` with `e.code = err.type` when `err.type` is set. Preserve the `Error & { code }` cross-repo plugin contract.
- [ ] 4.2 Verify: `deno task test:frontend` → chat tests pass; `grep -n "problemType" reader-src/src/composables/useChatApi.ts` → no matches.

## 5. Add ApiError tests

- [ ] 5.1 Locate the api test file (`ls reader-src/src/lib/__tests__/ 2>/dev/null || grep -rn "apiFetch" reader-src/src --include="*.test.ts" -l`).
- [ ] 5.2 Add a test: non-2xx with a problem body → thrown `ApiError` has `status`, `type`, and `message === detail`.
- [ ] 5.3 Add a test: non-2xx with a non-JSON body → `ApiError` with the fallback message and `type === undefined`.

## 6. Verification gates

- [ ] 6.1 `deno task build:reader` → exit 0.
- [ ] 6.2 `deno task test:frontend` → all pass, including the 2 new ApiError tests.
- [ ] 6.3 `deno task fmt` and `deno task lint` → exit 0.
- [ ] 6.4 `grep -rn "parseError" reader-src/src/lib/` → no matches; `grep -n "problemType" reader-src/src/composables/useChatApi.ts` → no matches.
- [ ] 6.5 Reviewer check: `.message` byte-compatibility verified on every path; no files outside the in-scope list modified (`git status`).

## 7. Done criteria

- [ ] 7.1 `grep -rn "parseError" reader-src/src/lib/` returns no matches.
- [ ] 7.2 `grep -n "problemType" reader-src/src/composables/useChatApi.ts` returns no matches.
- [ ] 7.3 `deno task test:frontend` exits 0 including 2 new ApiError tests.
- [ ] 7.4 `deno task build:reader` exits 0.
- [ ] 7.5 `deno task fmt` and `deno task lint` exit 0.
- [ ] 7.6 No files outside the in-scope list modified.

## 1. Rate Limit Relaxation

- [ ] 1.1 Update global rate limit from 60 to 300 requests per minute in writer/app.ts
- [ ] 1.2 Update auth verify rate limit from 5 to 30 requests per minute on /api/auth/verify
- [ ] 1.3 Update chat rate limit from 10 to 30 requests per minute
- [ ] 1.4 Add preview-prompt rate limit at 60 requests per minute on /api/stories/:series/:name/preview-prompt
- [ ] 1.5 Add code comment documenting single-user rationale for relaxed limits

## 2. Batch Chapter Loading — Backend

- [ ] 2.1 Add `?include=content` query parameter handling to GET /api/stories/:series/:name/chapters
- [ ] 2.2 When `include=content`, read all chapter files and return `[{number, content}]` array sorted by chapter number
- [ ] 2.3 When `include` is absent or unknown value, return original `number[]` format (backward compatibility)
- [ ] 2.4 Return HTTP 404 with Problem Details for non-existent story directory

## 3. Batch Chapter Loading — Frontend

- [ ] 3.1 Update `loadFromBackendInternal()` in useChapterNav.ts to use `?include=content` endpoint
- [ ] 3.2 Replace N+1 fetch loop with single batch request and direct assignment to chapters.value

## 4. Testing

- [ ] 4.1 Add backend tests for batch endpoint: include=content returns [{number, content}], empty story, unknown include fallback, 404 for missing story
- [ ] 4.2 Verify existing backend rate limit tests pass with updated values
- [ ] 4.3 Update frontend test mocks in useChapterNav.test.ts to match single batch request pattern
- [ ] 4.4 Update frontend test mocks in router.test.ts to match single batch request pattern
- [ ] 4.5 Run full test suite (deno task test) and confirm all tests pass

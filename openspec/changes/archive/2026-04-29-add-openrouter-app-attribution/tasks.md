## 1. Implementation

- [x] 1.1 In `writer/lib/chat-shared.ts`, add a module-level frozen constant near the top of the file (after imports, before any function definitions). The title is wrapped in `encodeURIComponent` because raw non-Latin-1 bytes are invalid in HTTP header values per WHATWG fetch / RFC 9110:

      ```ts
      const LLM_APP_ATTRIBUTION_HEADERS: Readonly<Record<string, string>> = Object.freeze({
        "HTTP-Referer": "https://github.com/jim60105/HeartReverie",
        "X-OpenRouter-Title": encodeURIComponent("HeartReverie 浮心夜夢"),
        "X-OpenRouter-Categories": "roleplay,creative-writing",
      });
      ```

- [x] 1.2 In the same file, update the upstream `fetch` call (≈ line 216) to spread the constant into the `headers` map alongside the existing `Content-Type` and `Authorization` entries
- [x] 1.3 Run `deno check writer/server.ts` and confirm types remain sound

## 2. Tests

- [x] 2.1 Add (or extend an existing) backend test in `tests/writer/lib/` that stubs `globalThis.fetch` for the duration of one `executeChat()` invocation, captures the `Request` (or the `init.headers` argument) passed to the stub, and asserts the captured headers contain `HTTP-Referer: https://github.com/jim60105/HeartReverie`, `X-OpenRouter-Title` equal to `encodeURIComponent("HeartReverie 浮心夜夢")` (i.e. the percent-encoded wire value `HeartReverie%20%E6%B5%AE%E5%BF%83%E5%A4%9C%E5%A4%A2`), and `X-OpenRouter-Categories: roleplay,creative-writing` alongside `Content-Type` and `Authorization`
- [x] 2.2 Run `deno task test:backend` and confirm all backend tests pass

## 3. Documentation

- [x] 3.1 Add a short section (or paragraph) to `AGENTS.md` titled "OpenRouter App Attribution" that:
      - States the three headers are sent on every chat request
      - Lists their default values
      - Names the constant `LLM_APP_ATTRIBUTION_HEADERS` and its file path `writer/lib/chat-shared.ts`
      - Tells forks they MUST edit the constant if they want different attribution
- [x] 3.2 (Optional) Add a one-line mention in `README.md` if the README has a similar "what runs out of the box" section

## 4. Verification

- [x] 4.1 Run `deno task test` (backend + frontend) and confirm green
- [x] 4.2 Manually start the server, dispatch a chat request, and confirm via logs / network inspection that all three attribution headers are present on the upstream request to OpenRouter
- [x] 4.3 `openspec validate add-openrouter-app-attribution --strict` passes

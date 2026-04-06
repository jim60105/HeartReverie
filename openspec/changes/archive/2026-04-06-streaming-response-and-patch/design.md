# Design: Streaming Response and Post-Response Patch

## Context

The current chat endpoint (`POST /api/stories/:series/:name/chat`) in `writer/server.js` uses a non-streaming workflow:

1. `fetch()` to OpenRouter with no `stream` option
2. `apiResponse.json()` to parse the complete response
3. `fs.writeFile()` to write the entire chapter at once
4. `res.json()` to return the result

This means the reader sees nothing until generation is fully complete. Long responses can take 30+ seconds, leaving the user with no feedback. The existing auto-reload polling in the frontend (`chapter-nav.js`) already checks for file changes every 1 second — if the chapter file were updated incrementally, users would see content appear in real time without any frontend changes.

Additionally, the `apply-patches` CLI tool exists at `./apply-patches/target/release/apply-patches` to update `current-status.yml` by extracting status variables from chapter content. Currently this must be run manually after each AI response. Automating it as a post-response step keeps the status file in sync.

## Goals

- **G1:** Stream AI responses to disk in real time so the auto-reload polling shows content as it's generated
- **G2:** Automatically run `apply-patches` after each completed AI response to keep `current-status.yml` up to date
- **G3:** No frontend changes required — leverage the existing 1-second polling

## Non-Goals

- Streaming the HTTP response to the browser (SSE/WebSocket from server to client) — the existing polling mechanism is sufficient
- Changing generation parameters or prompt construction — only the response handling changes
- Error recovery for partial streams (partial files are kept as-is for user inspection)

## Decisions

### D1: SSE streaming with `stream: true`

Add `stream: true` to the OpenRouter request body. The response becomes a `text/event-stream` with `data: {...}` lines, each containing `choices[0].delta.content`. The stream terminates with a `data: [DONE]` sentinel line.

Parsing approach:
- Read the response body as a `ReadableStream` using `getReader()`
- Decode chunks with `TextDecoder`
- Split on `\n` boundaries, filter for lines starting with `data: `
- Parse the JSON payload and extract `choices[0].delta.content`
- Skip `data: [DONE]` (signals end of stream)

Native `fetch` in Node.js 18+ supports streaming response bodies, so no additional dependencies are needed.

### D2: Incremental file writing

Open the chapter file with `fs.open()` in write mode (`'w'`) before the stream starts. As each content delta arrives, write it to the file handle immediately. This allows the frontend's 1-second polling to pick up partial content while generation is still in progress.

The file handle is closed after the stream completes (or on error). The file is created at stream start, so even if an error occurs mid-stream, the partial content is preserved for user inspection.

### D3: Post-response `apply-patches` execution

After the stream completes successfully, run `./apply-patches/target/release/apply-patches playground` as a child process. Key decisions:

- **`execFile` over `exec`:** Use `child_process.execFile` with explicit arguments to prevent shell injection. No shell is spawned.
- **Synchronous await:** Wait for `apply-patches` to finish before sending the HTTP response, ensuring `current-status.yml` is updated before the client reads it.
- **Graceful failure:** If `apply-patches` fails (non-zero exit, binary not found), log a warning but do NOT fail the HTTP response. The chapter was written successfully — the patch is a best-effort enhancement.

### D4: Error handling strategy

| Error case | Behavior |
|-----------|----------|
| OpenRouter returns non-200 before stream starts | Return HTTP error, no file created |
| Stream errors mid-generation | Keep partial file, return HTTP 502 with error details |
| `apply-patches` exits non-zero | Log warning, return success with chapter content |
| `apply-patches` binary not found | Log warning, return success with chapter content |

### D5: No frontend changes needed

The existing auto-reload polling in `chapter-nav.js` checks for file changes every 1 second. Since the chapter file is written incrementally during streaming, the frontend will automatically show partial content as it arrives. No changes to the reader are required.

## Risks and Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| Partial file on stream error | User sees incomplete chapter content | Partial content is preserved intentionally — user can see what was generated and retry |
| `apply-patches` slows response | Adds latency between stream completion and HTTP response | `apply-patches` is a fast native binary; latency is negligible compared to LLM generation time |
| SSE parsing edge cases (split chunks, empty lines) | Missed or corrupted content deltas | Buffer incomplete lines across chunks; only process complete `data:` lines |
| File write errors mid-stream | Lost content | Unlikely on local filesystem; partial content up to the error point is preserved |

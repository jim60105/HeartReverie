## Why

The current chat endpoint waits for the entire OpenRouter response before writing the chapter file, which means the reader sees nothing until generation is complete. Long responses can take 30+ seconds, leaving users with no feedback. Streaming the response to disk in real time lets the auto-reload polling show progress as the AI writes, and running `apply-patches` after each response automatically updates the story's current-status.yml.

## What Changes

- Switch the OpenRouter API call from non-streaming to streaming (`stream: true` with SSE)
- Parse SSE `data:` chunks and append each content delta to the chapter file in real time
- After the stream completes successfully, execute `./apply-patches/target/release/apply-patches playground` as a child process to update current-status.yml
- Return the complete chapter content in the HTTP response after the stream finishes

## Capabilities

### New Capabilities

- `post-response-patch`: Automatically run `apply-patches` CLI after each completed AI response to update story status variables

### Modified Capabilities

- `writer-backend`: Modify the OpenRouter proxy requirement to use streaming (SSE) and write content to disk incrementally instead of waiting for the full response

## Impact

- `writer/server.js` — chat endpoint rewritten for SSE streaming + incremental file writes + child process execution
- `writer/package.json` — no new dependencies needed (Node.js native SSE parsing, `child_process`)
- Frontend auto-reload polling already picks up file changes, so no frontend changes required

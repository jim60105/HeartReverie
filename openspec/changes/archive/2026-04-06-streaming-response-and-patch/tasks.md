## 1. Streaming SSE Response

- [x] 1.1 Add `stream: true` to the OpenRouter request body in the chat endpoint
- [x] 1.2 Replace `apiResponse.json()` with SSE stream parsing — read the response body via `getReader()`, decode with `TextDecoder`, split on newline boundaries, and extract `data:` lines
- [x] 1.3 Parse each `data:` JSON payload to extract `choices[0].delta.content`, skipping `data: [DONE]` sentinel
- [x] 1.4 Handle SSE edge cases: incomplete lines split across chunks (buffer partial lines), empty `data:` lines, and missing `delta.content`

## 2. Incremental File Writing

- [x] 2.1 Open the chapter file with `fs.open()` in write mode before the stream starts (determine next chapter number and create the file handle)
- [x] 2.2 Write each content delta to the file handle immediately as it arrives from the SSE stream
- [x] 2.3 Close the file handle after the stream completes or on error
- [x] 2.4 Accumulate the complete content in memory to return in the HTTP response after streaming finishes

## 3. Post-Response Patch Execution

- [x] 3.1 Import `execFile` from `node:child_process` and promisify it
- [x] 3.2 After successful stream completion, execute `./apply-patches/target/release/apply-patches` with `['playground']` argument using `execFile` (no shell)
- [x] 3.3 Await `apply-patches` completion before sending the HTTP response
- [x] 3.4 Handle `apply-patches` failure gracefully — log warning on non-zero exit or stderr, but still return success with chapter content
- [x] 3.5 Handle missing binary — catch `ENOENT` error from `execFile`, log warning, continue without patching

## 4. Error Handling and Cleanup

- [x] 4.1 Handle OpenRouter non-200 response before stream starts — return error without creating a file
- [x] 4.2 Handle mid-stream errors — keep partial chapter file on disk, return HTTP 502 with error details
- [x] 4.3 Ensure file handle is always closed in a finally block (no leaked file descriptors)
- [x] 4.4 Verify the complete flow: stream → write file → apply-patches → return response

# Spec: writer-backend

> Node.js Express server that serves the reader frontend, exposes REST API endpoints for story management, and proxies chat requests to OpenRouter with a faithful prompt construction pipeline.

## MODIFIED Requirements

### Requirement: OpenRouter API proxy

The server SHALL expose `POST /api/stories/:series/:name/chat` that accepts a JSON body with a `message` field. The server SHALL construct the prompt using the pipeline above, send it to `https://openrouter.ai/api/v1/chat/completions` using native `fetch` with `stream: true` in the request body, and write the assistant's response incrementally as the next numbered chapter file. The server SHALL use the `OPENROUTER_API_KEY` environment variable for authentication and the `OPENROUTER_MODEL` environment variable (defaulting to `deepseek/deepseek-v3.2`) for model selection. The server SHALL pass hardcoded generation parameters: `temperature: 0.1`, `frequency_penalty: 0.13`, `presence_penalty: 0.52`, `top_k: 10`, `top_p: 0`, `repetition_penalty: 1.2`, `min_p: 0`, `top_a: 1`. The server SHALL stream the response using SSE and write content deltas to the chapter file in real time.

The server SHALL parse the SSE response by reading `data:` lines from the response body stream. Each line with a JSON payload SHALL have `choices[0].delta.content` extracted and appended to the chapter file immediately. The `data: [DONE]` sentinel SHALL signal end of stream. The server SHALL open the chapter file before streaming begins and write each content delta as it arrives, allowing the frontend auto-reload polling to display partial content during generation. After the stream completes, the server SHALL return the complete chapter content in the HTTP response.

#### Scenario: Successful streaming chat completion
- **WHEN** a client sends `POST /api/stories/:series/:name/chat` with a valid message
- **THEN** the server SHALL call OpenRouter with `stream: true`, create the next sequential chapter file (e.g., `002.md` if `001.md` exists), write each content delta to the file as it arrives from the SSE stream, and return the chapter number and complete content in the response after the stream finishes

#### Scenario: Chapter file updated incrementally during streaming
- **WHEN** the OpenRouter SSE stream is in progress
- **THEN** the chapter file on disk SHALL contain all content deltas received so far, allowing the frontend's 1-second polling to display partial content in real time

#### Scenario: Stream error mid-generation
- **WHEN** the SSE stream errors after some content has been written to the chapter file
- **THEN** the server SHALL keep the partial chapter file on disk and return an HTTP error response with error details

#### Scenario: OpenRouter API error
- **WHEN** the OpenRouter API returns an error status
- **THEN** the server SHALL return an appropriate HTTP error status with the error details and SHALL NOT create a new chapter file

#### Scenario: Missing API key
- **WHEN** the `OPENROUTER_API_KEY` environment variable is not set
- **THEN** the server SHALL return HTTP 500 with a descriptive error message indicating the missing configuration

#### Scenario: Path traversal prevention
- **WHEN** a client sends a request with path parameters containing `..` or other traversal sequences
- **THEN** the server SHALL reject the request with HTTP 400

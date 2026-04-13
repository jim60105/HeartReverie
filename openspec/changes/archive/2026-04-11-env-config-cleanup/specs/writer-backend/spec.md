## MODIFIED Requirements

### Requirement: OpenRouter API proxy

The server SHALL expose `POST /api/stories/:series/:name/chat` that accepts a JSON body with a `message` field. The server SHALL construct the prompt using the pipeline above, send it to the LLM API URL (configured via `LLM_API_URL` environment variable, defaulting to `https://openrouter.ai/api/v1/chat/completions`) using native `fetch` with `stream: true` in the request body, and write the assistant's response incrementally as the next numbered chapter file. The server SHALL use the `LLM_API_KEY` environment variable for authentication and the `LLM_MODEL` environment variable (defaulting to `deepseek/deepseek-v3.2`) for model selection. The server SHALL read generation parameters from environment variables with the following defaults: `LLM_TEMPERATURE` (default `0.1`), `LLM_FREQUENCY_PENALTY` (default `0.13`), `LLM_PRESENCE_PENALTY` (default `0.52`), `LLM_TOP_K` (default `10`), `LLM_TOP_P` (default `0`), `LLM_REPETITION_PENALTY` (default `1.2`), `LLM_MIN_P` (default `0`), `LLM_TOP_A` (default `1`). Parameters whose environment variable is not set SHALL use their default value. All parameter values SHALL be parsed as numbers; if parsing fails, the default SHALL be used. The server SHALL stream the response using SSE and write content deltas to the chapter file in real time.

Before streaming the AI response, the server SHALL write the user's chat message to the chapter file wrapped in `<user_message>` and `</user_message>` tags, followed by a blank line. The user message block SHALL appear at the beginning of the chapter file, before any AI-generated content. The `<user_message>` block SHALL also be included in the full content returned in the HTTP response.

The server SHALL parse the SSE response by reading `data:` lines from the response body stream. Each line with a JSON payload SHALL have `choices[0].delta.content` extracted and appended to the chapter file immediately. The `data: [DONE]` sentinel SHALL signal end of stream. The server SHALL open the chapter file before streaming begins and write each content delta as it arrives, allowing the frontend auto-reload polling to display partial content during generation. After the stream completes, the server SHALL return the complete chapter content in the HTTP response.

#### Scenario: Successful streaming chat completion
- **WHEN** a client sends `POST /api/stories/:series/:name/chat` with a valid message
- **THEN** the server SHALL call the LLM API with `stream: true`, create the next sequential chapter file (e.g., `002.md` if `001.md` exists), write the user message wrapped in `<user_message>` tags at the top of the file, then write each content delta to the file as it arrives from the SSE stream, and return the chapter number and complete content in the response after the stream finishes

#### Scenario: User message persisted before AI content
- **WHEN** the server begins writing a new chapter file during a chat request
- **THEN** the chapter file SHALL contain `<user_message>\n{message}\n</user_message>\n\n` at the beginning, followed by the AI response content

#### Scenario: Chapter file updated incrementally during streaming
- **WHEN** the LLM SSE stream is in progress
- **THEN** the chapter file on disk SHALL contain the user message block followed by all content deltas received so far, allowing the frontend's 1-second polling to display partial content in real time

#### Scenario: Stream error mid-generation
- **WHEN** the SSE stream errors after some content has been written to the chapter file
- **THEN** the server SHALL keep the partial chapter file on disk (including the user message block) and return an HTTP error response with error details

#### Scenario: LLM API error
- **WHEN** the LLM API returns an error status
- **THEN** the server SHALL return an appropriate HTTP error status with the error details and SHALL NOT create a new chapter file

#### Scenario: Missing API key
- **WHEN** the `LLM_API_KEY` environment variable is not set
- **THEN** the server SHALL return HTTP 500 with a descriptive error message indicating the missing configuration

#### Scenario: Custom LLM API URL
- **WHEN** `LLM_API_URL` is set to a non-default value (e.g., a self-hosted vLLM endpoint)
- **THEN** the server SHALL send chat completion requests to that URL instead of the OpenRouter default

#### Scenario: Custom sampling parameters
- **WHEN** `LLM_TEMPERATURE` is set to `0.7` in the environment
- **THEN** the chat completion request body SHALL contain `temperature: 0.7` instead of the default `0.1`

#### Scenario: Invalid sampling parameter value
- **WHEN** an LLM parameter env var contains a non-numeric value (e.g., `LLM_TEMPERATURE=abc`)
- **THEN** the server SHALL fall back to the default value for that parameter

## RENAMED Requirements

### Requirement: OpenRouter API proxy
- **FROM:** OpenRouter API proxy
- **TO:** LLM API proxy

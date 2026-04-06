# Design: Story Writer Server

## Context

The project currently consists of:

- **`reader/`** — A static HTML+JS single-page application that reads `.md` story chapter files and renders them using the File System Access (FSA) API.
- **`reader/serve.zsh`** — A simple HTTPS static file server using a Node.js inline script with self-signed certificate generation.
- **`playground/`** — Story data organized as `playground/{story_series}/{story_name}/{NNN}.md` chapter files.
- **`playground/prompts/system.md`** (811 lines) — The main LLM system prompt containing a Vento template placeholder `{{ scenario }}` at line 52. Note: the variable name is intentionally kept as the misspelled `scenario` to match the existing template.
- **`playground/prompts/after_user_message.md`** — Post-user-message instructions appended to every request.
- **`playground/{story_series}/scenario.md`** — Scenario data injected into the system prompt via the `{{ scenario }}` placeholder.
- **`playground/{story_series}/init-status.yml`** — Default status file. Overridden by `playground/{story_series}/{story_name}/current-status.yml` when present.
- **`playground/.opencode/commands/start.md`** — Contains a `<start_hints>` block (lines 11–22) used for the first round of story generation. This content will be hardcoded in the backend since `.opencode/` will be deleted.

Story writing currently requires external tools (SillyTavern or OpenCode) to orchestrate LLM calls, prompt assembly, and chapter file creation. This change consolidates that workflow into a self-contained Node.js server.

## Goals

- **Self-contained story writing + reading** — A single server that handles both the reader frontend and the LLM-powered writing backend, removing the need for external orchestration tools.
- **Simple deployment** — Single server, single domain, HTTPS with self-signed certificates.
- **Faithful prompt construction** — The prompt assembly pipeline must reproduce the exact message structure used by the existing SillyTavern/OpenCode workflow.
- **Filesystem-based state** — All story data lives as files on disk; no database required.

## Non-Goals

- **Streaming responses** — The server returns the full LLM response only; no Server-Sent Events or WebSocket streaming.
- **Multi-user / authentication** — The server is local-only; no user management.
- **Story editing** — Only appending new chapters is supported; existing chapters cannot be edited through the UI.
- **Database** — All state is filesystem-based.

## Decisions

### 1. Project Structure

The backend lives in `writer/` as a Node.js project using ESM modules.

Dependencies:
- **express** — HTTP server and routing
- **ventojs** — Vento template engine for rendering `system.md` with scenario data
- **native fetch** — Node.js 18+ built-in for OpenRouter API calls (chosen over `@openrouter/sdk` because the SDK's Zod schema strips OpenRouter-specific parameters like `top_k`, `top_a`, `min_p`, `repetition_penalty`)

### 2. Server Architecture

A single Express server that:
- Serves `reader/` as the static frontend at `/`
- Exposes API endpoints at `/api/`
- Reuses the existing self-signed certificate generation logic from `reader/serve.zsh`

### 3. API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stories` | List story series directories under `playground/` |
| `GET` | `/api/stories/:series` | List story name directories under `playground/:series/` |
| `GET` | `/api/stories/:series/:name/chapters` | List numbered `.md` chapter files |
| `GET` | `/api/stories/:series/:name/chapters/:number` | Read a specific chapter's content |
| `GET` | `/api/stories/:series/:name/status` | Read `current-status.yml` (fallback to `init-status.yml`) |
| `POST` | `/api/stories/:series/:name/chat` | Send user message → build prompt → call OpenRouter → write response as next chapter |
| `POST` | `/api/stories/:series/:name/init` | Create `001.md` if it does not exist |

### 4. Prompt Construction Pipeline

This is the critical design element. The messages array sent to OpenRouter MUST follow this exact structure:

```
[
  { role: "system", content: renderVento(system.md, { scenario: scenario.md content }) },
  { role: "assistant", content: "<previous_context>001.md</previous_context>" },
  { role: "assistant", content: "<previous_context>002.md</previous_context>" },
  ... (one message per chapter file, in numerical order)
  { role: "user", content: "<start_hints>...</start_hints>\n<inputs>user message</inputs>" },  // FIRST round only
  // OR
  { role: "user", content: "<inputs>user message</inputs>" },                                  // subsequent rounds
  { role: "system", content: "<status_current_variable>current-status.yml or init-status.yml content</status_current_variable>" },
  { role: "system", content: "after_user_message.md content" }
]
```

**First-round detection:** If no chapter files exist yet (i.e., only a freshly-touched `001.md` or no files), the user message is prefixed with `<start_hints>`.

The `<start_hints>` content is hardcoded in the backend:

```
請參考這段指示創作出一個好的起始章節:
1. 在第一句話就拋出引人入勝的懸念，激發讀者的好奇心。
2. 迅速介紹故事的背景和世界觀，但要通過自然的方式，避免生硬的直接說明。
3. 及早讓主角或重要人物登場，並用簡短的情節展現其特質。
4. 明確表達主角的目標或面臨的挑戰，確立故事的主線。
5. 暗示未來會發生的重大事件，製造期待感。
6. 力求開場"石破天驚"，用獨特的情節、語言或視角立即抓住讀者。
7. 通過文字風格展現故事的類型和基調，讓讀者了解這是什麼樣的故事。

起始章節完成以上任務，吸引讀者繼續閱讀。
```

### 5. Unified Serve Script

A root-level `serve.zsh` script that:
1. Generates self-signed TLS certificates (reusing the logic from `reader/serve.zsh`)
2. Starts the writer backend, which serves both the reader frontend and API endpoints

No separate frontend server is needed.

### 6. OpenRouter Integration

- **Client:** Node.js native `fetch` (not `@openrouter/sdk`, which strips OpenRouter-specific params via Zod validation).
- **API Key:** Read from the `OPENROUTER_API_KEY` environment variable, sent as `Authorization: Bearer` header.
- **Endpoint:** `POST https://openrouter.ai/api/v1/chat/completions`
- **Model:** Configurable via `OPENROUTER_MODEL` environment variable, defaulting to `deepseek/deepseek-v3.2`.
- **Hardcoded generation parameters** (migrated from `playground/opencode.json` agent config):
  - `temperature: 0.1`
  - `frequency_penalty: 0.13`
  - `presence_penalty: 0.52`
  - `top_k: 10`
  - `top_p: 0`
  - `repetition_penalty: 1.2`
  - `min_p: 0`
  - `top_a: 1`

These parameters are hardcoded in the chat request since the `opencode.json` config will be deleted.

### 7. Frontend Changes

Additions to the existing reader SPA:

- **Story selector panel** — A dropdown for series selection and a dropdown/input for story name selection, populated from the `/api/stories` endpoints.
- **Chat input box** — A textarea with a submit button placed below the story content (not sticky/fixed-position).
- **Submit behavior** — On submit, POST to `/api/stories/:series/:name/chat`, then reload chapters to display the new content.
- **Backward compatibility** — The existing File System Access API chooser MUST be preserved as an alternative loading path.

## Risks and Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large prompt size with many chapters | Token limit exceeded; degraded response quality | OpenRouter handles truncation on the model side. Future enhancement could implement a context window limit or summarization strategy. |
| OpenRouter API key stored in environment variable | Key exposure if server is publicly accessible | The server is designed for local-only use and is not exposed to the internet. Document this assumption clearly. |
| No streaming support | Poor UX for long generation times | Acceptable for initial version. The UI should show a loading indicator during generation. Streaming can be added later. |
| Self-signed certificates | Browser security warnings | Acceptable for local development. Users must accept the certificate on first visit. |

## 1. Project Setup

- [x] 1.1 Initialize `writer/` Node.js project with `package.json` (ESM, type: "module") and install dependencies: express, ventojs
- [x] 1.2 Create `writer/server.js` with Express HTTPS server skeleton that serves `reader/` as static files at `/`
- [x] 1.3 Create root `serve.zsh` with cert generation (ported from `reader/serve.zsh`) and writer backend startup
- [x] 1.4 Add `writer/node_modules/` to `.gitignore`

## 2. Backend API — Story Directory & Chapters

- [x] 2.1 Implement `GET /api/stories` — list story series directories under `playground/`, excluding hidden dirs and `prompts/`
- [x] 2.2 Implement `GET /api/stories/:series` — list story name directories under a series, excluding hidden dirs
- [x] 2.3 Implement `GET /api/stories/:series/:name/chapters` — list numbered `.md` files, sorted numerically
- [x] 2.4 Implement `GET /api/stories/:series/:name/chapters/:number` — read a specific chapter's content
- [x] 2.5 Implement `GET /api/stories/:series/:name/status` — read `current-status.yml` with fallback to `init-status.yml`
- [x] 2.6 Implement `POST /api/stories/:series/:name/init` — create story directory and touch empty `001.md`
- [x] 2.7 Add path traversal prevention middleware for all `:series` and `:name` params

## 3. Prompt Construction Pipeline

- [x] 3.1 Implement Vento template rendering for `system.md` with `{ scenario: scenario.md content }` injection
- [x] 3.2 Build chat history assembly — load chapters as individual assistant messages wrapped in `<previous_context>` tags
- [x] 3.3 Implement first-round detection (no chapters with content) and `<start_hints>` prepending logic with hardcoded hints
- [x] 3.4 Build user message wrapping in `<inputs>` tags
- [x] 3.5 Assemble status system message with `<status_current_variable>` wrapping (current-status.yml → init-status.yml fallback → empty)
- [x] 3.6 Append `after_user_message.md` content as final system message
- [x] 3.7 Compose the full messages array in the correct order and validate structure

## 4. OpenRouter Integration

- [x] 4.1 Implement `POST /api/stories/:series/:name/chat` endpoint — accept `{ message }` body, build prompt, call OpenRouter
- [x] 4.2 Use native `fetch` to POST to `https://openrouter.ai/api/v1/chat/completions` with `OPENROUTER_API_KEY` Bearer auth and `OPENROUTER_MODEL` env vars, with hardcoded generation params: temperature 0.1, frequency_penalty 0.13, presence_penalty 0.52, top_k 10, top_p 0, repetition_penalty 1.2, min_p 0, top_a 1
- [x] 4.3 Write OpenRouter response content as the next sequential numbered chapter file (e.g., `002.md` after `001.md`)
- [x] 4.4 Handle error cases: missing API key (500), OpenRouter API errors (proxy status), path traversal (400)

## 5. Frontend — Story Selector

- [x] 5.1 Add story selector panel to `reader/index.html` — series dropdown, story dropdown/input, create button
- [x] 5.2 Implement series dropdown population from `GET /api/stories`
- [x] 5.3 Implement story dropdown update on series change from `GET /api/stories/:series`
- [x] 5.4 Implement new story creation — POST to `/api/stories/:series/:name/init`, then auto-load
- [x] 5.5 Implement backend-driven chapter loading — fetch chapter list and content from API, render in reader view
- [x] 5.6 Preserve existing File System Access API chooser alongside the new story selector

## 6. Frontend — Chat Input

- [x] 6.1 Add chat input UI — textarea + submit button below story content (not sticky), styled consistently with existing theme
- [x] 6.2 Implement submit behavior — POST message to `/api/stories/:series/:name/chat`, disable input during request
- [x] 6.3 Implement post-submit chapter reload — fetch and display newly created chapter after successful response
- [x] 6.4 Add error handling — display errors, preserve message in textarea, re-enable input
- [x] 6.5 Add empty message prevention

## 7. Cleanup & Finalization

- [x] 7.1 Delete `playground/.opencode/` directory (agents, commands, plugins, opencode.json)
- [x] 7.2 Migrate `reader/serve.zsh` — ensure root `serve.zsh` fully replaces it, then delete `reader/serve.zsh`
- [x] 7.3 Verify end-to-end flow: select story → send message → see new chapter rendered

## Why

The current MD Story Reader is a read-only frontend that displays pre-written story chapters from local files selected via the File System Access API. To enable interactive story writing — where users can send messages to an LLM and receive AI-generated story continuations written as local `.md` files — we need a backend server that proxies OpenRouter API calls and manages file I/O. This eliminates the dependency on SillyTavern or OpenCode for story generation, providing a self-contained story writing and reading experience.

## What Changes

- **New `writer/` Node.js backend**: An Express-based server that receives user chat messages, builds structured LLM prompts from project templates (`playground/prompts/system.md`, scenario files, status files), sends them to OpenRouter, and writes AI responses as numbered `.md` chapter files.
- **Frontend chat input**: Add a message input box below the story content in the reader UI, enabling users to type story directions and submit them to the backend API.
- **Story selection UI**: Add a story series and story name selector to the frontend, allowing users to browse `playground/` directories and pick or create stories without the File System Access API chooser. The existing FSA chooser remains as an alternative.
- **Unified serve script**: Migrate and replace `reader/serve.zsh` with a root-level `serve.zsh` that starts both the backend (writer) and frontend (reader) under the same HTTPS domain.
- **Prompt construction pipeline**: Build a Vento-templated prompt system that assembles system prompts, scenario injection, chat history from chapter files, user input, status variables, and post-user-message instructions into a structured OpenRouter API request.
- **Delete `playground/.opencode/`**: After hardcoding the `start_hints` content into the backend, remove the OpenCode configuration directory since it's no longer needed.

## Capabilities

### New Capabilities
- `writer-backend`: Node.js Express server handling OpenRouter API proxying, prompt assembly with Vento templates, and chapter file I/O.
- `chat-input`: Frontend chat input UI component for submitting user messages to the backend.
- `story-selector`: Frontend UI for browsing and selecting story series/names from the `playground/` directory, with new-story creation support.
- `unified-server`: Root-level serve script that runs both backend and frontend under a single HTTPS domain.

### Modified Capabilities
- `file-reader`: Adding backend-driven story loading as an alternative to the File System Access API, while preserving the existing FSA chooser.

## Impact

- **New dependencies**: `express`, `ventojs`, `node-fetch` (or native fetch) in `writer/package.json`; OpenRouter API key required via environment variable.
- **Affected code**: `reader/index.html` (new chat input, story selector UI), `reader/js/file-reader.js` (backend loading path), `reader/serve.zsh` (replaced by root `serve.zsh`).
- **File system**: Backend writes `.md` files directly to `playground/{series}/{story}/` directories. Backend reads prompt templates from `playground/prompts/` and scenario/status files from `playground/{series}/`.
- **Removed**: `playground/.opencode/` directory (agents, commands, plugins, config).

# MD Story Reader

A browser-based reader for multi-chapter markdown stories with custom XML blocks (`<status>`, `<options>`, `<UpdateVariable>`) from [SillyTavern](https://github.com/SillyTavern/SillyTavern) AI chat sessions.

Pure vanilla HTML + ES modules — no build step, no framework.

## Features

- 📂 Open local story folders via File System Access API
- 📖 Chapter-by-chapter navigation with keyboard shortcuts (← →)
- 🎭 Status panel sidebar — character stats, outfit, close-ups
- 🎲 Options panel — clickable choice buttons with clipboard copy
- 📝 Variable update blocks — collapsible raw data view
- 💾 Session persistence — reopens last folder on refresh
- 🌙 Dark love-themed UI with CJK-optimised typography

## Quick Start

```bash
cd reader
./serve.zsh          # https://localhost:8443
./serve.zsh 8080     # custom port
```

> HTTPS is required — the File System Access API only works in secure contexts.
> The dev server auto-generates a self-signed TLS certificate on first run.

Open the URL in Chrome/Edge, click **選擇資料夾**, and pick a folder containing numbered `.md` files (e.g. `001.md`, `002.md`).

## Project Structure

```
reader/              Web reader app
  index.html           Entry point (all CSS inline)
  js/                  ES modules (6 files)
  serve.zsh            HTTPS dev server (zsh + Node.js)
openspec/            Specifications & change history
regex.json           SillyTavern regex scripts
short-template/      Example story chapters
```

## Browser Support

Requires a browser with [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) support:
- ✅ Chrome 86+
- ✅ Edge 86+
- ❌ Firefox (not supported)
- ❌ Safari (not supported)

## License

GPL-3.0-or-later


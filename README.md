# Story

Story content repository with an embedded **MD Story Reader** web app.

## Structure

```
reader/          # Web reader app (HTML + JS + dev server)
  index.html     # Main entry point
  js/            # ES modules
  serve.zsh      # HTTPS dev server
openspec/        # Specifications and change tracking
```

## Quick Start

```bash
cd reader
./serve.zsh          # https://localhost:8443
./serve.zsh 8080     # custom port
```

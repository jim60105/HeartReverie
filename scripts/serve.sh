#!/usr/bin/env bash
# Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU AFFERO GENERAL PUBLIC LICENSE for more details.
#
# You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
# ==================================================================
#
# Start the story writer backend server for local development.
# Speaks plain HTTP only — terminate TLS at an upstream proxy if needed.
#
# Usage:
#   serve.sh [port]
#
# Arguments:
#   port  Port number to listen on (default: 8080)
#
# Examples:
#   ./scripts/serve.sh        # Serve on http://localhost:8080
#   ./scripts/serve.sh 9000   # Serve on http://localhost:9000

set -euo pipefail
# umask 0002 is load-bearing: matches the container's `sh -c` CMD shim so
# that directories created at runtime via Deno.mkdir({ mode: 0o775 }) are
# group-writable (Deno honours the inherited process umask on mkdir).
umask 0002

readonly PROJECT_DIR="$HOME/repos/HeartReverie"
readonly PLUGINS_DIR="$HOME/repos/HeartReverie_Plugins"

# Validate port number if provided
if [[ -n "${1:-}" ]]; then
    if [[ ! "$1" =~ ^[0-9]+$ ]] || (( 10#$1 < 1 || 10#$1 > 65535 )); then
        echo "❌ Invalid port number: $1 (must be 1~65535)" >&2
        exit 1
    fi
fi

export PORT="${1:-8080}"
export PLAYGROUND_DIR="${PROJECT_DIR}/playground"
export READER_DIR="${PROJECT_DIR}/reader-dist"
export PLUGIN_DIR="${PLUGINS_DIR}"

echo "🚀 Story writer starting on http://localhost:${PORT}"
echo "   Project: ${PROJECT_DIR}"
echo "   Press Ctrl+C to stop"

cd "$PROJECT_DIR"

if ! command -v deno >/dev/null 2>&1; then
    echo "❌ deno is required but was not found in PATH" >&2
    exit 1
fi

exec deno run \
    --allow-net --allow-read --allow-write --allow-env --allow-run \
    writer/server.ts

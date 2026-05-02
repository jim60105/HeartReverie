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
# Defaults to HTTPS with auto-generated self-signed certs; set HTTP_ONLY=true
# to serve plain HTTP (e.g. behind a TLS-terminating reverse proxy).
# Thin wrapper around entrypoint.sh that sets project-relative paths.
#
# Usage:
#   serve.sh [port]
#
# Arguments:
#   port  Port number to listen on (default: 8443)
#
# Requirements:
#   - openssl  (for certificate generation)
#   - deno     (for the backend server)
#
# Examples:
#   ./scripts/serve.sh                       # Serve on https://localhost:8443
#   ./scripts/serve.sh 9000                  # Serve on https://localhost:9000
#   HTTP_ONLY=true ./scripts/serve.sh 9000   # Serve on http://localhost:9000

set -euo pipefail

readonly PROJECT_DIR="$HOME/repos/HeartReverie"
readonly PLUGINS_DIR="$HOME/repos/HeartReverie_Plugins"

# Validate port number if provided
if [[ -n "${1:-}" ]]; then
    if [[ ! "$1" =~ ^[0-9]+$ ]] || (( 10#$1 < 1 || 10#$1 > 65535 )); then
        echo "❌ Invalid port number: $1 (must be 1~65535)" >&2
        exit 1
    fi
fi

export PORT="${1:-8443}"
export PLAYGROUND_DIR="${PROJECT_DIR}/playground"
export READER_DIR="${PROJECT_DIR}/reader-dist"
export CERT_DIR="${PROJECT_DIR}/.certs"
export PLUGIN_DIR="${PLUGINS_DIR}"

if [[ "${HTTP_ONLY:-}" == "true" ]]; then
    SCHEME="http"
else
    SCHEME="https"
fi

echo "🚀 Story writer starting on ${SCHEME}://localhost:${PORT}"
echo "   Project: ${PROJECT_DIR}"
echo "   Press Ctrl+C to stop"

exec "${PROJECT_DIR}/entrypoint.sh" "${PROJECT_DIR}/writer/server.ts"

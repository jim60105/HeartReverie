#!/bin/zsh
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
# Start the story writer HTTPS backend server for local development.
# Thin wrapper around entrypoint.sh that sets project-relative paths.
#
# Usage:
#   serve.zsh [port]
#
# Arguments:
#   port  Port number to listen on (default: 8443)
#
# Requirements:
#   - openssl  (for certificate generation)
#   - deno     (for the backend server)
#
# Examples:
#   ./serve.zsh          # Serve on https://localhost:8443
#   ./serve.zsh 9000     # Serve on https://localhost:9000

set -euo pipefail

readonly PROJECT_ROOT="${0:a:h}"

# Validate port number if provided
if [[ -n "${1:-}" ]]; then
    if [[ ! "$1" =~ ^[0-9]+$ ]] || (( $1 < 1 || $1 > 65535 )); then
        echo "❌ Invalid port number: $1 (must be 1–65535)" >&2
        exit 1
    fi
fi

export PORT="${1:-8443}"
export PLAYGROUND_DIR="${PROJECT_ROOT}/playground"
export READER_DIR="${PROJECT_ROOT}/reader"
export CERT_DIR="${PROJECT_ROOT}/.certs"

echo "🚀 Story writer starting on https://localhost:${PORT}"
echo "   Project: ${PROJECT_ROOT}"
echo "   Press Ctrl+C to stop"

exec "${PROJECT_ROOT}/entrypoint.sh" "${PROJECT_ROOT}/writer/server.ts"

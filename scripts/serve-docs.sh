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
# Serve both docsify documentation sites for local development.
# Runs docsify-cli for HeartReverie core and HeartReverie_Plugins in parallel,
# each on its own port. Stop both with Ctrl+C.
#
# Usage:
#   serve-docs.sh [core_port] [plugins_port]
#
# Arguments:
#   core_port     Port for HeartReverie core docs    (default: 3001)
#   plugins_port  Port for HeartReverie_Plugins docs (default: 3002)
#
# Examples:
#   ./scripts/serve-docs.sh             # Core on 3001, plugins on 3002
#   ./scripts/serve-docs.sh 4001 4002   # Custom ports

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
readonly CORE_DOCS="${SCRIPT_DIR}/../docs"
readonly PLUGINS_DOCS="${SCRIPT_DIR}/../../HeartReverie_Plugins/docs"

validate_port() {
    local label="$1"
    local value="$2"
    if [[ ! "$value" =~ ^[0-9]+$ ]] || (( 10#$value < 1 || 10#$value > 65535 )); then
        echo "❌ Invalid ${label} port: ${value} (must be 1~65535)" >&2
        exit 1
    fi
}

CORE_PORT="${1:-3001}"
PLUGINS_PORT="${2:-3002}"
validate_port "core" "$CORE_PORT"
validate_port "plugins" "$PLUGINS_PORT"

if [[ "$CORE_PORT" == "$PLUGINS_PORT" ]]; then
    echo "❌ core_port and plugins_port must differ (got ${CORE_PORT})" >&2
    exit 1
fi

if [[ ! -d "$CORE_DOCS" ]]; then
    echo "❌ Core docs directory not found: ${CORE_DOCS}" >&2
    exit 1
fi
if [[ ! -d "$PLUGINS_DOCS" ]]; then
    echo "❌ Plugins docs directory not found: ${PLUGINS_DOCS}" >&2
    exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
    echo "❌ npx is required but was not found in PATH" >&2
    exit 1
fi

CORE_PID=""
PLUGINS_PID=""

shutdown() {
    local code=$?
    trap - INT TERM EXIT
    echo ""
    echo "🛑 Stopping docsify servers..."
    [[ -n "$CORE_PID" ]] && kill "$CORE_PID" 2>/dev/null || true
    [[ -n "$PLUGINS_PID" ]] && kill "$PLUGINS_PID" 2>/dev/null || true
    wait 2>/dev/null || true
    exit "$code"
}
trap shutdown INT TERM EXIT

echo "📚 Serving HeartReverie docs"
echo "   Core    → http://localhost:${CORE_PORT}/    (${CORE_DOCS})"
echo "   Plugins → http://localhost:${PLUGINS_PORT}/ (${PLUGINS_DOCS})"
echo "   Press Ctrl+C to stop both."
echo ""

npx --yes docsify-cli serve "$CORE_DOCS" --port "$CORE_PORT" &
CORE_PID=$!

npx --yes docsify-cli serve "$PLUGINS_DOCS" --port "$PLUGINS_PORT" &
PLUGINS_PID=$!

wait -n "$CORE_PID" "$PLUGINS_PID"
echo "⚠️  One of the docsify servers exited; shutting the other down." >&2
exit 1

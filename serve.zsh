#!/bin/zsh
# Copyright (C) 2025 Jim Chen <Jim@ChenJ.im>, licensed under GPL-3.0-or-later
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
# ==================================================================
#
# Start the story writer HTTPS backend server.
# Generates a self-signed certificate if one does not exist,
# then launches the Deno Hono server.
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

# ── Color codes ───────────────────────────────────────────────────
readonly RED='\033[0;31m'
readonly YELLOW='\033[0;33m'
readonly GREEN='\033[0;32m'
readonly GRAY='\033[0;90m'
readonly RESET='\033[0m'

# ── Utility functions ─────────────────────────────────────────────

log_info()  { echo "${GREEN}✅ $1${RESET}" }
log_warn()  { echo "${YELLOW}⚠️  $1${RESET}" }
log_error() { echo "${RED}❌ $1${RESET}" >&2 }

check_dependency() {
    if ! command -v "$1" >/dev/null 2>&1; then
        log_error "$1 is required but not installed"
        exit 1
    fi
}

# ── Dependency checks ─────────────────────────────────────────────

check_dependency openssl
check_dependency deno

# ── Configuration ─────────────────────────────────────────────────

readonly PROJECT_ROOT="${0:a:h}"
readonly PORT="${1:-8443}"
readonly CERT_DIR="${PROJECT_ROOT}/.certs"
readonly CERT_FILE="${CERT_DIR}/cert.pem"
readonly KEY_FILE="${CERT_DIR}/key.pem"

# Validate port number
if [[ ! "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
    log_error "Invalid port number: ${PORT} (must be 1–65535)"
    exit 1
fi

# ── Certificate generation ────────────────────────────────────────

generate_certificate() {
    mkdir -p "${CERT_DIR}"
    openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout "${KEY_FILE}" -out "${CERT_FILE}" \
        -days 365 -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0.0.0.0" \
        2>/dev/null
    log_info "Generated self-signed certificate in ${GRAY}${CERT_DIR}${RESET}"
}

if [[ ! -f "${CERT_FILE}" || ! -f "${KEY_FILE}" ]]; then
    generate_certificate
fi

# ── Start server ──────────────────────────────────────────────────

echo "🚀 Story writer starting on ${GREEN}https://localhost:${PORT}${RESET}"
echo "   ${GRAY}Project: ${PROJECT_ROOT}${RESET}"
echo "   ${GRAY}Press Ctrl+C to stop${RESET}"

export CERT_FILE KEY_FILE
export PORT
export PLAYGROUND_DIR="${PROJECT_ROOT}/playground"
export READER_DIR="${PROJECT_ROOT}/reader"

exec deno run --allow-net --allow-read --allow-write --allow-env --allow-run "${PROJECT_ROOT}/writer/server.js"

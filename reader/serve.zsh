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
# Start a local HTTPS server with a self-signed certificate.
# Serves files from the current working directory using Node.js.
#
# Usage:
#   serve.zsh [port]
#
# Arguments:
#   port  Port number to listen on (default: 8443)
#
# Requirements:
#   - openssl  (for certificate generation)
#   - node     (for HTTPS server)
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
check_dependency node

# ── Configuration ─────────────────────────────────────────────────

readonly PORT="${1:-8443}"
readonly CERT_DIR="${0:a:h}/.certs"
readonly CERT_FILE="${CERT_DIR}/cert.pem"
readonly KEY_FILE="${CERT_DIR}/key.pem"
readonly SERVE_ROOT="${0:a:h}"

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

echo "🚀 HTTPS server starting on ${GREEN}https://localhost:${PORT}${RESET}"
echo "   ${GRAY}Serving: ${SERVE_ROOT}${RESET}"
echo "   ${GRAY}Press Ctrl+C to stop${RESET}"

exec node -e "
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const ROOT = process.argv[1];
const PORT = parseInt(process.argv[2], 10);
const CERT = process.argv[3];
const KEY  = process.argv[4];

const server = https.createServer({
  cert: fs.readFileSync(CERT),
  key:  fs.readFileSync(KEY),
}, (req, res) => {
  const pathname = decodeURIComponent(url.parse(req.url).pathname);
  let filePath = path.join(ROOT, pathname);

  // Prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Serve index.html for directory requests
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('✅ Listening on https://localhost:' + PORT);
});
" "${SERVE_ROOT}" "${PORT}" "${CERT_FILE}" "${KEY_FILE}"

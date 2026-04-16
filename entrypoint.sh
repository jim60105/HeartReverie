#!/bin/sh
set -eu
umask 002

# When HTTP_ONLY is set, skip TLS certificate generation entirely
# (useful for K8s where TLS is handled at the ingress/reverse-proxy level)
if [ "${HTTP_ONLY:-}" = "true" ]; then
  echo "ℹ️  HTTP_ONLY=true — skipping TLS certificate generation"
else
  # Generate self-signed TLS certificate if not provided
  if [ -z "${CERT_FILE:-}" ] || [ -z "${KEY_FILE:-}" ] || [ ! -f "${CERT_FILE:-}" ] || [ ! -f "${KEY_FILE:-}" ]; then
    # Use /certs/ in container, .certs/ locally
    if [ -d /certs ]; then
      CERT_DIR="/certs"
    else
      CERT_DIR="${CERT_DIR:-.certs}"
      mkdir -p "$CERT_DIR"
    fi
    CERT_FILE="${CERT_DIR}/cert.pem"
    KEY_FILE="${CERT_DIR}/key.pem"

    if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
      echo "⚙️  Generating self-signed TLS certificate..."
      openssl req -x509 \
        -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
        -nodes -days 365 \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0.0.0.0" \
        -keyout "$KEY_FILE" -out "$CERT_FILE" \
        2>/dev/null
      chmod 664 "$CERT_FILE"
      chmod 660 "$KEY_FILE"
      echo "✅ TLS certificate generated at $CERT_FILE"
    fi
    export CERT_FILE KEY_FILE
  fi
fi

# Use dumb-init as PID 1 when available (container), direct exec otherwise (local dev)
if command -v dumb-init >/dev/null 2>&1; then
  exec dumb-init -- deno run \
    --allow-net --allow-read --allow-write --allow-env --allow-run \
    "$@"
else
  exec deno run \
    --allow-net --allow-read --allow-write --allow-env --allow-run \
    "$@"
fi

#!/bin/sh
set -eu

# When HTTP_ONLY is set, skip TLS certificate generation entirely
# (useful for K8s where TLS is handled at the ingress/reverse-proxy level)
if [ "${HTTP_ONLY:-}" = "true" ]; then
  echo "ℹ️  HTTP_ONLY=true — skipping TLS certificate generation"
else
  # Generate self-signed TLS certificate if not provided
  if [ -z "${CERT_FILE:-}" ] || [ -z "${KEY_FILE:-}" ] || [ ! -f "${CERT_FILE:-}" ] || [ ! -f "${KEY_FILE:-}" ]; then
    CERT_FILE="/certs/cert.pem"
    KEY_FILE="/certs/key.pem"
    echo "⚙️  Generating self-signed TLS certificate..."
    openssl req -x509 \
      -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
      -nodes -days 365 \
      -subj "/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0.0.0.0" \
      -keyout "$KEY_FILE" -out "$CERT_FILE" \
      2>/dev/null
    echo "✅ TLS certificate generated at $CERT_FILE"
    export CERT_FILE KEY_FILE
  fi
fi

exec dumb-init -- deno run \
  --allow-net --allow-read --allow-write --allow-env --allow-run \
  "$@"

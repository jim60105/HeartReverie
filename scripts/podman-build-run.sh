#!/usr/bin/env bash
set -euo pipefail

# HeartReverie container build & run script
# Builds both base and plugins images, then runs the plugins container.

PROJECT_DIR="$HOME/repos/HeartReverie/HeartReverie"
PLUGINS_DIR="$HOME/repos/HeartReverie/HeartReverie_Plugins"

BASE_IMAGE="heartreverie:latest"
PLUGINS_IMAGE="heartreverie-plugins:latest"
CONTAINER_NAME="heartreverie"
PORT="${PORT:-8080}"

echo "=== Building base image: $BASE_IMAGE ==="
podman build --jobs 0 -t "$BASE_IMAGE" "$PROJECT_DIR"

echo ""
echo "=== Building plugins image: $PLUGINS_IMAGE ==="
podman build --jobs 0 --build-arg BASE_IMAGE="$BASE_IMAGE" -t "$PLUGINS_IMAGE" "$PLUGINS_DIR"

echo ""
echo "=== Stopping existing container ==="
podman rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo ""
echo "=== Running container: $CONTAINER_NAME ==="
# --userns=keep-id maps container UID 1000 (appuser) to host UID 1000 so the
# bind-mounted plugin directories (owned by the host user) are read/write
# accessible to the container process. Without this, rootless podman maps
# host UID 1000 to container UID 0, leaving appuser unable to write.
# The :z label option lets SELinux relabel the host directories with a shared
# container context (use :Z for a private label if no other container needs them).
podman run -d \
  --name "$CONTAINER_NAME" \
  -p "${PORT}:8080" \
  --userns=keep-id \
  --env-file "$PROJECT_DIR/.env" \
  -v "$PROJECT_DIR/playground:/app/playground:z" \
  -v "$PROJECT_DIR/plugins:/app/plugins:z" \
  -v "$PLUGINS_DIR:/app/external-plugins:z" \
  "$PLUGINS_IMAGE"

echo ""
echo "=== Waiting for server startup ==="
sleep 3
podman logs "$CONTAINER_NAME" 2>&1 | grep -E "Loaded|listening"

echo ""
echo "✅ Container '$CONTAINER_NAME' running on http://localhost:${PORT}"

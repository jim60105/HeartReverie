#!/usr/bin/env bash
set -euo pipefail

# HeartReverie container build & run script
# Builds both base and plugins images, then runs the plugins container.

PROJECT_DIR="$HOME/repos/HeartReverie"
PLUGINS_DIR="$HOME/repos/HeartReverie_Plugins"

BASE_IMAGE="heartreverie:latest"
PLUGINS_IMAGE="heartreverie-plugins:latest"
CONTAINER_NAME="heartreverie"
PORT="${PORT:-8443}"

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
podman run -d \
  --name "$CONTAINER_NAME" \
  -p "${PORT}:8443" \
  --env-file "$PROJECT_DIR/.env" \
  -v "$PROJECT_DIR/playground:/app/playground:z" \
  "$PLUGINS_IMAGE"

echo ""
echo "=== Waiting for server startup ==="
sleep 3
podman logs "$CONTAINER_NAME" 2>&1 | grep -E "Loaded|listening"

echo ""
echo "✅ Container '$CONTAINER_NAME' running on https://localhost:${PORT}"

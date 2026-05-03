# syntax=docker/dockerfile:1

ARG UID=1000
ARG VERSION=EDGE
ARG RELEASE=0

########################################
# Download stage
# Fetch external binaries (dumb-init)
########################################
FROM docker.io/library/debian:bookworm-slim AS download

ARG TARGETARCH
ARG TARGETVARIANT

RUN --mount=type=cache,id=apt-$TARGETARCH$TARGETVARIANT,sharing=locked,target=/var/cache/apt \
    --mount=type=cache,id=aptlists-$TARGETARCH$TARGETVARIANT,sharing=locked,target=/var/lib/apt/lists \
    apt-get update && apt-get install -y --no-install-recommends curl ca-certificates

# Download dumb-init static binary (arch-aware) with SHA256 verification
RUN case "${TARGETARCH}" in \
      amd64) DUMBINIT_ARCH="x86_64"; DUMBINIT_SHA256="e874b55f3279ca41415d290c512a7ba9d08f98041b28ae7c2acb19a545f1c4df" ;; \
      arm64) DUMBINIT_ARCH="aarch64"; DUMBINIT_SHA256="b7d648f97154a99c539b63c55979cd29f005f88430fb383007fe3458340b795e" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_${DUMBINIT_ARCH}" \
    -o /dumb-init && \
    echo "${DUMBINIT_SHA256}  /dumb-init" | sha256sum -c -

########################################
# Cache stage
# Pre-cache Deno dependencies for layer reuse
########################################
FROM docker.io/denoland/deno:debian AS deno-cache

WORKDIR /app

COPY deno.json deno.lock ./

# Pre-cache all npm dependencies from import map
RUN deno install --lock=deno.lock

COPY writer/ ./writer/

# Pre-cache backend dependencies
RUN deno cache --lock=deno.lock writer/server.ts

########################################
# Frontend build stage
# Build the Vue frontend with Vite
########################################
FROM docker.io/denoland/deno:debian AS frontend-build

WORKDIR /app

COPY --from=deno-cache /deno-dir/ /deno-dir/

COPY deno.json deno.lock ./
COPY reader-src/ ./reader-src/

ENV DENO_DIR=/deno-dir

WORKDIR /app

# Type-check and build the frontend using the project task versions.
RUN deno task build:reader

########################################
# Final stage
########################################
FROM docker.io/denoland/deno:debian AS final

ARG UID

# Create non-root user (OpenShift compatible: UID:GID 0)
RUN useradd -l -u $UID -g 0 -m -s /bin/sh -N appuser

# Create directories with proper permissions
RUN install -d -m 775 -o $UID -g 0 /app && \
    install -d -m 775 -o $UID -g 0 /licenses && \
    install -d -m 775 -o $UID -g 0 /deno-dir/ && \
    install -d -m 775 -o $UID -g 0 /app/playground

# Copy dumb-init from download stage
COPY --link --chown=$UID:0 --chmod=775 --from=download /dumb-init /usr/local/bin/dumb-init

# Copy license (OpenShift Policy)
COPY --link --chown=$UID:0 --chmod=775 LICENSE /licenses/LICENSE

# Copy cached Deno dependencies from cache stage
COPY --chown=$UID:0 --chmod=775 --from=deno-cache /deno-dir/ /deno-dir/

# Copy application files
COPY --link --chown=$UID:0 --chmod=775 deno.json deno.lock system.md /app/
COPY --link --chown=$UID:0 --chmod=775 writer/ /app/writer/
COPY --link --chown=$UID:0 --chmod=775 --from=frontend-build /app/reader-dist/ /app/reader-dist/
COPY --link --chown=$UID:0 --chmod=775 assets/ /app/assets/
COPY --link --chown=$UID:0 --chmod=775 plugins/ /app/plugins/

ENV DENO_DIR=/deno-dir

WORKDIR /app

VOLUME ["/app/playground"]

EXPOSE 8080

USER $UID:0

STOPSIGNAL SIGTERM

# `dumb-init` forwards signals as PID 1; the inline `sh -c` shim sets
# `umask 0002` so directories Deno creates at runtime via Deno.mkdir
# (which honours the inherited umask) preserve OpenShift arbitrary-UID
# + shared-GID-0 group-write semantics. The trailing `exec` replaces the
# shell with Deno so signal forwarding from dumb-init reaches it directly.
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "umask 0002 && exec deno run --allow-net --allow-read --allow-write --allow-env --allow-run writer/server.ts"]

ARG VERSION
ARG RELEASE
LABEL name="heartreverie" \
    vendor="Jim Chen" \
    maintainer="jim60105" \
    url="https://github.com/jim60105/HeartReverie" \
    version=${VERSION} \
    release=${RELEASE} \
    io.k8s.display-name="HeartReverie 浮心夜夢" \
    summary="Developer-oriented AI interactive fiction engine" \
    description="A developer-oriented AI interactive fiction engine centered on Markdown files and a plugin system. Features a Vue 3 + TypeScript SPA frontend and a Hono backend running on Deno that drives LLM chat via any OpenAI-compatible API. Story content, prompts, and the lore codex are all stored as plain .md files. For more information: https://github.com/jim60105/HeartReverie" \
    org.opencontainers.image.title="HeartReverie 浮心夜夢" \
    org.opencontainers.image.description="Developer-oriented AI interactive fiction engine" \
    org.opencontainers.image.version=${VERSION} \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.source="https://github.com/jim60105/HeartReverie" \
    org.opencontainers.image.vendor="Jim Chen"

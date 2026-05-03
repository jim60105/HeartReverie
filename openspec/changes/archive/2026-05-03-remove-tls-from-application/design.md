## Context

The TLS scaffolding originated in the era when HeartReverie's frontend used the File System Access API and IndexedDB, both of which require a Secure Context. That requirement was removed two changes ago (`remove-fsa-and-indexeddb`), leaving the application's TLS support orphaned: it now exists only to serve `https://localhost:8443` in dev and to provide an `HTTP_ONLY=true` escape hatch for every operator who actually deploys to a real cluster.

Three pieces of code currently coordinate around TLS:

1. **`writer/server.ts`** — reads `CERT_FILE` / `KEY_FILE`, requires them unless `HTTP_ONLY=true`, builds a Deno `serveOptions` object with `cert`/`key` strings, and prints the listening URL with the matching scheme.
2. **`entrypoint.sh`** — short-circuits when `HTTP_ONLY=true`; otherwise auto-detects a cert directory (`/certs` in container, `.certs/` locally), runs `openssl req -x509 -newkey ec` on first boot, and `chmod`s the artifacts (`664` cert, `660` key) for OpenShift arbitrary-UID compatibility. Also `exec`s `dumb-init -- deno run …` to forward signals.
3. **The Helm chart** — implements the same `HTTP_ONLY` exact-lowercase predicate in `templates/deployment.yaml`, projects a `kubernetes.io/tls` Secret to `/certs/{cert.pem,key.pem}` when `tls.existingSecret` is set, falls back to an `emptyDir` `/certs` (so `entrypoint.sh` writes self-signed certs into it) when not, and ships two ingress examples that work around the resulting upstream-HTTPS friction.

Stakeholders: the only consumer of the application is the operator who runs it (today: Jim, the project owner). The pre-1.0 / zero-users rule applies: no migration window, no deprecation shim, no backward-compat code paths.

## Goals / Non-Goals

**Goals:**

- Eliminate every TLS code path inside the application boundary. The Deno server SHALL only ever speak plain HTTP.
- Collapse the three coordination points (server, entrypoint, chart) down to one (the `dumb-init -- deno run` invocation in the Containerfile / `scripts/serve.sh`).
- Remove `HTTP_ONLY`, `CERT_FILE`, `KEY_FILE` from every config surface — env vars, Helm values, docs, `.env.example`, the per-story `_config.json` allow-list documentation.
- Standardize on a single fixed listen port — `8080` — across the application config default, the Containerfile `EXPOSE`, the Helm `app.port`/`service.port` defaults, the podman-build-run port mapping, and the documented "default URL" strings.
- Delete `entrypoint.sh` outright. The signal-forwarding role of `dumb-init` moves into a static `ENTRYPOINT ["dumb-init", "--"]`; the cert-handling role disappears with TLS; the umask role moves into the Containerfile via `USER`/`WORKDIR` semantics or an explicit `RUN` step (see Decision 4).
- Preserve `scripts/serve.sh` as a local-dev convenience but reduce it to "set project-relative paths and exec deno". No cert generation, no scheme switch.

**Non-Goals:**

- Adding application-level support for TLS-terminating reverse proxies (e.g., custom `X-Forwarded-Proto` handling, redirect-to-HTTPS, HSTS injection). Operators run the application behind whatever TLS terminator they want; HeartReverie does nothing about it.
- Providing a sidecar TLS proxy in the Helm chart. Operators wire that up themselves with their controller of choice; we will not ship a built-in `cert-manager` integration, a `caddy` sidecar, or any equivalent.
- Migration tooling. Old `_config.json` files never carried `HTTP_ONLY`/`CERT_FILE`/`KEY_FILE` (those are server-level env vars, never per-story), so no on-disk migration is needed.
- Touching unrelated `LLM_*` or plugin surfaces. This proposal is strictly about the transport layer.
- Updating `system.md` or any prompt template — TLS is not surfaced in templates.

## Decisions

### Decision 1 — Plain HTTP only, no in-app TLS toggle

**What:** `writer/server.ts` SHALL pass `Deno.serve()` an options object with `port` and `hostname` only — no `cert`, no `key`, no protocol branch. The `httpOnly` boolean and the `Deno.env.get("HTTP_ONLY")` read disappear.

**Why:** Every real deployment topology (Helm + ingress, podman + reverse proxy, dev tunnel) terminates TLS upstream. The `HTTP_ONLY=true` configuration therefore covers every real operator path; the in-pod TLS path covers nothing except localhost dev with a self-signed-cert browser warning. Deleting the choice removes a coordination point across server/entrypoint/chart and removes a class of misconfiguration (e.g., `HTTP_ONLY=TRUE` capitalized differently in different places).

**Alternatives considered:**

- *Keep TLS, hide it behind a non-default flag.* Rejected — the cost is the entire `entrypoint.sh` script plus three coordination points; the benefit (`https://localhost:8443` works in `curl` without `-k`) is not worth it.
- *Speak HTTP/2 cleartext (`h2c`).* Rejected — the upstream LLM connection is the only HTTP/2 user in this stack and it's outbound; the inbound path is plain HTTP/1.1 + WebSocket, where h2c is irrelevant.

### Decision 2 — Single fixed port `8080`

**What:** The default listen port becomes `8080` in `writer/lib/config.ts`, the Containerfile `EXPOSE`, the Helm `app.port` / `service.port` defaults, `scripts/serve.sh`'s default for the optional `[port]` arg, `scripts/podman-build-run.sh`'s `-p ${PORT}:8080` mapping, and every "default URL" string in the docs (`README.md`, `AGENTS.md`, `docs/helm-deployment.md`, `helm/heart-reverie/README.md`, `.env.example`).

**Why:** `8080` is the unprivileged-HTTP convention and matches the chart's `tcpSocket` probe defaults the same way `8443` matched the prior HTTPS contract. Keeping `8443` after dropping HTTPS would be confusing — `8443` reads as "TLS" to anyone with operator instincts.

**Alternatives considered:**

- *Keep `8443` to minimize chart-value diffs.* Rejected — the diff is one-time and `8443` over plain HTTP would mislead every future reader.
- *Pick `3000` (Node convention) or `5000` (Flask convention).* Rejected — neither has a strong claim, and `8080` is what the rest of the Helm/k8s ecosystem expects for a "generic web app" container.

### Decision 3 — Delete `entrypoint.sh`; static ENTRYPOINT/CMD with `sh -c` umask shim

**What:** Remove `entrypoint.sh` from the repo and from the `Containerfile`'s `COPY`. The Containerfile's `ENTRYPOINT` becomes `["dumb-init", "--"]` and the `CMD` invokes the Deno server through an inline `sh -c` shim that sets the process umask before `exec`'ing Deno:

```dockerfile
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "umask 0002 && exec deno run --allow-net --allow-read --allow-write --allow-env --allow-run writer/server.ts"]
```

This preserves PID-1 signal forwarding (the only reason `dumb-init` was there in the first place) AND preserves the `umask 0002` discipline that the deleted `entrypoint.sh` previously provided — see Decision 4 below for why that umask is still load-bearing.

**Override semantics — be honest:** This `ENTRYPOINT`/`CMD` shape does NOT preserve the previous `podman run … <image> writer/server.ts` style overrides as if they were Deno arguments. With `ENTRYPOINT ["dumb-init", "--"]` and the new shell-form `CMD`, an override like `podman run image writer/server.ts` becomes `dumb-init -- writer/server.ts`, which fails because `writer/server.ts` is not an executable. Operators wanting to override the default command must now provide a complete executable invocation — e.g., `podman run image deno --version` or `podman run image sh -c "umask 0002 && exec deno run … writer/server.ts"`. This is the standard OCI convention and matches how virtually every other community image ships its `CMD`.

**Why:** Once cert handling is gone, `entrypoint.sh` is a six-line shim around `umask 0002 && dumb-init -- deno run`. Inlining the umask into the `CMD` instead keeps the umask without re-introducing a script file: there is no `entrypoint.sh` to lint, ship, chmod, or hide a regression in.

**Alternatives considered:**

- *Keep `entrypoint.sh` as a one-line `umask 0002 && exec deno run …` wrapper.* Rejected — the script provides zero structural value once TLS handling is gone; an inline `sh -c` `CMD` carries the same semantics with no separate file to maintain.
- *Use Tini or `--init` instead of `dumb-init`.* Rejected — `dumb-init` is already in the build chain with a verified SHA256, and changing the PID-1 binary is out of scope for this proposal.
- *Use `CMD ["deno", "run", …]` directly with no shell.* Rejected — would skip `umask 0002`, breaking OpenShift arbitrary-UID + shared-GID-0 file-creation guarantees on directories created at runtime (verified empirically: `Deno.mkdir({ mode: 0o775 })` produces `0o755` under inherited `umask 0022`).

### Decision 4 — `umask 0002` is still required, set via `sh -c` in `CMD` (and `scripts/serve.sh`)

**What:** Set `umask 0002` at process-start time in two places — the Containerfile `CMD` (via the `sh -c` shim from Decision 3) and `scripts/serve.sh` (a single `umask 0002` line before `exec deno run …`).

**Why this is required:** Empirical testing on the Deno runtime in use (v2.7.x) confirms two distinct behaviours:

1. **Files** created with `Deno.writeTextFile(path, data, { mode: 0o664 })` ARE created with mode `0o664` regardless of the inherited umask — Deno explicitly `chmod`s the file after creation, so umask does not mask it. Verified under both `umask 0022` and `umask 0077`.
2. **Directories** created with `Deno.mkdir(path, { recursive: true, mode: 0o775 })` ARE subject to umask. Verified: under inherited `umask 0022` the resulting mode is `0o755` (group-writable bit dropped); under `umask 0077` it becomes `0o700`.

The "rely on explicit `mode:` everywhere and forget about umask" plan I originally drafted therefore breaks group-write on every directory the application creates at runtime — `playground/<series>/<story>/`, `_logs/`, `_usage.json`'s parent on first creation, branch-copy destinations, etc. That regression directly defeats the OpenShift arbitrary-UID + shared-GID-0 contract that the `container-file-permissions` capability codifies. Setting `umask 0002` at process start preserves the existing contract for both files (defence-in-depth) and directories (load-bearing).

**Why `sh -c` and not `entrypoint.sh`:** Re-introducing `entrypoint.sh` purely for two characters of umask config would defeat the whole "delete `entrypoint.sh`" goal. Inlining `umask 0002 && exec deno run …` inside a `sh -c` argument keeps the file gone while preserving the behaviour. The shell process is short-lived (it `exec`s Deno), so it doesn't sit between `dumb-init` and Deno for signal handling.

**Verification (still required during implementation):** `grep -nE 'writeTextFile|Deno\.open|Deno\.mkdir|Deno\.writeFile' writer/lib/*.ts writer/routes/*.ts` to confirm every runtime write site passes an explicit `mode:` option. This is defence-in-depth on top of the umask shim — both layers protect group-write.

**Alternatives considered:**

- *Drop `umask 0002` and rely solely on explicit `mode:` options.* Rejected — empirically broken for `Deno.mkdir`, see above.
- *Add `Deno.chmod(path, 0o775)` after every `Deno.mkdir` site.* Rejected — N+1 chmod calls per write site, every one of which is an opportunity to forget; the umask shim handles all of them with one line.
- *Switch the container base image to one that ships `umask 0002` by default.* No such image exists in the chain (`docker.io/denoland/deno:debian` uses Debian's `umask 0022` default).

### Decision 5 — Helm chart simplification

**What:** Strip every TLS-related branch from `helm/heart-reverie/templates/deployment.yaml`:

- Delete the `$httpOnlyValue` / `$httpOnly` variable assignments at the top.
- Delete the `if not $httpOnly` block around the `/certs` `volumeMount` (lines 122–127).
- Delete the `if not $httpOnly` block around the `certs` `volume` (lines 143–155).
- Drop the matching `tls` block from `values.yaml` and `values.schema.json`.
- Drop the `HTTP_ONLY: "true"` line from `examples/values-traefik.yaml` and the long comment block above it.
- Drop the `nginx.ingress.kubernetes.io/backend-protocol: HTTPS` annotation from `examples/values-nginx.yaml`.
- Update `app.port` default from `8443` to `8080` (the chart's "single source of truth for listening port").
- Update `service.port` default from `8443` to `8080`.

**Why:** With no in-pod TLS, the chart no longer needs `/certs` plumbing or an `HTTP_ONLY` toggle. The two ingress examples become uniform — both point at the plain-HTTP service on port 8080.

### Decision 6 — `scripts/serve.sh` becomes a 5-line wrapper with `umask 0002`

**What:** Reduce `scripts/serve.sh` to:

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 0002

readonly PROJECT_DIR="$HOME/repos/HeartReverie"
readonly PLUGINS_DIR="$HOME/repos/HeartReverie_Plugins"

# Optional port override (default 8080)
if [[ -n "${1:-}" ]]; then
  if [[ ! "$1" =~ ^[0-9]+$ ]] || (( 10#$1 < 1 || 10#$1 > 65535 )); then
    echo "❌ Invalid port: $1 (must be 1..65535)" >&2
    exit 1
  fi
fi

export PORT="${1:-8080}"
export PLAYGROUND_DIR="${PROJECT_DIR}/playground"
export READER_DIR="${PROJECT_DIR}/reader-dist"
export PLUGIN_DIR="${PLUGINS_DIR}"

echo "🚀 Story writer starting on http://localhost:${PORT}"
echo "   Project: ${PROJECT_DIR}"
echo "   Press Ctrl+C to stop"

cd "$PROJECT_DIR"
exec deno run \
  --allow-net --allow-read --allow-write --allow-env --allow-run \
  writer/server.ts
```

No `CERT_DIR` export, no `entrypoint.sh` delegation, no scheme switch. The `umask 0002` line is required for parity with the container — the local-dev process must produce group-writable runtime directories the same way.

**Why:** `entrypoint.sh` is gone. `scripts/serve.sh` was already a thin wrapper around it; with `entrypoint.sh` deleted we wrap `deno run` directly. The `umask 0002` line is the local-dev twin of the Containerfile `sh -c` shim — it ensures `Deno.mkdir({ mode: 0o775 })` produces `0o775` directories instead of being masked to `0o755`. The hard-coded `$HOME/repos/HeartReverie` path is pre-existing and out of scope.

### Decision 7 — `HeartReverie_Plugins/Containerfile` confirmation

The plugins image inherits everything from `BASE_IMAGE` (default `ghcr.io/jim60105/heartreverie:latest`) and adds only `COPY` instructions for plugin files plus a `PLUGIN_DIR` env var. It does **not** override `ENTRYPOINT`, `CMD`, `EXPOSE`, or any TLS-related setting. After this change, the inherited `ENTRYPOINT`/`CMD` will be the new `dumb-init -- deno run …` pair, and the inherited `EXPOSE` will be `8080` — both work for the plugins extension image with no changes required.

If a future plugin shipping in the plugins repo ever needs to reach into the certs path, that would have been a hard-to-detect pre-existing breakage; we deliberately do **not** preserve that path.

## Risks / Trade-offs

- **[Risk] Operator who relied on `https://localhost:8443` in their browser bookmarks/scripts loses access on next pull.** → Mitigation: pre-1.0 / zero-users rule per project policy. The CHANGELOG `[Unreleased] / Removed` entry documents the breaking change loudly.
- **[Risk] Reverse-proxy operators who didn't set `HTTP_ONLY=true` will see their connection fail after upgrade because the upstream is now plain HTTP, but their proxy is configured for upstream HTTPS.** → Mitigation: documented in the CHANGELOG `Removed` entry. Specifically call out: "If you were running with self-signed certs in-pod (the chart default before this release), your ingress controller's `backend-protocol: HTTPS` (nginx) or `ServersTransport` (Traefik) annotation must be removed." Examples in the chart already do this.
- **[Risk] OpenShift arbitrary-UID file permissions regress because `entrypoint.sh`'s `umask 002` is gone.** → Mitigation: the `umask 0002` is preserved via a `sh -c` shim inside the Containerfile `CMD` (and in `scripts/serve.sh`). See Decision 4 — empirically verified that `Deno.mkdir({ mode: 0o775 })` is masked to `0o755` under inherited `umask 0022`, so the umask shim is load-bearing for runtime-created directories. Files are independent (Deno explicit-`chmod`s them after creation), but explicit `mode:` discipline is still verified during implementation as defence-in-depth.
- **[Risk] Helm chart upgrade in-place breaks because `tls.existingSecret` was set in the operator's old `values.yaml`.** → Mitigation: the chart now silently ignores unknown values (Helm default). The user upgrades, the `tls` block becomes a no-op, the cert volume disappears on the next pod restart. The CHANGELOG entry asks operators to drop the `tls` block from their `values.yaml` for cleanliness, but it's not blocking.
- **[Risk] Some hidden test or script grep-references `HTTP_ONLY` / `CERT_FILE` / `KEY_FILE` and breaks at runtime.** → Mitigation: do an exhaustive `grep -rE 'HTTP_ONLY|CERT_FILE|KEY_FILE|httpOnly|certFile|keyFile' .` sweep during implementation, including `tests/`, `helm/`, `scripts/`, and `.agents/`. Captured as a task item.
- **[Trade-off] Local dev now requires a separate TLS-terminator if the developer wants to test the application against something that mandates HTTPS (e.g., Service Workers, the `Notification` API, OAuth callbacks).** → Acceptance: HeartReverie no longer uses any browser API that requires a Secure Context. Browser features that need HTTPS are out of scope for this app.

## Migration Plan

Per project policy (zero users, pre-1.0): there is no migration plan. The change lands as a single commit + CHANGELOG entry. Operators upgrading their Helm release lose the `tls.*` values (silently ignored) and pick up the new `app.port=8080`; they must update their Service/Ingress consumers to the new port, which is the same diff they'd make against any breaking chart bump.

## Open Questions

- None known at proposal time. Implementation will resolve any small ambiguities (e.g., exact `dumb-init` arg list quoting in the `CMD`) during the audit task.

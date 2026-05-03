## Why

HeartReverie ships its own self-signed TLS layer in three places — `entrypoint.sh` (`openssl req -x509`), `writer/server.ts` (Deno TLS server with `cert`/`key` options), and the Helm chart (`/certs` mounts, `tls.existingSecret` projection, `HTTP_ONLY` exact-lowercase predicate gating both). The original justification was the File System Access API's Secure-Context requirement; that frontend feature was removed in `remove-fsa-and-indexeddb`, so the TLS scaffolding now exists only to make `https://localhost:8443` "work out of the box" in dev.

In practice that scaffolding is a net liability:

- Every operator hits self-signed-cert friction (browser warnings, the `--ignore-https-errors` agent-browser flag, Traefik `ServersTransport` CRDs to skip upstream verification, ingress-nginx `backend-protocol: HTTPS` annotations);
- Every deployment topology that actually wants TLS — Kubernetes, reverse proxies, dev tunnels — terminates it upstream and asks the pod to speak plain HTTP anyway, which is exactly what `HTTP_ONLY=true` already configures;
- The application owns three coupled implementations of "should I do TLS?" (config, server boot, entrypoint, Helm) plus a cert-permission spec for OpenShift arbitrary-UID compatibility.

The simpler design is: **HeartReverie speaks plain HTTP on a single fixed port (8080); TLS is the operator's job, not the application's.** This proposal deletes the TLS code path entirely along with `entrypoint.sh`, drops `HTTP_ONLY`/`CERT_FILE`/`KEY_FILE`, and rebases the container/Helm/Compose surfaces on `dumb-init -- deno run … writer/server.ts` directly. Plain `http://localhost:8080` becomes the only supported in-application transport. This is **BREAKING** — but per the long-standing project rule there are zero users in the wild and no migration burden to consider.

## What Changes

- **BREAKING** Remove TLS support from the application. The server SHALL only listen on plain HTTP. There is no `--cert`/`--key`, no `Deno.serve()` `cert`/`key` options, no startup-time cert reading.
- **BREAKING** Change the default listen port from `8443` to `8080`. All references — config default, Containerfile `EXPOSE`, Helm `app.port` / `service.port` defaults, podman-build-run.sh port mapping, README/AGENTS docs — move to `8080`. `PORT` env override is preserved.
- **BREAKING** Remove the `HTTP_ONLY`, `CERT_FILE`, and `KEY_FILE` environment variables from the configuration surface, the documentation, the Helm `values.yaml` comments, the Helm Secret/Deployment template logic, and the per-story `_config.json` allow-list documentation.
- **BREAKING** Delete `entrypoint.sh`. The container `ENTRYPOINT` becomes `["dumb-init", "--"]` and the `CMD` becomes a `sh -c` shell shim of the form `["sh", "-c", "umask 0002 && exec deno run … writer/server.ts"]`. The `umask 0002` and signal handling that previously lived in `entrypoint.sh` are preserved — the umask via the inline shell shim (and a matching `umask 0002` line in `scripts/serve.sh`), the signal handling via `dumb-init -- exec deno`.
- Simplify `Containerfile`:
  - Drop the `apt-get install openssl` step from the final stage (only `entrypoint.sh` needed it).
  - Drop the `install -d /certs` step from the final stage.
  - Replace `ENTRYPOINT ["/app/entrypoint.sh"]` + `CMD ["writer/server.ts"]` with `ENTRYPOINT ["dumb-init", "--"]` + `CMD ["sh", "-c", "umask 0002 && exec deno run --allow-net --allow-read --allow-write --allow-env --allow-run writer/server.ts"]`.
  - Update `EXPOSE 8443` → `EXPOSE 8080`.
- Simplify `scripts/serve.sh` (preserved for local dev):
  - Drop the auto-generated cert step (was delegated to `entrypoint.sh`).
  - Drop the `CERT_DIR` export.
  - Drop the `HTTP_ONLY` scheme-switch logic added in `remove-fsa-and-indexeddb`.
  - The script becomes a thin `deno run ...` invocation that sets project-relative `PLAYGROUND_DIR` / `READER_DIR` / `PLUGIN_DIR` / `PORT` and execs the server directly. Default URL: `http://localhost:8080`.
- Simplify the Helm chart:
  - Remove the `tls` block from `values.yaml` and the chart README parameter table.
  - Remove the `$httpOnly` predicate, the `/certs` `volumeMount`, and the `certs` `volume` (both `secret`-typed and `emptyDir` arms) from `templates/deployment.yaml`.
  - Change `app.port` and `service.port` defaults from `8443` to `8080` in `values.yaml`.
  - Drop the "TLS Cert Directory" requirement and all TLS-mode scenarios from the chart docs and examples (`examples/values-traefik.yaml` and `examples/values-nginx.yaml`).
  - Drop `HTTP_ONLY: "true"` from the Traefik example (it becomes the only mode, so the env var is gone).
  - Drop the `nginx.ingress.kubernetes.io/backend-protocol: HTTPS` annotation from the nginx example (upstream is now plain HTTP).
- Simplify `scripts/podman-build-run.sh`:
  - Remove the `-e HTTP_ONLY="true"` flag.
  - Update the published-port mapping from `${PORT}:8443` to `${PORT}:8080`.
- Drop the `umask 002` / `chmod 664` cert / `chmod 660` key requirements from the `container-file-permissions` capability — the cert-permission half existed only for runtime cert generation. The `umask 0002` itself is **preserved** (it is load-bearing for runtime-created directories) by being inlined into the Containerfile `CMD` (`sh -c "umask 0002 && exec …"`) and into `scripts/serve.sh` (a single `umask 0002` line near the top).
- Update `HeartReverie_Plugins/Containerfile` (sibling repo at `$HOME/repos/HeartReverie_Plugins`) only if it carries TLS-specific overrides; the inspection in `proposal` notes shows the plugins image inherits everything from `BASE_IMAGE` and adds no TLS surface, so no change is required there beyond confirming the inheritance still works after the base image's `ENTRYPOINT`/`CMD` change.
- Documentation sweep: remove every public mention of HTTPS, self-signed certs, `HTTP_ONLY`, `CERT_FILE`, `KEY_FILE`, "Secure Context" hardening framing, `https://localhost:8443`, and the per-port-default `8443` from `README.md`, `AGENTS.md`, `docs/helm-deployment.md`, `helm/heart-reverie/README.md`, the Helm examples, `.env.example`, and `CHANGELOG.md`. Add a `[Unreleased] / Removed` entry to `CHANGELOG.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `unified-server`: Drop the "Certificate generation" and HTTPS framing from the writer-backend startup contract; the server now listens on plain HTTP only.
- `writer-backend`: Update the server-startup scenario to remove the "valid TLS certificates" precondition; switch the protocol assertion from HTTPS to HTTP.
- `deno-migration`: Remove the "Deno TLS server" requirement (the historical migration intent stays, but the artifact no longer ships TLS).
- `containerization`: Remove the entire R12 "TLS Certificate Handling and HTTP_ONLY Mode" requirement; remove the `entrypoint.sh` cert-handling references; update the final-stage description to drop the `openssl` install; switch the entrypoint contract to "Containerfile launches `dumb-init -- deno run … writer/server.ts` directly".
- `container-file-permissions`: Remove the "Entrypoint umask", "TLS certificate file permissions", and the `entrypoint.sh` executable-bit requirements. The script-executable-bit requirement is reduced to `scripts/serve.sh` only; the umask requirement, if still needed for OpenShift compatibility on runtime-created story files, moves to a Containerfile-level construct (see design.md).
- `helm-chart`: Drop the TLS-related requirements (`TLS Cert Directory` and the `HTTP_ONLY`-gated scenarios in "Service" / "Single Source of Truth for Listening Port" / "Ingress example files"); change the default port from 8443 to 8080 in every requirement that pins a port; drop `tls.existingSecret`/`tls.certKey`/`tls.keyKey` from the chart-values surface; drop the `HTTP_ONLY` Traefik scenario and the `backend-protocol: HTTPS` nginx-example scenario.
- `env-example`: Drop `HTTP_ONLY`, `CERT_FILE`, and `KEY_FILE` from the required-entries list.

## Impact

- **Affected source files**: `writer/server.ts`, `writer/lib/config.ts`, `entrypoint.sh` (deleted), `Containerfile`, `scripts/serve.sh`, `scripts/podman-build-run.sh`, `helm/heart-reverie/values.yaml`, `helm/heart-reverie/templates/deployment.yaml`, `helm/heart-reverie/templates/secret.yaml` (if it currently strips/exposes any TLS keys), `helm/heart-reverie/examples/values-traefik.yaml`, `helm/heart-reverie/examples/values-nginx.yaml`, `helm/heart-reverie/README.md`.
- **Affected documentation**: `README.md`, `AGENTS.md`, `docs/helm-deployment.md`, `.env.example`, `CHANGELOG.md`.
- **Affected sibling repo**: `$HOME/repos/HeartReverie_Plugins/Containerfile` — verify the inherited entrypoint still works.
- **Affected ports**: container `EXPOSE` 8443 → 8080; chart `app.port` / `service.port` defaults 8443 → 8080; podman-build-run published port; default URL strings in docs.
- **Affected Kubernetes objects**: Deployment loses the `certs` `volumeMount`/`volume`; Ingress examples lose upstream-HTTPS annotations.
- **Removed configuration surface**: `HTTP_ONLY`, `CERT_FILE`, `KEY_FILE` env vars; `tls.existingSecret`, `tls.certKey`, `tls.keyKey` Helm values.
- **Tests**: any backend test that imports `HTTP_ONLY` / `CERT_FILE` / `KEY_FILE` or depends on TLS startup — most likely none, but `tests/writer/lib/config_test.ts` (or equivalent) will need its expectations narrowed if it asserted on `CERT_FILE` / `KEY_FILE`. Helm template snapshot tests (if any) need updates for the dropped TLS volume/mount.
- **Breaking-change posture**: per the long-standing project rule (zero users in the wild, pre-1.0), this is a clean removal with no migration shim, no deprecation window, and no backward-compatibility code.

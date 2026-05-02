## Why

HeartReverie ships an OCI image (`ghcr.io/jim60105/heartreverie:latest`) and a `Containerfile`, but operators who want to run it on Kubernetes have to write all manifests from scratch — Deployment, Service, PVC for `playground/` story data, a Secret for `LLM_API_KEY`/`PASSPHRASE`, and an Ingress (Traefik or nginx) that talks HTTPS upstream because the pod auto-generates self-signed TLS certs at startup. We need a first-party Helm chart that captures this deployment shape so users can `helm install` the project the same way they install everything else in their cluster.

## What Changes

- Add a `helm/heart-reverie/` chart in this repository that renders a Deployment, Service, optional Ingress, optional ConfigMap (for opt-in custom prompt overrides), Secret (for env vars), and PersistentVolumeClaim for the playground volume.
- Image is configurable via `image.repository`/`image.tag`/`image.pullPolicy`; default `ghcr.io/jim60105/heartreverie:latest` with `pullPolicy: Always`.
- All application configuration is delivered as environment variables — the chart exposes a flat `env:` map (UPPER_SNAKE keys, mirroring `.env.example`) plus an `extraEnv:` passthrough list. The full `env:` map is rendered into a single Kubernetes `Secret` (named `<fullname>-secret`) and consumed via `envFrom: secretRef:` (matching the precedent set by the AIr-Friends chart at `/var/home/jim60105/repos/air-friends/helm`). Values are string-coerced with `toString | quote` so booleans (`false`) and numerics (`0`) survive Helm's `--set` parsing rather than silently dropping; only `nil` and the empty string `""` are skipped.
- PVC mounts at the playground path (default `/app/playground`); `persistence.existingClaim` lets operators reuse an existing claim, and `persistence.storageClass` selects a non-default StorageClass when the cluster has no default class. The PVC is named `<fullname>-data` and carries `helm.sh/resource-policy: keep` so `helm uninstall` does not destroy story data.
- Ingress annotations are NOT chart-injected — operators paste their own Traefik / ingress-nginx annotations under `ingress.annotations` (raw passthrough). Two example values files (`examples/values-traefik.yaml`, `examples/values-nginx.yaml`) ship with the chart so users can copy-paste a working starting point that includes the upstream-HTTPS annotation that HeartReverie's self-signed TLS pod requires.
- Sample `values.yaml` carries placeholder defaults for required env vars (`LLM_API_KEY`, `PASSPHRASE`) plus inline-commented optional keys so `helm show values` is also the operator's reference.
- A single authoritative port value (`app.port`, default `8443`) drives the container `containerPort`, the Service `targetPort`, the TCP probe ports, AND the `PORT` env var injected into the Secret — preventing the classic chart footgun where `service.port`, the container port, and the app's listen port can drift apart.
- Security defaults: `runAsUser: 1000` / `runAsGroup: 0` (matching the image's `USER 1000:0`), `fsGroup: 0` with `fsGroupChangePolicy: OnRootMismatch`, `allowPrivilegeEscalation: false`, `automountServiceAccountToken: false` (the pod does not call the Kubernetes API), single replica with `strategy.type: Recreate` (HeartReverie writes story files directly on the playground volume — concurrent pods sharing a RWX claim will race).
- Liveness and readiness probes use `tcpSocket` against the configured app port so the same probe definition works for both HTTPS (default) and HTTP-only modes.
- Documentation: chart-level `README.md` (English), `docs/helm-deployment.md` (Traditional Chinese, mirroring existing docs/*.md style), and a "Helm 部署 / Helm Deployment" subsection in the root `README.md`.

## Capabilities

### New Capabilities

- `helm-chart`: First-party Helm chart at `helm/heart-reverie/` that packages the HeartReverie OCI image into a standard Kubernetes release (Deployment + Service + optional Ingress + Secret + PVC + optional prompt-overrides ConfigMap), with operator-facing values surface, env-var-driven configuration, persistent story data, and example values files for common ingress controllers.

### Modified Capabilities

(none — this change does not alter any existing capability's requirements)

## Impact

- **New files**: `helm/heart-reverie/{Chart.yaml, values.yaml, .helmignore, README.md, templates/*, examples/*}`, `docs/helm-deployment.md`.
- **Modified files**: root `README.md` gains a Helm deployment subsection.
- **No changes to runtime code, APIs, or dependencies.** The chart consumes the existing `Containerfile`-built image as-is and uses the env-var configuration surface already documented in `AGENTS.md` and `writer/lib/config.ts`.
- **No backward-compatibility burden**: HeartReverie is pre-release (no public users) per the change brief, so the chart is `version: 0.1.0` and the proposal does not need to define a stability contract.
- **Operator prerequisites**: Helm ≥ 3.10 and Kubernetes ≥ 1.27 (for `networking.k8s.io/v1` Ingress).

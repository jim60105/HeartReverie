## Context

HeartReverie is distributed as an OCI image (`ghcr.io/jim60105/heartreverie:latest`, built from the in-repo `Containerfile`). The image runs as `USER 1000:0`, listens on `:8443` over HTTPS using self-signed certs that `entrypoint.sh` generates at boot into `/certs` (unless `HTTP_ONLY=true`), and persists everything operator-visible — story chapters, `_lore/` codex passages, `_usage.json` token-usage records, optional prompt overrides — under `/app/playground`. Required env vars are `LLM_API_KEY` and `PASSPHRASE`; everything else (LLM tuning, log paths, plugin dir) has sensible defaults documented in `AGENTS.md` and validated by `writer/lib/config.ts`.

The reference chart at `/var/home/jim60105/repos/air-friends/helm` (a peer project from the same maintainer) sets the house style we adopt here: a single Secret carries every env var via `envFrom: secretRef:`; templates iterate `range $key, $value := .Values.env` so operators add new keys without editing templates; PVCs are annotated `helm.sh/resource-policy: keep` so `helm uninstall` does not destroy data; ingress annotations are passed through verbatim so the chart works with any controller; there is no `values.schema.json` and no `NOTES.txt` (deliberate simplicity).

This is a greenfield deployment surface — no prior chart, no users to migrate.

## Goals / Non-Goals

**Goals:**

- One-command install: `helm install hr ./helm/heart-reverie -n heart-reverie --create-namespace --set env.LLM_API_KEY=… --set env.PASSPHRASE=…` produces a working pod that serves the reader UI on the configured Ingress host.
- Operator-facing values surface mirrors the documented env var names directly (UPPER_SNAKE keys under `env:`), so anyone who has read `AGENTS.md` knows what to set.
- Story data survives `helm uninstall` by default (PVC retention).
- Self-signed in-pod TLS is the default but `HTTP_ONLY=true` mode is supported for operators who terminate TLS at the ingress controller and want to skip cert generation.
- Two ready-to-use ingress recipes: Traefik and ingress-nginx, both demonstrating the upstream-HTTPS annotation needed when the pod serves HTTPS with a self-signed cert.

**Non-Goals:**

- **No multi-replica HA**. HeartReverie writes story files directly on disk with no inter-pod coordination; running ≥ 2 replicas against the same RWX claim is unsafe and unsupported. Chart defaults to `replicas: 1` and `strategy: Recreate`. We do not add an `unsafeAllowMultipleReplicas` flag — operators who need scale-out should fork.
- **No managed cert-manager / Issuer wiring**. Operators who want a real CA cert can either feed certs in via `tls.existingSecret` (standard `kubernetes.io/tls` Secret with the `tls.crt` / `tls.key` keys, which the chart projects to `/certs/cert.pem` / `/certs/key.pem` via volume `items`), or terminate TLS at the ingress controller and run with `env.HTTP_ONLY=true`. The chart does not generate `Certificate` CRs.
- **No values.schema.json**. The reference chart deliberately omits it; mirroring keeps the surface small and the CI footprint minimal. Type-checking happens at `helm template` / `helm lint` time only.
- **No NOTES.txt**. The chart `README.md` and `docs/helm-deployment.md` are the operator-facing docs.
- **No ServiceAccount RBAC wiring beyond the basic creation toggle**. The chart's `serviceAccount.create` produces a bare ServiceAccount with no Roles or RoleBindings. The pod does not call the Kubernetes API; operators who need pod-identity for outbound calls wire that themselves via SA annotations or an external operator like ExternalSecrets. The chart does not ship Role/RoleBinding/ClusterRole templates.
- **No HorizontalPodAutoscaler / PodDisruptionBudget**. Single-replica precludes both.

## Decisions

### Decision 1: Single Secret carries all env vars (vs. ConfigMap + Secret split)

**Choice**: All values under `.Values.env` are rendered into a single Kubernetes `Secret` named `<fullname>-secret` (matching the AIr-Friends naming pattern) and consumed by the pod via `envFrom: { secretRef: { name: <fullname>-secret } }`. There is no separate ConfigMap for "non-secret" config.

**Rendering rules** (driven by Major Finding #2 from the proposal critique): the Secret template iterates `range $key, $value := .Values.env` and emits each entry as `{{ $key }}: {{ $value | toString | quote }}`. The skip predicate is `eq $value nil` OR `eq (toString $value) ""` — boolean `false` and numeric `0` ARE preserved (they convert to the strings `"false"` and `"0"` and survive into the Secret). This matters because Helm's `--set env.HTTP_ONLY=true` parses to a YAML boolean and a naive `if $value` guard would treat `false` as empty, while `stringData` requires string values regardless.

**Why**: The reference chart's house style. Operators add a new env key by setting `--set env.NEW_KEY=value` — no template edit, no schema bump. Splitting into typed buckets (the prior design's approach) created a maintenance treadmill where every new HeartReverie env var required two file edits and a values.schema.json amendment. A Secret is a privileged-by-default object in standard RBAC (only namespace admins can read it), which is exactly the level of protection mixed creds + tuning params need anyway.

**Rejected alternative**: ConfigMap for non-secret env (LLM_MODEL, PORT, LOG_LEVEL …) plus Secret for the two credentials. Cleaner audit story but doubles the template surface, requires us to maintain the public/private classification list, and diverges from the reference chart.

**Escape hatch**: `secret.existingSecret: my-prod-secret` — when set, the chart's Secret is not rendered and `envFrom` points at the operator-provided Secret. Operators wiring HeartReverie to ExternalSecrets / sealed-secrets / vault-injectors take this path.

### Decision 2: Self-signed TLS in pod, with `HTTP_ONLY` opt-out

**Choice**: Default values leave `env.HTTP_ONLY` unset, so `entrypoint.sh` generates self-signed certs into an `emptyDir`-mounted `/certs`. The example values files demonstrate two integration patterns:

- `examples/values-nginx.yaml` runs the upstream-HTTPS pattern (`nginx.ingress.kubernetes.io/backend-protocol: HTTPS` + `proxy-ssl-verify: off`) so the controller talks HTTPS to the self-signed pod cert.
- `examples/values-traefik.yaml` runs in `env.HTTP_ONLY=true` mode by default. Traefik's "skip backend TLS verify" requires a `ServersTransport` CRD plus a `serverstransport` annotation, and shipping that as a chart-rendered resource would couple the chart to Traefik's API surface; the file includes a commented-out alternative block showing the ServersTransport approach for operators who prefer in-pod TLS.

**Cert-key contract** (driven by Major Finding #3): when `tls.existingSecret` is set, the chart projects two specific keys from that Secret into `/certs/cert.pem` and `/certs/key.pem` using volume `items`. The keys are configurable via `tls.certKey` (default `tls.crt`, matching `kubernetes.io/tls` Secrets) and `tls.keyKey` (default `tls.key`). This means an operator can hand the chart a stock `kubernetes.io/tls` Secret produced by cert-manager and the cert lands at the path `entrypoint.sh` expects without any further configuration.

**HTTP_ONLY case-sensitivity** (driven by Major Finding #4): the chart's omit-`/certs` predicate is `eq (.Values.env.HTTP_ONLY | default "" | toString) "true"` — exact lowercase match, identical to the runtime check in `entrypoint.sh` and `writer/server.ts`. Any other value (including `"TRUE"`, `"True"`, `"1"`, `"yes"`) leaves `/certs` mounted, matching what the running app does.

**Why**: HeartReverie's frontend (`reader-src/`) uses the File System Access API and IndexedDB, both of which require a Secure Context. End-to-end HTTPS — even with a self-signed in-pod cert — keeps the pod's Secure Context guarantee intact regardless of whether the operator is testing on `localhost`, behind an LE-issued ingress, or behind an internal CA. Operators who already terminate TLS at the controller and want to skip the cert dance set `env.HTTP_ONLY=true`; the chart still works because the upstream port is then served as plain HTTP and the ingress annotation hints become unnecessary.

**Rejected alternative**: Always require operator-supplied TLS Secret. Higher friction for the "I just want to try it on my laptop / kind cluster" path, which is the dominant first-use case.

### Decision 3: Probes use `tcpSocket` not `httpGet`

**Choice**: Liveness and readiness both use `tcpSocket: { port: <containerPort> }`. The defaults are `initialDelaySeconds: 10`, `periodSeconds: 10`, `timeoutSeconds: 3`, `failureThreshold: 3`.

**Why**: The reader-side endpoints (`GET /api/health` doesn't exist; `GET /api/config` requires the `X-Passphrase` header) all require auth, and adding an unauthenticated `/healthz` endpoint to the backend just to satisfy the chart is out of scope for this proposal. A TCP-level probe is sufficient: `entrypoint.sh` cannot bind the port until cert generation completes and the Hono server is ready, so a successful TCP connect is a strong "ready" signal. Operators who later add an HTTP health endpoint can switch to `httpGet` via the `livenessProbe`/`readinessProbe` value overrides without a chart change.

### Decision 4: PVC `helm.sh/resource-policy: keep` is on by default

**Choice**: The PVC template carries the `keep` annotation unconditionally. There is no `persistence.deleteOnUninstall: true` flag.

**Why**: HeartReverie's primary value is the story chapters the user has authored. Accidental `helm uninstall hr` should never wipe that data. Operators who genuinely want to nuke a release run `kubectl delete pvc -l app.kubernetes.io/instance=<rel>` after uninstall — a deliberate, two-step act. This matches the reference chart's pattern.

### Decision 5: Optional prompt-overrides ConfigMap

**Choice** (revised per Major Finding #5): When `prompts.enabled: true`, render a ConfigMap whose `data` keys come from `.Values.prompts.files`. Mount the ConfigMap at `/app/prompt-overrides/` (NOT under `/app/playground/`) and set `env.PROMPT_FILE=/app/prompt-overrides/<filename>` so HeartReverie's `renderSystemPrompt()` reads the override on boot.

**Why outside `/app/playground/`**: a ConfigMap-backed mount under a PVC subpath is brittle (the parent dir must exist on a fresh PVC) and the file is read-only, which would make the in-app Prompt Editor's save endpoint silently fail at runtime. Mounting at a separate read-only path makes the read-only nature of ConfigMap-shipped prompts explicit. The chart `README.md` documents that when `prompts.enabled` is on, the Prompt Editor in the reader UI cannot persist edits — operators who want an editable prompt should instead `kubectl cp` a `system.md` into the playground PVC after first install (or omit `prompts` entirely).

Off by default (the in-image `system.md` is the canonical one).

### Decision 6: Image tag default is `latest`, pull policy `Always`

**Choice**: `image.repository: ghcr.io/jim60105/heartreverie`, `image.tag: latest`, `image.pullPolicy: Always`.

**Why**: HeartReverie ships a single rolling tag publicly; pinning a SemVer in the chart default would lie about what `helm install` produces tomorrow. `Always` ensures every pod restart re-pulls. Operators using GitOps and wanting reproducible installs override `image.tag` to a digest or a release tag.

**Rejected alternative**: Default to a pinned `image.tag: v0.5.0` (current `CHANGELOG.md` head). Forces a chart-version bump for every app release, even when the chart itself is unchanged.

### Decision 7: No chart-injected ingress annotations

**Choice**: `ingress.annotations` is `{}` in `values.yaml`. The chart copies whatever the operator provides verbatim into `metadata.annotations`. Two `examples/values-*.yaml` files demonstrate the Traefik and nginx-specific upstream-HTTPS annotations.

**Why**: The Helm community has converged on annotation-passthrough because every controller (Traefik, nginx, HAProxy, Contour, Istio Gateway, Skipper, AKS App Routing, GKE GCE) has a different annotation vocabulary, often with version-dependent keys. Bundling a controller-detection helper inside the chart turns the chart maintainer into a "keep up with every ingress controller" maintainer; we do not have the bandwidth. Examples files give copy-paste recipes without locking the chart to specific controllers.

### Decision 8: Image runs as 1000:0 with `fsGroupChangePolicy: OnRootMismatch`

**Choice**: `securityContext.runAsUser: 1000`, `runAsGroup: 0`, `fsGroup: 0`, `fsGroupChangePolicy: OnRootMismatch` on the pod; `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: false`, `capabilities.drop: [ALL]` on the container. `automountServiceAccountToken: false` at the pod level.

**Why**: The image's `USER 1000:0` declaration makes UID 1000 the runtime identity. Group 0 (root) is the standard non-privileged-but-readable group used by Red Hat / OpenShift derived images and matches how `entrypoint.sh` writes into `/certs`. `OnRootMismatch` skips the recursive chown on every pod start once the volume is correct — important because `playground/` can grow into thousands of chapter files. `readOnlyRootFilesystem: false` because `entrypoint.sh` writes to `/certs` and Deno writes to `/tmp` — making rootfs read-only would require two `emptyDir` mounts purely for those paths, more friction than the security upside warrants for a single-pod app. `automountServiceAccountToken: false` removes the auto-projected SA token from the pod (HeartReverie does not call the Kubernetes API), eliminating an unnecessary credential surface.

### Decision 9: Single source of truth for the listening port

**Choice** (driven by Major Finding #1): A single value `app.port` (default `8443`) is the authoritative listening port. The Deployment's `containerPort`, the Service's `targetPort`, the `livenessProbe.tcpSocket.port` and `readinessProbe.tcpSocket.port`, AND the `PORT` env var injected into the rendered Secret all derive from `app.port`. Operators MAY explicitly set `env.PORT` to override the env-side injection, in which case the chart still uses `app.port` for the Kubernetes-side fields (so a deliberate mismatch is possible but requires two explicit overrides, not one).

**Why**: HeartReverie's `writer/lib/config.ts` reads `Deno.env.get("PORT") || "8443"`. If the chart let `service.port` and `containerPort` drift from `env.PORT`, an operator who set `--set env.PORT=8080` to dodge a port conflict would end up with a pod listening on 8080 while the Service routed traffic to 8443 and the TCP probe checked 8443 — three-way silent failure. Tying every port surface to one value eliminates the class of bug.

### Decision 10: Minimal ServiceAccount surface

**Choice** (driven by Major Finding #7): Add `serviceAccount.create` (default `false`), `serviceAccount.name` (default `""`), and `serviceAccount.automount` (default `false`). When `create: true`, the chart renders a ServiceAccount named per `serviceAccount.name` (or the chart fullname if empty) and the pod uses it. When `create: false` and `serviceAccount.name` is non-empty, the pod uses the named pre-existing SA. The pod's `automountServiceAccountToken` is set from `serviceAccount.automount`.

**Why**: The pod does not need Kubernetes API access. The default disables token projection. Operators using IRSA / Workload Identity / similar pod-identity mechanisms for outbound auth (e.g., a sidecar that fetches `LLM_API_KEY` from a cloud KMS) need a real SA with the right annotations — this surface gives them the standard Helm idiom for that without bloating the chart with vendor-specific knobs.

## Risks / Trade-offs

- **Risk**: Operators set `--set env.LLM_API_KEY=sk-...` on the CLI and the value lands in shell history / their CI logs. → **Mitigation**: Chart `README.md` and `docs/helm-deployment.md` lead with `--set-file`, then `secret.existingSecret`, and only show `--set` for placeholder/dev usage. We cannot prevent the misuse, only steer.
- **Risk**: `image.tag: latest` produces non-reproducible installs. → **Mitigation**: Documented prominently in chart README; `examples/values-production.yaml` (if added later) would pin a digest. Out of scope for v0.1.0 of the chart.
- **Risk**: Self-signed-cert + ingress controller misconfiguration is the #1 first-time-user failure mode. → **Mitigation**: `examples/values-traefik.yaml` and `examples/values-nginx.yaml` are the canonical reference and are explicitly tested by `helm template` in the implementation tasks.
- **Risk**: Single-Secret-for-everything means non-secret config is base64-blobbed into a Secret object. Some compliance regimes (FedRAMP, PCI) flag config in Secrets. → **Mitigation**: Document the trade-off in `docs/helm-deployment.md`; operators who need stricter classification use `secret.existingSecret` plus a custom Secret built however they like (ExternalSecrets, etc.).
- **Risk**: Operator forks `replicas: 3` to "make it more reliable" and corrupts story files. → **Mitigation**: Chart README has a prominent "Single-replica only" warning. We do not add a guard rail in templates because helm-side guards are easily bypassed and create false confidence.
- **Trade-off**: No `values.schema.json` means typos like `env.LLM_TEMPRATURE` silently no-op. → Accepted: the reference chart accepts the same trade-off; the simplicity dividend is large; CI runs `helm lint` + a schema-free `helm template` smoke test on every PR.

## Migration Plan

Greenfield — no migration. The chart's first published version is `0.1.0`. Existing operators (if any pre-release self-rolled their own manifests) can adopt the chart by:

1. Importing their existing PVC: set `persistence.existingClaim: <their-pvc-name>`.
2. Importing their existing Secret: set `secret.existingSecret: <their-secret-name>` and remove the chart's `env:` map.
3. `helm install hr ./helm/heart-reverie -n <their-ns>` — Deployment+Service+Ingress are created fresh; PVC and Secret are unchanged.
4. Cut DNS / Ingress over to the new release.
5. Delete their old manifests.

Rollback: `helm uninstall hr` removes Deployment / Service / Ingress / Secret-the-chart-created. The PVC stays (resource-policy keep). Operator can re-`helm install` against the same claim and resume immediately.

## Open Questions

None at proposal time. Chart-version policy (when to bump 0.1.x → 0.2.0 etc.) is deferred to a future change once the chart has actual users.

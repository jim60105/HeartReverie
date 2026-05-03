# helm-chart Specification

## Purpose
TBD - created by archiving change add-helm-chart. Update Purpose after archive.
## Requirements
### Requirement: Chart Metadata and Layout

The chart SHALL live at `helm/heart-reverie/` and SHALL include `Chart.yaml` (apiVersion v2, type application, semver `version`/`appVersion`), a `templates/` directory with the resource files (`deployment.yaml`, `service.yaml`, `ingress.yaml`, `secret.yaml`, `configmap-prompts.yaml`, `serviceaccount.yaml`, `pvc.yaml`, `_helpers.tpl`, `NOTES.txt`), a `values.yaml`, an `examples/` directory, and a chart-local `README.md`. The chart MAY include a `values.schema.json` (not required by this change; schema authoring is out of scope).

#### Scenario: chart files exist

- **WHEN** the contents of `helm/heart-reverie/` are listed
- **THEN** the listing includes `Chart.yaml`, `values.yaml`, `README.md`, `templates/`, and `examples/`

#### Scenario: examples directory carries ingress recipes

- **WHEN** the contents of `helm/heart-reverie/examples/` are listed
- **THEN** the directory contains `values-traefik.yaml` and `values-nginx.yaml`, each a valid YAML file that demonstrates a controller-specific plain-HTTP ingress configuration

### Requirement: Default Image Reference

The chart's default values SHALL set `image.repository` to `ghcr.io/jim60105/heartreverie`, `image.tag` to `latest`, and `image.pullPolicy` to `Always`. The image reference rendered into the Deployment SHALL be `<repository>:<tag>` and SHALL be overridable via `--set image.tag=<value>`.

#### Scenario: default render uses the documented image
- **WHEN** an operator runs `helm template hr helm/heart-reverie` with no overrides beyond the required env values
- **THEN** the rendered Deployment's container `image` field equals `ghcr.io/jim60105/heartreverie:latest`

#### Scenario: image tag override is honoured
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set image.tag=v0.5.0` with the required env values
- **THEN** the rendered Deployment's container `image` field equals `ghcr.io/jim60105/heartreverie:v0.5.0`

### Requirement: Flat Env Map Surfaced via Secret

The chart SHALL expose application configuration as a flat `env:` map under `.Values.env`, where each key is the exact UPPER_SNAKE environment variable name documented in `AGENTS.md`. The chart SHALL render every retained value from `.Values.env` into a single Kubernetes `Secret` named `<release-fullname>-secret` and the Deployment's container SHALL consume it via `envFrom: { secretRef: { name: <release-fullname>-secret } }`. The Secret template SHALL coerce every retained value to a string with `toString | quote` so that boolean (`false`) and numeric (`0`) inputs survive `--set` parsing as the literal strings `"false"` and `"0"`. A value SHALL be skipped (not emitted) only when it is `nil` or its string-coerced form is the empty string `""`. Operators SHALL be able to add new env vars via `--set env.<NAME>=<value>` without editing chart templates.

#### Scenario: required vars land in the Secret
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set env.LLM_API_KEY=sk-test --set env.PASSPHRASE=open-sesame`
- **THEN** the rendered Secret's name is `hr-heart-reverie-secret` (or matches the configured `fullname`-derived name) and its `stringData` contains `LLM_API_KEY: "sk-test"` and `PASSPHRASE: "open-sesame"`

#### Scenario: empty values are dropped
- **WHEN** the rendered Secret is inspected and a values key (e.g. `env.LLM_LOG_FILE`) was left empty in `values.yaml`
- **THEN** that key SHALL NOT appear in the Secret's `stringData`

#### Scenario: boolean false is preserved as a string
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set env.LLM_REASONING_OMIT=false` with the required vars also set
- **THEN** the rendered Secret's `stringData` contains `LLM_REASONING_OMIT: "false"` (NOT omitted, NOT the YAML boolean `false`)

#### Scenario: numeric zero is preserved as a string
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set env.LLM_TOP_P=0` with the required vars also set
- **THEN** the rendered Secret's `stringData` contains `LLM_TOP_P: "0"`

#### Scenario: arbitrary new env var passes through
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set env.SOME_FUTURE_VAR=hello` with the required vars also set
- **THEN** the Secret contains `SOME_FUTURE_VAR: "hello"` and the Deployment's container env hydrates it via `envFrom`

#### Scenario: Deployment uses envFrom not inline env
- **WHEN** the rendered Deployment is inspected
- **THEN** the container spec contains `envFrom: [{ secretRef: { name: <release-fullname>-secret } }]` and the values from `.Values.env` are NOT duplicated into the container's `env:` list

### Requirement: External Secret Override

When `.Values.secret.existingSecret` is set to a non-empty string, the chart SHALL NOT render its own Secret resource and the Deployment's `envFrom.secretRef.name` SHALL reference the operator-provided Secret name verbatim. The chart's `PORT` plain-`env` injection (from `.Values.app.port`) is independent of the Secret and continues to apply, so operators using `existingSecret` do NOT need to add a `PORT` key to their external Secret even when `.Values.app.port` is overridden.

#### Scenario: existingSecret suppresses the chart-managed Secret
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set secret.existingSecret=my-prod-creds`
- **THEN** the rendered output contains no `kind: Secret` whose name ends in `-secret` and matches the chart fullname, AND the Deployment's `envFrom.secretRef.name` equals `my-prod-creds`

### Requirement: Persistent Story Volume

The chart SHALL render a PersistentVolumeClaim named `<fullname>-data` when `.Values.persistence.enabled` is `true` (the default), and the Deployment SHALL mount it at the path defined by `.Values.persistence.mountPath` (default `/app/playground`). The PVC SHALL carry the annotation `helm.sh/resource-policy: keep`. When `.Values.persistence.existingClaim` is non-empty, the chart SHALL NOT render a new PVC and the Deployment SHALL mount the named existing claim instead. The PVC's `accessModes` and `storage` request size SHALL be configurable via values; defaults are `[ReadWriteOnce]` and `10Gi`. The chart SHALL expose `.Values.persistence.storageClass`; when non-empty, the rendered PVC sets `spec.storageClassName` to that value, and when empty (the default), the PVC OMITS `storageClassName` entirely so the cluster's default StorageClass is used.

#### Scenario: default install creates a kept PVC
- **WHEN** an operator runs `helm template hr helm/heart-reverie` with required env values
- **THEN** the output contains exactly one `kind: PersistentVolumeClaim`, its name is `<fullname>-data`, its `metadata.annotations` includes `helm.sh/resource-policy: keep`, and the Deployment mounts it at `/app/playground`

#### Scenario: storageClass override is honoured
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set persistence.storageClass=fast-ssd` with required env values
- **THEN** the rendered PVC's `spec.storageClassName` equals `fast-ssd`

#### Scenario: empty storageClass omits the field
- **WHEN** an operator runs `helm template hr helm/heart-reverie` with required env values and no `persistence.storageClass` override
- **THEN** the rendered PVC has NO `spec.storageClassName` field at all (so the cluster default applies)

#### Scenario: existingClaim suppresses chart-managed PVC
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set persistence.existingClaim=hr-data` with required env values
- **THEN** the output contains no chart-managed PVC, and the Deployment volume references `persistentVolumeClaim.claimName: hr-data`

#### Scenario: persistence disabled drops the volume entirely
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set persistence.enabled=false` with required env values
- **THEN** the output contains no PVC, AND the Deployment has no `playground` volume or volumeMount

### Requirement: Service

The chart SHALL render a Kubernetes Service of type `ClusterIP` (default; configurable via `.Values.service.type`) that exposes the container port. `.Values.service.port` (default `8080`) SHALL control the Service `port`; the Service `targetPort` SHALL ALWAYS equal the value of `.Values.app.port` (the single source of truth for the listening port — see the "Single Source of Truth for Listening Port" requirement below). The Service selector SHALL match the Deployment's pod labels.

#### Scenario: default service exposes 8080
- **WHEN** an operator runs `helm template hr helm/heart-reverie` with required env values
- **THEN** the rendered Service has `type: ClusterIP`, one port with `port: 8080` and `targetPort: 8080`

#### Scenario: service type override
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set service.type=NodePort` with required env values
- **THEN** the Service `type` field equals `NodePort`

### Requirement: Single Source of Truth for Listening Port

The chart SHALL define `.Values.app.port` (default `8080`) as the single authoritative listening-port value. The Deployment's container `ports[].containerPort`, the Service's `targetPort`, the `livenessProbe.tcpSocket.port`, and the `readinessProbe.tcpSocket.port` SHALL all derive from `.Values.app.port`. The chart SHALL render `PORT=<app.port>` as a plain container `env` entry on the Deployment (NOT through the Secret), so it always applies regardless of `secret.existingSecret`. Because container `env` takes precedence over `envFrom`, an operator who explicitly sets `env.PORT` in `.Values.env` (rendered into the chart-managed Secret) does NOT override the chart-rendered `PORT` plain-env; operators wanting a deliberate Kubernetes-side / app-side mismatch must override `app.port` instead. Setting `app.port` is therefore the single supported way to change the listening port.

#### Scenario: app.port flows to every port surface
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set app.port=9000` with required env values
- **THEN** the rendered Deployment's `containerPort` is `9000`, the Service's `targetPort` is `9000`, both probe `tcpSocket.port` values are `9000`, AND the Deployment's container `env` list contains `{ name: PORT, value: "9000" }`

#### Scenario: PORT env is rendered as plain container env, not in Secret
- **WHEN** an operator runs `helm template hr helm/heart-reverie` with required env values
- **THEN** the rendered Secret's `stringData` does NOT contain a `PORT` key, AND the Deployment's container `env` list contains `{ name: PORT, value: "8080" }`

#### Scenario: PORT plain-env survives existingSecret with custom app.port
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set secret.existingSecret=ext --set app.port=9000`
- **THEN** the chart renders no Secret, AND the Deployment's container `env` list still contains `{ name: PORT, value: "9000" }` so the application listens on `9000` without any modifications to the external Secret

### Requirement: Optional Ingress

When `.Values.ingress.enabled` is `true`, the chart SHALL render a `networking.k8s.io/v1` Ingress whose `spec.ingressClassName` comes from `.Values.ingress.className`, whose `metadata.annotations` are copied verbatim from `.Values.ingress.annotations` (no chart-injected annotations), whose `spec.rules` is built from `.Values.ingress.hosts` (each entry has `host` and a list of `paths` with `path` and `pathType`), and whose `spec.tls` is built from `.Values.ingress.tls`. When `.Values.ingress.enabled` is `false` (the default), no Ingress SHALL be rendered. The chart SHALL NOT inject any upstream-HTTPS annotation (e.g., `nginx.ingress.kubernetes.io/backend-protocol: HTTPS` or Traefik `ServersTransport`); the upstream Service speaks plain HTTP, and any controller talking to it does the same by default.

#### Scenario: ingress disabled by default
- **WHEN** an operator runs `helm template hr helm/heart-reverie` with required env values
- **THEN** the output contains no `kind: Ingress`

#### Scenario: ingress with custom annotations and TLS
- **WHEN** an operator runs `helm template hr helm/heart-reverie -f helm/heart-reverie/examples/values-traefik.yaml` with required env values
- **THEN** the rendered Ingress has `spec.ingressClassName: traefik`, the host(s) from the example file appear under `spec.rules`, and `spec.tls` carries the configured `secretName`

#### Scenario: traefik example does not set HTTP_ONLY

- **WHEN** an operator runs `helm template hr -f helm/heart-reverie/examples/values-traefik.yaml helm/heart-reverie` with required env values
- **THEN** the rendered Secret does NOT contain an `HTTP_ONLY` key (the application now always speaks plain HTTP, so the toggle no longer exists)

#### Scenario: nginx example does not inject backend-protocol annotation

- **WHEN** an operator runs `helm template hr helm/heart-reverie -f helm/heart-reverie/examples/values-nginx.yaml` with required env values
- **THEN** the rendered Ingress's `metadata.annotations` does NOT contain `nginx.ingress.kubernetes.io/backend-protocol` (the upstream is plain HTTP; the annotation defaults to HTTP and is unnecessary)

### Requirement: Single-Replica Deployment with Recreate Strategy

The Deployment SHALL default to `replicas: 1` and `strategy.type: Recreate`. Because HeartReverie is single-writer filesystem-backed, running multiple replicas against the same RWO claim corrupts story data. The chart SHALL therefore enforce single-replica at template time: when `.Values.replicaCount > 1` the chart SHALL `fail` rendering with a clear data-corruption warning that points operators at the README's "Single-replica only" section. The chart `README.md` SHALL also document this constraint.

#### Scenario: default Deployment is single-replica with Recreate
- **WHEN** an operator runs `helm template hr helm/heart-reverie` with required env values
- **THEN** the Deployment's `spec.replicas` equals `1` and `spec.strategy.type` equals `Recreate`

#### Scenario: replicaCount > 1 fails template-time
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set replicaCount=2` with required env values
- **THEN** the render SHALL fail with a non-zero exit status and an error message that mentions `replicaCount must be 1` and references the README's "Single-replica only" section

#### Scenario: README warns against multi-replica
- **WHEN** an operator reads `helm/heart-reverie/README.md`
- **THEN** the document contains a section explicitly stating that multi-replica deployment is unsupported

### Requirement: Pod Security Context

The Deployment's pod-level `securityContext` SHALL set `runAsUser: 1000`, `runAsGroup: 0`, `fsGroup: 0`, and `fsGroupChangePolicy: OnRootMismatch`. The pod spec SHALL set `automountServiceAccountToken` to the value of `.Values.serviceAccount.automount` (default `false`). The container-level `securityContext` SHALL set `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, and `runAsNonRoot: true`. All security context fields SHALL be overridable via `.Values.podSecurityContext` and `.Values.securityContext`.

#### Scenario: default security context matches the image's UID 1000
- **WHEN** an operator runs `helm template hr helm/heart-reverie` with required env values
- **THEN** the rendered Deployment has `spec.template.spec.securityContext.runAsUser: 1000`, `runAsGroup: 0`, `fsGroup: 0`, `fsGroupChangePolicy: OnRootMismatch`, AND the container's `securityContext.allowPrivilegeEscalation` is `false` and `capabilities.drop` contains `ALL`

#### Scenario: SA token automount is disabled by default
- **WHEN** an operator runs `helm template hr helm/heart-reverie` with required env values
- **THEN** the Deployment's pod spec sets `automountServiceAccountToken: false`

### Requirement: ServiceAccount Surface

The chart SHALL expose `.Values.serviceAccount.create` (default `false`), `.Values.serviceAccount.name` (default `""`), and `.Values.serviceAccount.automount` (default `false`). When `serviceAccount.create` is `true`, the chart SHALL render a `kind: ServiceAccount` whose name is `serviceAccount.name` if non-empty else the chart fullname, and the Deployment's `spec.template.spec.serviceAccountName` SHALL reference that name. When `serviceAccount.create` is `false` and `serviceAccount.name` is non-empty, the chart SHALL NOT render a ServiceAccount and the Deployment SHALL set `serviceAccountName` to the operator-supplied value. When both are at their defaults, the Deployment SHALL omit `serviceAccountName` so Kubernetes uses the namespace's `default` SA.

#### Scenario: defaults skip SA creation and rely on namespace default
- **WHEN** an operator runs `helm template hr helm/heart-reverie` with required env values
- **THEN** the output contains no `kind: ServiceAccount`, AND the Deployment has no `serviceAccountName` field (or it is the empty string)

#### Scenario: opt-in SA creation
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set serviceAccount.create=true` with required env values
- **THEN** the output contains a `kind: ServiceAccount` named per the chart fullname, AND the Deployment's `serviceAccountName` references that name

### Requirement: Liveness and Readiness Probes

The Deployment's container SHALL define `livenessProbe` and `readinessProbe` blocks. By default (no handler key set under `.Values.livenessProbe` / `.Values.readinessProbe`), the chart SHALL inject `tcpSocket: { port: <containerPort> }` along with `initialDelaySeconds: 10`, `periodSeconds: 10`, `timeoutSeconds: 3`, and `failureThreshold: 3`. When the operator sets ANY handler key (`tcpSocket`, `httpGet`, `exec`, or `grpc`) under either probe, the chart SHALL render that probe map verbatim and SHALL NOT inject the default `tcpSocket` — i.e. operators may switch to `httpGet`/`exec`/`grpc` (or supply a custom `tcpSocket.port`) by overriding the relevant probe map. Timing fields are merged through in both modes.

#### Scenario: default probes are tcpSocket
- **WHEN** an operator runs `helm template hr helm/heart-reverie` with required env values
- **THEN** the Deployment's container `livenessProbe` and `readinessProbe` each contain a `tcpSocket` field whose `port` matches the configured container port (`8080` by default)

#### Scenario: probe override switches to httpGet
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set 'livenessProbe.httpGet.path=/healthz' --set livenessProbe.httpGet.port=8080` with required env values
- **THEN** the Deployment's `livenessProbe` contains `httpGet.path: /healthz` and `httpGet.port: 8080` AND does NOT contain a `tcpSocket` field

### Requirement: Deployment has no /certs surface

The rendered Deployment SHALL NOT contain any `/certs` `volumeMount`, any `certs`-named `volume`, or any reference to TLS certificate files. The chart SHALL NOT expose a top-level `tls` value group, and `helm/heart-reverie/values.yaml` SHALL NOT define `tls.existingSecret`, `tls.certKey`, or `tls.keyKey`.

#### Scenario: default install has no /certs mount

- **WHEN** an operator runs `helm template hr helm/heart-reverie` with required env values
- **THEN** the Deployment's pod spec contains no volume targeting `/certs` and no volume named `certs`

#### Scenario: tls.* values are not part of the chart surface

- **WHEN** an operator runs `helm template hr helm/heart-reverie --set tls.existingSecret=hr-tls`
- **THEN** the chart MAY render the same Deployment as without that flag (the `tls` value group is not consumed by any template), AND the Deployment's pod spec STILL contains no `/certs` volume — the value is silently ignored

### Requirement: Optional Prompt-Overrides ConfigMap

When `.Values.prompts.enabled` is `true`, the chart SHALL render a ConfigMap whose data keys come from `.Values.prompts.files` (a `{ filename: contents }` map). The Deployment SHALL mount the ConfigMap at `.Values.prompts.mountPath` (default `/app/prompt-overrides`) — a path **outside** the playground PVC — so the read-only ConfigMap volume does not collide with the writable PVC and a fresh PVC's missing subdirectories cannot fail the mount. When at least one filename in `.Values.prompts.files` is non-empty AND `.Values.env.PROMPT_FILE` is unset, the chart SHALL inject `PROMPT_FILE=<mountPath>/<first-filename>` into the rendered Secret. When `.Values.prompts.enabled` is `false` (the default), no ConfigMap SHALL be rendered, no prompt-related volume mount SHALL be added, and the chart SHALL NOT inject `PROMPT_FILE`.

The chart README SHALL document that prompts mounted via this mechanism are read-only, so the in-app Prompt Editor's save endpoint will fail at runtime — operators who want an editable system prompt should leave `prompts.enabled: false` and seed the prompt by copying it into the playground PVC out-of-band.

#### Scenario: prompts disabled by default
- **WHEN** an operator runs `helm template hr helm/heart-reverie` with required env values
- **THEN** the output contains no `kind: ConfigMap` for prompts, AND the rendered Secret does NOT contain a `PROMPT_FILE` entry

#### Scenario: prompts.enabled with a custom system.md
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set prompts.enabled=true --set-file prompts.files.system\\.md=./my-system.md` with required env values
- **THEN** the output contains a ConfigMap whose `data["system.md"]` equals the file contents, AND the Deployment mounts the ConfigMap at `/app/prompt-overrides` (NOT under `/app/playground`), AND the rendered Secret's `stringData` contains `PROMPT_FILE: "/app/prompt-overrides/system.md"`

#### Scenario: explicit PROMPT_FILE override is preserved
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set prompts.enabled=true --set-file prompts.files.system\\.md=./my-system.md --set env.PROMPT_FILE=/custom/path/system.md` with required env values
- **THEN** the rendered Secret's `PROMPT_FILE` equals `/custom/path/system.md` (the operator's explicit override wins)

### Requirement: Standard Helm Helpers

The chart SHALL define the standard Helm helper templates in `templates/_helpers.tpl`: `heart-reverie.name`, `heart-reverie.fullname` (supporting `nameOverride` and `fullnameOverride`), `heart-reverie.chart`, `heart-reverie.labels` (including `app.kubernetes.io/name`, `app.kubernetes.io/instance`, `app.kubernetes.io/version`, `app.kubernetes.io/managed-by`, and `helm.sh/chart`), and `heart-reverie.selectorLabels` (only `app.kubernetes.io/name` and `app.kubernetes.io/instance`).

#### Scenario: all rendered resources carry the standard labels
- **WHEN** an operator runs `helm template hr helm/heart-reverie` with required env values
- **THEN** every rendered resource's `metadata.labels` contains `app.kubernetes.io/name: heart-reverie`, `app.kubernetes.io/instance: hr`, `app.kubernetes.io/managed-by: Helm`, `helm.sh/chart` matching `<chart-name>-<chart-version>`, AND `app.kubernetes.io/version` matching the chart's `appVersion`

#### Scenario: fullnameOverride takes precedence
- **WHEN** an operator runs `helm template hr helm/heart-reverie --set fullnameOverride=custom-name` with required env values
- **THEN** the Deployment, Service, and PVC `<fullname>-data` (rendered as `custom-name-data`) and Secret `<fullname>-secret` (rendered as `custom-name-secret`) all derive their names from `custom-name`

### Requirement: Operator Documentation

The repository SHALL ship operator-facing documentation:

1. `helm/heart-reverie/README.md` (English) covering installation, the values surface, the single-replica caveat, the credential-handling recommendation order (`secret.existingSecret` → `--set-file` → `--set`), and the two ingress recipes.
2. `docs/helm-deployment.md` (Traditional Chinese, matching the existing docs/*.md style) covering the same material localised for zh-TW operators.
3. The root `README.md` SHALL gain a Helm-deployment subsection that links to both `helm/heart-reverie/README.md` and `docs/helm-deployment.md`.

#### Scenario: chart README contains the prescribed sections
- **WHEN** an operator opens `helm/heart-reverie/README.md`
- **THEN** the document contains sections titled (or equivalent) "Installation", "Values", "Single-replica only", and "Ingress examples", AND mentions both `secret.existingSecret` and `--set-file` as preferred mechanisms for supplying `LLM_API_KEY` and `PASSPHRASE`

#### Scenario: zh-TW deployment guide exists
- **WHEN** an operator opens `docs/helm-deployment.md`
- **THEN** the file exists and the prose is in Traditional Chinese

#### Scenario: root README links to the chart docs
- **WHEN** an operator opens the repository's root `README.md`
- **THEN** there is a Helm subsection that links to `helm/heart-reverie/README.md` and `docs/helm-deployment.md`


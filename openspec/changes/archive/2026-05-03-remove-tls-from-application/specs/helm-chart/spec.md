## REMOVED Requirements

### Requirement: TLS Cert Directory

**Reason:** The application no longer terminates TLS in-pod. There is no `/certs` mount, no `tls.existingSecret` Secret projection, and no `HTTP_ONLY` toggle. The chart always renders a plain-HTTP Deployment that listens on port `8080`. Operators terminate TLS at their ingress controller of choice using the existing `ingress.tls` Helm value, exactly as they would for any other plain-HTTP backend.

## MODIFIED Requirements

### Requirement: Chart Metadata and Layout

The chart SHALL live at `helm/heart-reverie/` and SHALL include `Chart.yaml` (apiVersion v2, type application, semver `version`/`appVersion`), a `templates/` directory with the resource files (`deployment.yaml`, `service.yaml`, `ingress.yaml`, `secret.yaml`, `configmap-prompts.yaml`, `serviceaccount.yaml`, `pvc.yaml`, `_helpers.tpl`, `NOTES.txt`), a `values.yaml`, an `examples/` directory, and a chart-local `README.md`. The chart MAY include a `values.schema.json` (not required by this change; schema authoring is out of scope).

#### Scenario: chart files exist

- **WHEN** the contents of `helm/heart-reverie/` are listed
- **THEN** the listing includes `Chart.yaml`, `values.yaml`, `README.md`, `templates/`, and `examples/`

#### Scenario: examples directory carries ingress recipes

- **WHEN** the contents of `helm/heart-reverie/examples/` are listed
- **THEN** the directory contains `values-traefik.yaml` and `values-nginx.yaml`, each a valid YAML file that demonstrates a controller-specific plain-HTTP ingress configuration

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

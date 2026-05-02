# HeartReverie Helm Chart

A Helm chart that packages [HeartReverie 浮心夜夢](https://github.com/jim60105/HeartReverie) — an AI-driven interactive fiction engine — for Kubernetes.

## Prerequisites

- Helm ≥ 3.10
- Kubernetes ≥ 1.27 (for `networking.k8s.io/v1` Ingress)
- An OpenAI-compatible LLM provider with an API key (e.g. OpenRouter, OpenAI, DeepSeek)

## Quick install

```bash
helm install hr ./helm/heart-reverie \
  --namespace heart-reverie --create-namespace \
  --set env.LLM_API_KEY=sk-... \
  --set env.PASSPHRASE=open-sesame
```

The default install creates a Deployment + Service + Secret + 10 GiB PVC and serves HTTPS on port 8443 with a self-signed cert auto-generated at boot.

To enable an Ingress, copy one of the example values files and edit the host:

```bash
helm install hr ./helm/heart-reverie \
  --namespace heart-reverie --create-namespace \
  -f ./helm/heart-reverie/examples/values-nginx.yaml
```

## Single-replica only

HeartReverie writes story chapters, lore codex passages, and usage logs directly to the local filesystem with no inter-pod coordination. **Running ≥ 2 replicas against the same RWO claim WILL corrupt data.** The chart defaults to `replicaCount: 1` and `strategy.type: Recreate`. Don't override these.

## Credential handling

Three ways to supply `LLM_API_KEY` and `PASSPHRASE`, in order of preference:

1. **`secret.existingSecret`** — operator manages the Secret out-of-band (ExternalSecrets, sealed-secrets, vault-injectors, manual `kubectl create secret`).
   ```bash
   kubectl create secret generic hr-creds \
     --from-literal=LLM_API_KEY=sk-... \
     --from-literal=PASSPHRASE=open-sesame
   helm install hr ./helm/heart-reverie --set secret.existingSecret=hr-creds
   ```
   When using `existingSecret`, `PORT` is still rendered as a plain container `env` on the Deployment from `.Values.app.port`, so operators do **not** need to add `PORT` to their external Secret even when `app.port` is overridden.

2. **`--set-file`** — values come from files, never appearing in shell history.
   ```bash
   helm install hr ./helm/heart-reverie \
     --set-file env.LLM_API_KEY=./secrets/llm.txt \
     --set-file env.PASSPHRASE=./secrets/passphrase.txt
   ```

3. **`--set`** — convenient for placeholder/dev usage but values land in shell history and CI logs. Avoid in production.

## Values

| Key | Default | Description |
|-----|---------|-------------|
| `image.repository` | `ghcr.io/jim60105/heartreverie` | OCI image repository |
| `image.tag` | `latest` | Image tag (override to a digest or release tag for reproducibility) |
| `image.pullPolicy` | `Always` | Image pull policy |
| `replicaCount` | `1` | Pod replica count — **must remain 1** |
| `strategy.type` | `Recreate` | Required because the pod holds a RWO PVC |
| `app.port` | `8443` | **Single source of truth** for the listening port — drives `containerPort`, `Service.targetPort`, probe ports, and auto-injected `PORT` env |
| `service.type` | `ClusterIP` | Service type |
| `service.port` | `8443` | Service port |
| `ingress.enabled` | `false` | Enable Ingress (see examples for Traefik/nginx) |
| `ingress.className` | `""` | IngressClass name |
| `ingress.annotations` | `{}` | Verbatim copy into `metadata.annotations` |
| `ingress.hosts` | `[]` | Host/path rules |
| `ingress.tls` | `[]` | TLS spec |
| `persistence.enabled` | `true` | Mount a PVC at `/app/playground` |
| `persistence.existingClaim` | `""` | Reuse an existing claim (chart skips PVC render) |
| `persistence.storageClass` | `""` | StorageClass; empty → cluster default |
| `persistence.accessModes` | `[ReadWriteOnce]` | PVC access modes |
| `persistence.size` | `10Gi` | PVC storage request |
| `persistence.mountPath` | `/app/playground` | Mount path inside the pod |
| `prompts.enabled` | `false` | Render prompt-override ConfigMap (read-only) |
| `prompts.mountPath` | `/app/prompt-overrides` | Mount path (intentionally outside playground PVC) |
| `prompts.files` | `{}` | `{ filename: contents }` map |
| `tls.existingSecret` | `""` | When set, project keys from this Secret as `/certs/cert.pem`/`/certs/key.pem` |
| `tls.certKey` | `tls.crt` | Source key for the certificate (matches `kubernetes.io/tls`) |
| `tls.keyKey` | `tls.key` | Source key for the private key |
| `secret.existingSecret` | `""` | Use an externally-managed Secret for `envFrom` |
| `serviceAccount.create` | `false` | Render a ServiceAccount |
| `serviceAccount.name` | `""` | SA name (chart fullname when empty + create=true) |
| `serviceAccount.automount` | `false` | Automount the SA token |
| `podSecurityContext` | UID 1000, GID 0, fsGroup 0, OnRootMismatch | Pod-level security context |
| `securityContext` | drop ALL caps, runAsNonRoot, no privEsc | Container-level security context |
| `livenessProbe` / `readinessProbe` | `tcpSocket` on `app.port` | Probe definitions |
| `resources` | `{}` | Container resource requests/limits |
| `nodeSelector` / `tolerations` / `affinity` | `{}` / `[]` / `{}` | Standard pod scheduling |
| `podAnnotations` / `podLabels` | `{}` / `{}` | Extra pod metadata |
| `extraEnv` / `extraVolumes` / `extraVolumeMounts` | `[]` / `[]` / `[]` | Append-only passthrough |
| `env` | `{ LLM_API_KEY: "", PASSPHRASE: "" }` | Flat map rendered into the chart-managed Secret. Add new keys with `--set env.NAME=value`. Booleans (`false`) and numbers (`0`) are preserved as strings; empty values are dropped. |

The full annotated `env:` map (every key documented in `AGENTS.md`) lives at the top of `values.yaml` — `helm show values ./helm/heart-reverie` prints it.

## TLS

TLS is a recommended hardening default for HeartReverie deployments — it encrypts the passphrase header and chapter content in transit. The chart defaults to end-to-end HTTPS, but plain HTTP behind a TLS-terminating reverse proxy (set `env.HTTP_ONLY=true`) is also fully supported. You have three options:

### 1. Default — self-signed in-pod cert

`entrypoint.sh` generates a self-signed cert into an `emptyDir`-mounted `/certs` at boot. Works for laptop/kind/staging clusters and for ingress controllers that can be told to skip upstream TLS verification (see the [nginx example](examples/values-nginx.yaml)).

### 2. Operator-supplied cert (e.g. cert-manager)

Set `tls.existingSecret` to a `kubernetes.io/tls` Secret. The chart projects the standard `tls.crt`/`tls.key` keys to `/certs/cert.pem`/`/certs/key.pem`, which is what `entrypoint.sh` expects. With cert-manager:

```yaml
# Apply a Certificate that creates a Secret named hr-tls:
# kubectl apply -f your-certificate.yaml

tls:
  existingSecret: hr-tls
  # certKey: tls.crt   # default
  # keyKey: tls.key    # default
```

### 3. Terminate at the ingress controller, run pod plain HTTP

```yaml
env:
  HTTP_ONLY: "true"
```

Skips the `/certs` mount entirely. The chart's `HTTP_ONLY` check is **case-sensitive lowercase** — only the literal string `"true"` matches, identical to the runtime contract in `entrypoint.sh` and `writer/server.ts`.

## Ingress recipes

### Traefik (HTTP_ONLY mode)

The default Traefik recipe terminates TLS at the controller and runs the pod plain-HTTP, avoiding the need for a `ServersTransport` CRD just to skip self-signed-cert verification.

```bash
helm install hr ./helm/heart-reverie \
  -f ./helm/heart-reverie/examples/values-traefik.yaml \
  --set env.LLM_API_KEY=sk-... \
  --set env.PASSPHRASE=open-sesame
```

The example file's header comment includes the alternative `ServersTransport`-based approach for operators who prefer in-pod TLS.

### ingress-nginx (upstream HTTPS with self-signed cert)

ingress-nginx supports skipping upstream TLS verification via annotation, so it can talk HTTPS to a self-signed pod cert without any CRD wiring.

```bash
helm install hr ./helm/heart-reverie \
  -f ./helm/heart-reverie/examples/values-nginx.yaml \
  --set env.LLM_API_KEY=sk-... \
  --set env.PASSPHRASE=open-sesame
```

## Persistence

The PVC carries `helm.sh/resource-policy: keep`, so `helm uninstall` does **not** destroy story data. To fully remove a release including the data:

```bash
helm uninstall hr -n heart-reverie
kubectl delete pvc -n heart-reverie -l app.kubernetes.io/instance=hr
kubectl delete namespace heart-reverie     # optional
```

To migrate a release to a new namespace or release name without data loss, set `persistence.existingClaim: <old-pvc-name>` on the new install.

## Prompt overrides (advanced, read-only)

Setting `prompts.enabled: true` materialises a ConfigMap from `prompts.files` and mounts it at `/app/prompt-overrides`. The chart auto-injects `PROMPT_FILE=/app/prompt-overrides/<first-filename>` into the Secret.

**Caveat**: ConfigMap mounts are read-only, so the in-app Prompt Editor's save button will fail at runtime when this is enabled. If you want an editable prompt, leave `prompts.enabled: false` and seed the prompt by `kubectl cp`-ing a `system.md` file into the playground PVC after first install.

```bash
helm install hr ./helm/heart-reverie \
  --set prompts.enabled=true \
  --set-file 'prompts.files.system\.md=./my-system.md' \
  --set env.LLM_API_KEY=sk-... \
  --set env.PASSPHRASE=open-sesame
```

## Uninstall

```bash
helm uninstall hr -n heart-reverie
```

The chart-managed Deployment, Service, Secret, and (optional) Ingress + ServiceAccount + ConfigMap are removed. The PVC is **kept** by design — see Persistence above for full removal.

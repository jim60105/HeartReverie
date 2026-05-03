## 1. Application code

- [x] 1.1 Edit `writer/lib/config.ts`: change `PORT` default from `"8443"` to `"8080"`; remove `CERT_FILE` and `KEY_FILE` env reads and exports; remove related types from the resolved-config object.
- [x] 1.2 Edit `writer/server.ts`: delete the `certFile`/`keyFile`/`httpOnly` reads (lines ~32–39); delete the conditional cert/key validation and refusal-to-start branch (lines ~64–82); delete the `cert`/`key` keys from the `Deno.serve()` options object; switch the listening-protocol log line to `http://`.
- [x] 1.3 Audit runtime file-creation call sites: `grep -nE 'writeTextFile|Deno\.open|Deno\.mkdir|Deno\.writeFile' writer/lib/*.ts writer/routes/*.ts`. Confirm every site that creates a file or directory passes an explicit `mode:` option (`0o664` for files, `0o775` for dirs). Add explicit modes to any site that lacks one. (Existing `container-file-permissions` discipline already covers chat-shared, chapters, lore, prompt — verify no new sites have crept in.)
- [x] 1.4 Update `writer/types.ts` to drop `certFile?: string` / `keyFile?: string` / `httpOnly?: boolean` fields if any remain on the resolved-config / `AppDeps` interfaces.

## 2. Containerfile

- [x] 2.1 Edit `Containerfile` final stage: drop the `apt-get install … openssl` line; drop the `install -d /certs` (or equivalent) directory-creation step.
- [x] 2.2 Edit `Containerfile` final stage: drop the `COPY entrypoint.sh /app/entrypoint.sh` line; drop the related `--chmod=755` if any.
- [x] 2.3 Edit `Containerfile` final stage: change `ENTRYPOINT ["/app/entrypoint.sh"]` + `CMD ["writer/server.ts"]` to `ENTRYPOINT ["dumb-init", "--"]` + `CMD ["sh", "-c", "umask 0002 && exec deno run --allow-net --allow-read --allow-write --allow-env --allow-run writer/server.ts"]`. The `umask 0002` inside the shim is load-bearing — it preserves OpenShift arbitrary-UID + shared-GID-0 group-write semantics on directories the application creates at runtime via `Deno.mkdir({ mode: 0o775 })`, which Deno honours the inherited process umask on (verified empirically). The `exec` ensures `deno` replaces the shell so signal forwarding from `dumb-init` reaches Deno directly.
- [x] 2.4 Edit `Containerfile` final stage: change `EXPOSE 8443` to `EXPOSE 8080`.
- [x] 2.5 Update `.containerignore` if it references `entrypoint.sh` or `.certs/` (already there) — no removal needed for `.certs/`, but confirm the file is still excluded in case a developer has a stray local cert dir.

## 3. Delete entrypoint.sh

- [x] 3.1 `git rm entrypoint.sh` at the repo root.
- [x] 3.2 Confirm no other file in the repo references `entrypoint.sh`: `grep -rE 'entrypoint\.sh' . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=reader-dist --exclude-dir=playground --exclude-dir=openspec/changes/archive` and clean any stragglers (typically docs or AGENTS.md).

## 4. scripts/serve.sh

- [x] 4.1 Replace `scripts/serve.sh` body with the simplified version from `design.md` Decision 6: drop `CERT_DIR`, drop the `HTTP_ONLY` scheme switch, drop the `entrypoint.sh` exec, default `PORT` to `8080`, insert a `umask 0002` line near the top (after `set -euo pipefail`, before any `export`), exec `deno run` directly with the same permission flags as the Containerfile `CMD`, log `http://localhost:${PORT}` only.
- [x] 4.2 Confirm `scripts/serve.sh` git filemode remains `100755` (executable bit preserved across the rewrite).

## 5. scripts/podman-build-run.sh

- [x] 5.1 Drop `-e HTTP_ONLY="true"` if it has reappeared in this branch (grep, then delete the line).
- [x] 5.2 Change the host-side default port from `PORT="${PORT:-8443}"` to `PORT="${PORT:-8080}"`.
- [x] 5.3 Change the published-port mapping from `-p ${PORT}:8443` to `-p ${PORT}:8080`.
- [x] 5.4 Change the final status message from `https://localhost:${PORT}` to `http://localhost:${PORT}`.
- [x] 5.5 Confirm the script still mounts `playground/` and passes `LLM_API_KEY` / `PASSPHRASE` correctly; no other changes.

## 6. Helm chart

- [x] 6.1 Edit `helm/heart-reverie/values.yaml`: change `app.port` default from `8443` to `8080`; change `service.port` default from `8443` to `8080`; delete the entire top-level `tls:` block (with `existingSecret`, `certKey`, `keyKey`); delete every `# HTTP_ONLY` / `# CERT_FILE` / `# KEY_FILE` comment line in the documented-env block.
- [x] 6.2 If `helm/heart-reverie/values.schema.json` exists in the working tree at implementation time, delete its `tls` property and its sub-properties; update any `port` minimum/maximum/default values to `8080` if the schema pins a default; remove `HTTP_ONLY` / `CERT_FILE` / `KEY_FILE` from any documented `env` enum/keys list. (At proposal time the file does not exist; this task is a guard against it being added by an unrelated change before this one lands.)
- [x] 6.3 Edit `helm/heart-reverie/templates/deployment.yaml`: delete the `$httpOnlyValue` / `$httpOnly` `{{- $httpOnly := … }}` block at the top of the file; delete the `if not $httpOnly` block around the `/certs` `volumeMount`; delete the `if not $httpOnly` block around the `certs` `volume`; verify the rendered Deployment has no `/certs` mount and no `certs` volume in any scenario.
- [x] 6.4 Edit `helm/heart-reverie/examples/values-traefik.yaml`: delete the `HTTP_ONLY: "true"` line and its preceding comment block; the Traefik recipe still works because the chart now always speaks plain HTTP upstream.
- [x] 6.5 Edit `helm/heart-reverie/examples/values-nginx.yaml`: delete the `nginx.ingress.kubernetes.io/backend-protocol: HTTPS` annotation; the upstream is now plain HTTP, so no `backend-protocol` annotation is needed (its absence defaults to `HTTP`).
- [x] 6.6 Edit `helm/heart-reverie/README.md`: remove the `tls.*` rows from the parameters table; remove every mention of `HTTP_ONLY`, `CERT_FILE`, `KEY_FILE`, `/certs`, "self-signed", "TLS termination", and "upstream HTTPS" from the prose; update every `8443` reference to `8080`.
- [x] 6.7 Run `helm lint helm/heart-reverie` and confirm it passes with no warnings related to TLS.
- [x] 6.8 Run `helm template hr helm/heart-reverie --set env.LLM_API_KEY=test --set env.PASSPHRASE=test` and confirm: (a) Deployment `containerPort: 8080`, (b) Service `port: 8080` and `targetPort: 8080`, (c) probe `tcpSocket.port: 8080`, (d) no `/certs` volumeMount, (e) no `certs` volume, (f) no `HTTP_ONLY` / `CERT_FILE` / `KEY_FILE` keys in the rendered Secret.
- [x] 6.9 Run `helm template hr helm/heart-reverie -f helm/heart-reverie/examples/values-traefik.yaml --set env.LLM_API_KEY=test --set env.PASSPHRASE=test` and confirm the rendered Secret does NOT contain `HTTP_ONLY`.
- [x] 6.10 Run `helm template hr helm/heart-reverie -f helm/heart-reverie/examples/values-nginx.yaml --set env.LLM_API_KEY=test --set env.PASSPHRASE=test` and confirm the rendered Ingress does NOT contain `nginx.ingress.kubernetes.io/backend-protocol`.

## 7. HeartReverie_Plugins (sibling repo) verification

- [x] 7.1 Inspect `$HOME/repos/HeartReverie_Plugins/Containerfile`. Confirm it does NOT override `ENTRYPOINT`, `CMD`, `EXPOSE`, or define its own TLS handling. Document confirmation in the implementation commit message; no source changes expected.
- [x] 7.2 Build the plugins image locally against the new base image and confirm the inherited `dumb-init -- deno run …` entrypoint still works: `cd $HOME/repos/HeartReverie_Plugins && podman build -t heartreverie-plugins:test .` and `podman run --rm heartreverie-plugins:test deno --version` (or equivalent quick sanity check). No edits expected.

## 8. Documentation sweep

- [x] 8.1 Edit `README.md`: remove every mention of HTTPS, TLS, self-signed certs, `HTTP_ONLY`, `CERT_FILE`, `KEY_FILE`; replace every `https://localhost:8443` with `http://localhost:8080`; replace every `8443` standalone reference with `8080`; remove any "browser warning" notes about self-signed certs.
- [x] 8.2 Edit `AGENTS.md`: same sweep — drop TLS Configuration row, drop `HTTP_ONLY`/`CERT_FILE`/`KEY_FILE` env-var rows from the table, change `https://localhost:8443` to `http://localhost:8080`, drop the auto-cert-generation paragraph.
- [x] 8.3 Edit `docs/helm-deployment.md`: drop the entire TLS / `tls.existingSecret` / `HTTP_ONLY` section; rewrite the Traefik / nginx example walkthroughs to assume plain HTTP upstream; update every port reference to `8080`.
- [x] 8.4 Edit `.env.example`: delete the `HTTP_ONLY` / `CERT_FILE` / `KEY_FILE` block (entries + comment); keep `PORT` but document its default as `8080`.
- [x] 8.5 Add a `## [Unreleased]` / `### Removed` entry to `CHANGELOG.md` calling out: TLS support removed, `HTTP_ONLY`/`CERT_FILE`/`KEY_FILE` removed, default port changed `8443` → `8080`, `entrypoint.sh` deleted, `tls.*` Helm values removed, `backend-protocol: HTTPS` annotation removed from the nginx example. Include the upgrade guidance: "If your reverse proxy was configured to talk HTTPS to the pod, drop the upstream-HTTPS annotation and point it at plain HTTP on port 8080."
- [x] 8.6 Run `grep -rE 'HTTP_ONLY|CERT_FILE|KEY_FILE|httpOnly|certFile|keyFile|/certs|cert\.pem|key\.pem|8443|self-signed|HTTPS' . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=reader-dist --exclude-dir=playground --exclude-dir=openspec/changes/archive --exclude-dir=coverage --exclude=coverage.lcov` and confirm only intentional matches remain (e.g., upstream LLM URL `https://openrouter.ai`, OpenRouter app-attribution `HTTP-Referer`).

## 9. Tests

- [x] 9.1 Run `grep -rE 'HTTP_ONLY|CERT_FILE|KEY_FILE|certFile|keyFile|httpOnly|8443' tests/` and remove every test assertion that expected those env vars / port / TLS behaviour.
- [x] 9.2 Update any `tests/writer/lib/config_test.ts` (or equivalent) cases that asserted `CERT_FILE` / `KEY_FILE` are loaded into the resolved config; remove those expectations.
- [x] 9.3 Update the `GET /api/llm-defaults` test that asserts the secret-key blacklist (currently includes `HTTP_ONLY`, `CERT_FILE`, `KEY_FILE` per `writer-backend` spec line 806) — remove those three entries from the blacklist literal so the test stays in sync with the updated spec.
- [x] 9.4 Update any Helm-render snapshot tests under `tests/` (if they exist) to reflect the dropped `tls` block and the `8443` → `8080` port change.

## 10. Validation

- [x] 10.1 `deno task test` — full backend + frontend test suite passes.
- [x] 10.2 `deno task build:reader` — frontend build passes.
- [x] 10.3 `helm lint helm/heart-reverie` — no errors or warnings.
- [x] 10.4 `helm template hr helm/heart-reverie --set env.LLM_API_KEY=test --set env.PASSPHRASE=test` — render is clean and matches the new spec scenarios listed in `helm-chart` delta.
- [x] 10.5 `podman build -t heartreverie:tls-removed-test .` — image builds without `openssl`-install or `entrypoint.sh` errors.
- [x] 10.6 `scripts/podman-build-run.sh` — runs end to end; the container starts and listens on `http://localhost:8080`; `curl http://localhost:8080/api/config -H "X-Passphrase: <passphrase>"` returns `200 OK`.
- [x] 10.7 `cd $HOME/repos/HeartReverie_Plugins && podman build -t heartreverie-plugins:tls-removed-test .` — sibling repo builds with the new base image's entrypoint inheritance.
- [x] 10.8 `openspec validate remove-tls-from-application --strict` — passes.

## 11. Single rubber-duck critique

- [x] 11.1 After tasks 1–10 are documented in this file (no implementation yet — proposal still in draft state until apply), invoke a single rubber-duck agent (`agent_type=rubber-duck`, `mode=sync`, `model=gpt-5.5`) on the entire proposal artifact set (`proposal.md` + `design.md` + `tasks.md` + the 7 delta specs).
- [x] 11.2 Triage findings into Critical / High / Medium / Low. Apply Critical and High; apply Medium that prevents bugs; set aside Low/style nits with brief justification.

## 12. Archive workflow (post-implementation)

- [ ] 12.1 After all tasks 1–10 are done and `openspec validate remove-tls-from-application --strict` passes, run the archive workflow per the `openspec-archive-change` skill: sync delta specs to main, `git mv` change dir under `openspec/changes/archive/<date>-remove-tls-from-application/`, single commit with `Co-authored-by: Copilot <…>` trailer.

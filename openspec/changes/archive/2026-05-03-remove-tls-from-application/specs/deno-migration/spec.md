## REMOVED Requirements

### Requirement: Deno TLS server

**Reason:** The application no longer ships in-process TLS support. `Deno.serve()` is invoked with `port` and `hostname` only. TLS termination is the operator's responsibility (reverse proxy / ingress / dev tunnel). This removes the historical migration intent's TLS clause without changing the rest of the Deno-migration contract.

## MODIFIED Requirements

### Requirement: Deno runtime

The writer backend SHALL run on Deno 2.x with explicit permission flags (`--allow-net`, `--allow-read`, `--allow-write`, `--allow-env`, `--allow-run`).

#### Scenario: Server startup on Deno

- **WHEN** the developer runs `deno run` with appropriate permissions
- **THEN** the server starts and accepts plain HTTP connections

### Requirement: serve.sh update

The `scripts/serve.sh` script SHALL invoke `deno` instead of `node`, with appropriate permission flags. The script SHALL exec `deno run` directly (no `entrypoint.sh` delegation) and SHALL NOT contain any TLS / cert-generation logic.

#### Scenario: Script invocation

- **WHEN** the developer runs `./scripts/serve.sh`
- **THEN** the script checks for `deno` (not `node`), and execs `deno run` with `--allow-net --allow-read --allow-write --allow-env --allow-run`

#### Scenario: No cert handling in serve.sh

- **WHEN** `scripts/serve.sh` is examined
- **THEN** it SHALL NOT invoke `openssl`, SHALL NOT mention `CERT_FILE` / `KEY_FILE` / `HTTP_ONLY`, and SHALL NOT exec any `entrypoint.sh`

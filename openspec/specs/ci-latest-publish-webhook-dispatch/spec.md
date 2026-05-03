# Capability: ci-latest-publish-webhook-dispatch

## Purpose

Dispatch a Forgejo workflow webhook after the `docker-publish-latest.yaml` workflow successfully publishes the `latest` Docker image. This ensures downstream Forgejo pipelines are triggered only on confirmed successful publishes, with full traceability metadata.

## Requirements

### Requirement: Latest publish workflow SHALL dispatch Forgejo only after successful publish completion

`.github/workflows/docker-publish-latest.yaml` SHALL include a dedicated post-publish dispatch job that depends on the publish completion gate (`merge`) via `needs`.

#### Scenario: Merge succeeds and dispatch runs

- **WHEN** the `merge` job completes successfully
- **THEN** the post-publish dispatch job runs
- **AND** it sends a dispatch request to the configured Forgejo workflow endpoint

#### Scenario: Merge fails and dispatch does not run

- **WHEN** the `merge` job fails or is skipped
- **THEN** the post-publish dispatch job is skipped

### Requirement: Dispatch request SHALL include required Forgejo API fields and latest-tag metadata

The dispatch request body SHALL include:

- `ref` (required by Forgejo dispatch API), defaulting to `refs/heads/master` unless explicitly overridden by configuration
- `inputs.trigger_tag` with value `latest`
- source metadata indicating the request originated from `docker-publish-latest.yaml`
- trace metadata containing at least workflow run ID and source commit SHA

#### Scenario: Request body uses required Forgejo dispatch contract

- **WHEN** the dispatch request is emitted
- **THEN** the JSON body includes a non-empty `ref`
- **AND** `inputs.trigger_tag` equals `latest`
- **AND** source/trace metadata fields are present

### Requirement: Dispatch endpoint and authentication SHALL be externally configured

The workflow SHALL read Forgejo URL/path and authentication token from repository secrets or variables. Sensitive credential values MUST NOT be hardcoded in workflow YAML.

#### Scenario: Token is provided through secret

- **WHEN** the workflow executes the dispatch step
- **THEN** authentication uses a secret-backed token
- **AND** no plaintext token appears in repository-tracked workflow content

### Requirement: Downstream Forgejo workflow contract SHALL be verified

Before rollout is complete, maintainers SHALL verify the target Forgejo workflow is dispatchable (`workflow_dispatch`) and accepts the input keys emitted by this GitHub workflow (`trigger_tag`, source metadata, trace metadata).

#### Scenario: Downstream workflow contract is compatible

- **WHEN** maintainers validate the target Forgejo workflow configuration
- **THEN** it exposes a dispatchable workflow filename
- **AND** it accepts `trigger_tag=latest` plus the documented source/trace input keys

### Requirement: Dispatch failures SHALL fail the webhook-dispatch job explicitly

If Forgejo returns a non-success response (network error, auth error, 4xx/5xx), the dispatch job SHALL fail with actionable error output.

#### Scenario: Forgejo returns non-success status

- **WHEN** dispatch receives a non-2xx HTTP status
- **THEN** the job exits with failure
- **AND** logs include the HTTP status and endpoint context needed for debugging

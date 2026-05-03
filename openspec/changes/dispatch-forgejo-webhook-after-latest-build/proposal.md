## Why

`docker-publish-latest.yaml` currently finishes after publishing the `latest` multi-arch image, but downstream Forgejo-based plugin builds are not notified automatically. This leaves cross-repo container chains partially manual and can cause plugin images to lag behind the newly published base image.

## What Changes

- Extend `.github/workflows/docker-publish-latest.yaml` with a post-publish webhook-dispatch job that runs only after the `merge` completion gate succeeds (including attestations in that job).
- Send an authenticated dispatch request from GitHub Actions to the Forgejo workflow dispatch API endpoint.
- Wire dispatch payload to the correct trigger target for this pipeline: `ref=refs/heads/master` and input metadata identifying `latest` as the trigger tag.
- Include downstream contract validation: target Forgejo workflow must expose `workflow_dispatch` and accept the expected input keys.
- Add/define required repository secrets and maintainer documentation for the dispatch endpoint and token configuration.

## Capabilities

### New Capabilities

- `ci-latest-publish-webhook-dispatch`: Automatically dispatch a Forgejo workflow after successful completion of GitHub `docker-publish-latest.yaml` latest-image publication.

### Modified Capabilities

(none)

## Impact

- Modified GitHub workflow: `.github/workflows/docker-publish-latest.yaml`
- New CI secret usage for Forgejo API authentication and endpoint configuration
- Cross-repository dependency: Forgejo workflow must expose a dispatchable `workflow_dispatch` entrypoint that accepts `trigger_tag=latest` plus source metadata

## References

- GitHub Actions job dependency semantics (`jobs.<job_id>.needs`): https://docs.github.com/en/actions/using-jobs/using-jobs-in-a-workflow#defining-prerequisite-jobs
- GitHub manual dispatch behavior (`workflow_dispatch` and inputs/ref semantics): https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
- Forgejo Actions `on.workflow_dispatch` (UI/API dispatch support): https://forgejo.org/docs/latest/user/actions/reference/#onworkflow_dispatch
- Forgejo dispatch API contract (`DispatchWorkflow`, required `ref`): https://codeberg.org/swagger.v1.json

## 1. Add post-publish Forgejo dispatch job

- [x] 1.1 Update `.github/workflows/docker-publish-latest.yaml` to add a dispatch job that depends on `merge` via `needs`
- [x] 1.2 Implement dispatch request to Forgejo API endpoint `/repos/{owner}/{repo}/actions/workflows/{workflowfilename}/dispatches` with `ref=refs/heads/master` (or configured equivalent) and `inputs.trigger_tag=latest`
- [x] 1.3 Ensure dispatch job fails on non-2xx responses and prints actionable error context
- [x] 1.4 Include source/trace payload fields (`trigger_source`, `trigger_run_id`, `trigger_sha`) in dispatch inputs

## 2. Configure secrets and document integration contract

- [x] 2.1 Define and wire required secrets/variables for Forgejo base URL, repository/workflow target, dispatch ref, and API token
- [x] 2.2 Update repository documentation to describe the webhook-dispatch flow from GitHub latest publish to Forgejo workflow dispatch
- [x] 2.3 Document expected dispatch payload fields (`ref`, `inputs.trigger_tag`, source metadata) and required token permissions
- [x] 2.4 Validate downstream Forgejo workflow contract (`workflow_dispatch` availability and accepted input keys)

## 3. Validate end-to-end trigger behavior

- [x] 3.1 Run `docker-publish-latest.yaml` and verify dispatch runs only after `merge` succeeds
- [x] 3.2 Verify Forgejo receives dispatch with `trigger_tag=latest` and starts the target workflow
- [x] 3.3 Verify dispatch job fails clearly when endpoint/auth is intentionally misconfigured

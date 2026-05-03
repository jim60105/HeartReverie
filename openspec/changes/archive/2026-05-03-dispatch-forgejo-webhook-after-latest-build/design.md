## Context

`docker-publish-latest.yaml` builds and pushes per-architecture images, then merges digests into the final `latest` manifest across registries. The workflow currently ends after attestations, with no cross-repository signal to downstream Forgejo workflows that rely on the freshly published `latest` image.

The target integration point is "after container build/publish is complete" in this workflow. In current topology, `merge` is the completion gate for published latest artifacts (including attestations currently inside that job), so webhook dispatch must run after `merge` succeeds.

Forgejo's dispatch API requires a `ref` and supports optional `inputs`, which aligns with passing source metadata and trigger tag (`latest`) from GitHub.

## Goals / Non-Goals

**Goals:**

- Trigger a Forgejo workflow automatically after successful latest-image publish.
- Ensure ordering is deterministic (dispatch only after publish/merge success).
- Pass explicit trigger metadata so downstream workflow can select the correct tag path (`latest`).
- Keep credentials and endpoint values in GitHub secrets/variables, not hardcoded.

**Non-Goals:**

- Reworking existing Docker build/publish architecture in this workflow.
- Implementing multi-event fanout (release/tag pipelines are out of scope for this change).
- Adding a generic webhook relay service outside GitHub Actions.

## Decisions

### 1. Add a dedicated post-publish dispatch job in `docker-publish-latest.yaml`

Create a new job that uses `needs: merge` so dispatch only runs after manifest publish completes successfully.

**Why:** GitHub `needs` provides explicit dependency ordering and skip-on-failure behavior, which matches the required "after container build" trigger timing.

**Alternative considered:** separate workflow triggered by `workflow_run`.  
**Rejected:** adds another workflow and cross-workflow coupling without clear benefit for this single downstream dispatch.

### 2. Use Forgejo dispatch API with explicit `ref` and `latest` metadata

Dispatch request body will include:

- `ref: refs/heads/master` (Forgejo API-required field; configurable via workflow variable/secret-backed config)
- `inputs.trigger_tag: latest`
- `inputs.trigger_source: github-docker-publish-latest`
- trace metadata (`inputs.trigger_run_id`, `inputs.trigger_sha`)

**Why:** keeps the downstream trigger unambiguous and aligned with this workflow's output tag.

**Alternative considered:** infer tag downstream from branch only.  
**Rejected:** brittle when downstream workflow supports multiple trigger modes.

### 3. Fail fast on dispatch errors

If API dispatch returns non-success, the job fails and marks the workflow run as failed.

**Why:** webhook/dispatch is part of release automation contract; silent success would hide integration regressions.

**Alternative considered:** best-effort/non-blocking dispatch.  
**Rejected:** would make downstream image drift easy to miss.

### 4. Keep endpoint/auth configurable via secrets/variables

Use secrets/variables for Forgejo base URL, repository path, workflow filename, dispatch ref, and token.

**Why:** avoids hardcoded sensitive values and supports environment-specific routing.

## Risks / Trade-offs

- **[Risk]** Forgejo API downtime causes otherwise successful image publish runs to fail late -> **Mitigation:** clear failure logs and rerunnable workflow_dispatch/manual rerun path.
- **[Risk]** Incorrect `workflowfilename` or repo path causes 404 dispatch failures -> **Mitigation:** document exact expected endpoint format and required config keys.
- **[Risk]** Token scope misconfiguration causes auth failures -> **Mitigation:** document minimum required permissions and keep token dedicated to dispatch purpose.
- **[Risk]** Duplicate downstream runs if maintainers also trigger manually -> **Mitigation:** include `trigger_source`/`trigger_tag` metadata so downstream can gate behavior and operators can trace origin.
- **[Risk]** Downstream Forgejo workflow contract drift (missing `workflow_dispatch` or renamed inputs) breaks dispatch -> **Mitigation:** document and validate downstream contract as part of rollout.

## Migration Plan

No data migration required. This is a CI workflow extension applied in-place.

## References

- GitHub `jobs.<job_id>.needs`: https://docs.github.com/en/actions/using-jobs/using-jobs-in-a-workflow#defining-prerequisite-jobs
- GitHub manual dispatch (`workflow_dispatch`, `inputs`, `ref`): https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
- Forgejo `on.workflow_dispatch`: https://forgejo.org/docs/latest/user/actions/reference/#onworkflow_dispatch
- Forgejo API dispatch contract (`DispatchWorkflowOption.ref` required): https://codeberg.org/swagger.v1.json

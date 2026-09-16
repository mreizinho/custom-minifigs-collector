# Vercel deployment cleanup

`cleanup-vercel-deployments.mjs` proposes keeping the latest successful production deployment for each **completed Europe/Lisbon calendar day**. It also keeps all deployments from today and yesterday, the 20 most recent successful production deployments, and every deployment with an active alias. Preview deployments and GitHub history are untouched.

The script is **dry-run only by default**. The GitHub Actions workflow is manual (`workflow_dispatch`) and preview-only; it has not been scheduled. It does not change Vercel's native retention policy.

## Dry run

For the manual GitHub Actions preview, add the new project-scoped Vercel token as a repository Actions secret named `VERCEL_ACCESS_TOKEN`. The team and project IDs are already in `.github/workflows/preview-vercel-deployment-cleanup.yml`. Never paste the token into a terminal, commit it, or put it in workflow YAML.

For a local run, set these environment variables through your preferred secure credential mechanism:

- `VERCEL_ACCESS_TOKEN`: Vercel token scoped to the `cmcollector` team.
- `VERCEL_TEAM_ID`: the team's `team_...` ID.
- `VERCEL_PROJECT_ID`: the `custom-minifigs-collector` project's `prj_...` ID.

Run:

```text
node scripts/cleanup-vercel-deployments.mjs --json
```

The JSON includes every candidate in `candidates` and the first 25 in `selectedThisRun`. A run stops if pagination, scope, or alias data is incomplete.

## Deletion

After reviewing the real dry-run report, set `VERCEL_ENABLE_DELETION=yes` and run with `--execute`. This deletes at most 25 deployments per run and rechecks active aliases before each deletion. It cannot recover a deployment's instant-rollback URL or guarantee that external links to the deleted deployment keep working. Do not enable unattended runs until the first deletion batch has been reviewed and verified.

```text
node scripts/cleanup-vercel-deployments.mjs --execute
```

To run it daily later, add a scheduled GitHub Actions workflow with the token in a repository secret. A workflow is intentionally not installed yet, so simply pushing this script cannot initiate deletions.

The one-time `execute-vercel-deployment-cleanup.yml` workflow is manual and locked to the SHA-256 fingerprint of the 248 candidates from the reviewed 16 September 2026 preview. It refuses deletion if the candidate set has changed. It also requires typing `DELETE 248` when dispatching. It is not scheduled and will not run on a push. If it fails partway through, review a new preview before any further deletion.

Tests: `node --test scripts/cleanup-vercel-deployments.test.mjs`.

# CI/CD Workflow — GitHub Actions Templates and Safety

Spec for the 6 workflow files, their structure, and the safety rules enforced by `qa-cicd-spv`.
See [D12-cicd-stage-map.md](D12-cicd-stage-map.md) for stage triggers and gate thresholds.
See [HANDBOOK chapter 12](../HANDBOOK/12-cicd-operations.md) for the narrative walkthrough.

---

## The 6 workflow files

| File | Trigger | Purpose |
|------|---------|---------|
| `qa-smoke.yml` | `pull_request` opened / synchronize | PR gate; blocks merge on failure |
| `qa-full.yml` | `push` to `main` | Full cycle on merge; posts summary comment to PR |
| `qa-nightly.yml` | cron `0 2 * * *` | Regression + compare against yesterday's run |
| `qa-release.yml` | tag `v*.*.*` | Full cycle + compliance reports |
| `qa-smoke-prod.yml` | deploy webhook (`workflow_dispatch`) | Post-deploy read-only smoke |
| `qa-pre-commit.yml` | CI mirror of Husky | Re-runs pre-commit checks in CI (lint + typecheck + unit) |

---

## Common workflow structure

Every workflow follows this skeleton:

```yaml
name: QA Smoke
on:
  pull_request:
    branches: [main]

env:
  NODE_VERSION_FILE: .nvmrc   # resolved from target-profile.json at bootstrap

jobs:
  qa:
    runs-on: ubuntu-latest
    timeout-minutes: 20        # wall-clock gate

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version-file: ${{ env.NODE_VERSION_FILE }}
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Run QA smoke
        run: pnpm aegis smoke --env=testing --budget=10m
        env:
          SUPABASE_URL: ${{ secrets.TESTING_SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.TESTING_SUPABASE_ANON_KEY }}

      - name: Upload test artifacts
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: qa-results-${{ github.run_id }}
          path: aegis/runs/
          retention-days: 30

      - name: Publish JUnit results
        uses: mikepenz/action-junit-report@v4
        if: always()
        with:
          report_paths: aegis/runs/*/reports/junit.xml
```

---

## Secrets convention

All secrets follow the pattern `{ENV_PREFIX}_{SECRET_NAME}` where `ENV_PREFIX` is configured in `aegis.config.json.environments.{env}.secretsRef.prefix`.

| Environment | Prefix | Example secret |
|-------------|--------|----------------|
| testing | `TESTING_` | `TESTING_SUPABASE_URL` |
| staging | `STAGING_` | `STAGING_SUPABASE_URL` |
| production | `PROD_` | `PROD_SUPABASE_URL` |

Secret names are never interpolated from variables — they must appear as literal strings in the YAML. `qa-cicd-spv` rejects any workflow where a secret reference is dynamically constructed.

---

## Node version detection

`qa-cicd-implementer` reads `target-profile.json` (written by `qa-context-scanner`) to determine the Node version. It writes the version to `.nvmrc` and references it via `node-version-file` — never hardcoded.

---

## Artifact retention

All workflows use `retention-days: 30`. The 30-day window covers:
- Sprint retrospectives
- Defect evidence review
- Flake pattern detection by `qa-cicd-evaluator`

Extending beyond 30 days requires a change to `thresholds.yaml#artifacts.retentionDays`.

---

## JUnit XML adapter

Every specialist emits test results to `runs/{runId}/reports/junit.xml`. This file is the single input to GitHub's native PR check rendering. The JUnit adapter is in `@qa/reporters/junit.ts` and is called by the test executor after all specialists complete.

---

## `qa-cicd-spv` validation rules

Before any workflow file is committed, `qa-cicd-spv` verifies:

- [ ] `yamllint` passes (no trailing spaces, correct indentation)
- [ ] `actionlint` passes (correct action versions, expression syntax)
- [ ] No secret values inline — all via `${{ secrets.NAME }}`
- [ ] No dynamic secret name construction (`secrets[varName]` is rejected)
- [ ] `timeout-minutes` set on every job
- [ ] `retention-days: 30` on all artifact upload steps
- [ ] `--frozen-lockfile` on `pnpm install`
- [ ] `if: always()` on artifact upload and JUnit report steps
- [ ] No `--force` or `--no-verify` flags in any `run:` step
- [ ] Branch protection compatibility verified against repo settings

---

## Prerequisite: test scripts must exist before CI can run them

CI/CD workflows execute test scripts — they do not generate them. This is a deliberate sequencing requirement:

```
Step 1 — local (developer machine)
  /qa-start --env=development
  └─ Aegis agents run, generate Playwright + Jest scripts → ../tests/
  └─ Developer reviews and commits ../tests/ to the target repo

Step 2 — CI/CD bootstrap (once, after step 1)
  /qa-ci-bootstrap
  └─ Writes .github/workflows/*.yml into the target repo
  └─ Now CI has both the scripts and the workflows to run them

Step 3 — ongoing (automated)
  PR opened → qa-smoke.yml picks up ../tests/ and runs them
  Push to main → qa-full.yml runs the full suite
```

**Never run `/qa-ci-bootstrap` before at least one full `/qa-start` cycle.** The workflows will be syntactically valid but `../tests/` will be empty, so every CI run will pass vacuously with 0 tests executed — a false green.

When adding a new feature, the flow repeats:
1. Run `/qa-start` locally against the new feature
2. Commit the new test scripts Aegis generated
3. CI picks them up automatically on the next PR — no workflow changes needed

---

## Bootstrapping via `/qa-ci-bootstrap`

```bash
/qa-ci-bootstrap
```

1. `qa-context-scanner` writes `target-profile.json` (stack, Node version, env vars)
2. `qa-cicd-planner` produces a workflow plan from `target-profile.json` + test plan
3. `qa-cicd-implementer` writes all 6 workflow files using the plan
4. `qa-cicd-implementer` runs `gh secret set` for each secret in `secretsRef`
5. `qa-cicd-spv` validates all files
6. Husky pre-commit hook is installed (`pnpm husky install`)

Options:
- `--provider=github-actions` (only supported provider currently)
- `--include=smoke,full,nightly,release,smoke-prod,pre-commit` (subset)
- `--dry-run` (print files without writing)

---

## Related docs

- [D11-devops-tier-overview.md](D11-devops-tier-overview.md)
- [D11-worktree-isolation.md](D11-worktree-isolation.md)
- [D12-cicd-stage-map.md](D12-cicd-stage-map.md)
- [D11-secrets-handling.md](D11-secrets-handling.md)
- [HANDBOOK/12-cicd-operations.md](../HANDBOOK/12-cicd-operations.md)

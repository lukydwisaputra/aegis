# CI/CD Stage Map

Specification-level reference for all pipeline stages, triggers, gate thresholds, and workflow files.
See [HANDBOOK chapter 12](../HANDBOOK/12-cicd-operations.md) for the narrative walkthrough.

---

## Stage triggers

| Stage | Trigger | Workflow file | Command | Budget |
|-------|---------|---------------|---------|--------|
| Pre-commit | `git commit` | Husky hook | lint + tc + unit | ~30s |
| PR gate | PR opened / synchronize | `qa-smoke.yml` | `/qa-smoke --env=testing` | ~10 min |
| Main merge | push to `main` | `qa-full.yml` | `/qa-start --env=staging --skip-gates-ci` | ~30–60 min |
| Nightly | cron `0 2 * * *` | `qa-nightly.yml` | `/qa-regression + /qa-compare` | ~60–90 min |
| Pre-release | tag `v*.*.*` | `qa-release.yml` | `/qa-start` + compliance | ~90 min |
| Post-deploy | deploy webhook | `qa-smoke-prod.yml` | `/qa-smoke --env=production --read-only` | ~5 min |

---

## Pipeline flow

```
development (local)
  git commit → husky pre-commit hook
  runs: lint + typecheck + changed unit tests (~30s)
  gate: blocks commit on failure
        │
        │ git push → PR opened
        ▼
testing (ephemeral per PR)
  trigger: pull_request opened / synchronize
  provision: per-PR preview deploy + DB snapshot + per-PR Mailpit
  workflow: qa-smoke.yml
  command:  /qa-smoke --env=testing --budget=10m
  gate:     TESTING
        │
        │ PR merged → main (testing instance torn down)
        ▼
staging (prod mirror)
  trigger: push to main
  workflow: qa-full.yml
  command:  /qa-start --env=staging --skip-gates-ci
  nightly:  qa-nightly.yml → /qa-regression + /qa-compare
  gate:     STAGING
        │
        │ /qa-promote-stage --to-stage=production
        ▼
production (read-only, off main)
  trigger: post-deploy webhook
  workflow: qa-smoke-prod.yml
  command:  /qa-smoke --env=production --read-only
  gate:     PRODUCTION
  fail →    /qa-rollback (auto-suggested)
```

---

## Gate thresholds

Full values live in `aegis/thresholds.yaml`. Defaults:

### TESTING gate — blocks PR merge

| Metric | Threshold |
|--------|-----------|
| Coverage (new code) | ≥ 80% |
| Coverage (overall) | ≥ 75% |
| Test pass-rate (new code) | 100% |
| p95 API latency | < 500 ms |
| Critical CVEs | 0 |
| High CVEs | 0 |
| axe critical (new code) | 0 |
| axe serious (new code) | 0 |
| Wall-clock | ≤ 20 min |

### STAGING gate — blocks promotion to production

| Metric | Threshold |
|--------|-----------|
| Smoke pass-rate | 100% |
| Regression pass-rate | ≥ 99% |
| Acceptance criteria | 100% |
| Open P0/P1 defects | 0 |
| Open Sev1/Sev2 defects | 0 |
| High compliance gaps (any of 6 regulations) | 0 |
| Wall-clock | ≤ 90 min |

### PRODUCTION gate — continuous; fail triggers rollback suggestion

| Metric | Threshold |
|--------|-----------|
| Smoke pass-rate | 100% |
| Core Web Vitals p75 LCP | ≤ 2.5 s |
| Core Web Vitals p75 INP | ≤ 200 ms |
| Core Web Vitals p75 CLS | ≤ 0.1 |
| Change Failure Rate (30d) | ≤ 5% |
| MTTR | < 60 min |
| Error budget | remaining > 0 |

---

## Workflow files

| File | Trigger | Purpose |
|------|---------|---------|
| `qa-smoke.yml` | PR opened / updated | PR gate; blocks merge on failure |
| `qa-full.yml` | Push to `main` | Full cycle on merge; posts summary to PR |
| `qa-nightly.yml` | Cron `02:00` | Regression + compare against yesterday |
| `qa-release.yml` | Tag `v*.*.*` | Full cycle + compliance reports |
| `qa-smoke-prod.yml` | Deploy webhook | Post-deploy read-only smoke |
| `qa-pre-commit.yml` | CI mirror | Re-runs pre-commit checks in CI |

All workflows use pnpm, detect Node version from `target-profile.json`, cache `node_modules`, retain artifacts for 30 days, and emit JUnit XML for native GitHub PR check rendering.

---

## Related docs

- [D12-environments-overview.md](D12-environments-overview.md)
- [D12-env-safety-and-prod.md](D12-env-safety-and-prod.md)
- [D11-secrets-handling.md](D11-secrets-handling.md)
- [HANDBOOK/12-cicd-operations.md](../HANDBOOK/12-cicd-operations.md)

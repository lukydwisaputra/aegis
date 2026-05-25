# Chapter 12 — CI/CD Operations

> _The full pipeline: stages, triggers, gates, commands, thresholds._

## 12.1 The 4-environment pipeline overview

```
development (local)  →  testing (ephemeral per PR)  →  staging (prod mirror)  →  production (read-only)
  git commit             PR opened/updated               push to main               post-deploy webhook
  husky hook             qa-smoke.yml                    qa-full.yml                qa-smoke-prod.yml
  ~30s                   ~10min                          ~30-60min                  ~5min
  lint+tc+unit           /qa-smoke                       /qa-start                  /qa-smoke --read-only
  gate: must pass        gate: TESTING                   gate: STAGING              gate: PRODUCTION
```

## 12.2 Pipeline diagram

```
┌────────────────┐
│  development   │  trigger: git commit
│    (local)     │  hook:    husky pre-commit
│                │  runs:    lint + typecheck + changed unit tests
└────────┬───────┘  gate:    blocks commit
         │
         │ git push → PR opened
         ▼
┌────────────────┐
│    testing     │  trigger: pull_request opened / synchronize
│ (ephemeral     │  provision: per-PR preview deploy + DB snapshot + per-PR Mailhog
│  per PR)       │  workflow: .github/workflows/qa-smoke.yml
│                │  command:  /qa-smoke --env=testing --budget=10m
└────────┬───────┘  gate:     TESTING (cov≥80%, pass=100%, p95<500ms, 0 CVEs, 0 a11y)
         │
         │ PR merged → main (testing instance torn down)
         ▼
┌────────────────┐
│    staging     │  trigger: push to main
│  (prod mirror) │  workflow: .github/workflows/qa-full.yml
│                │  command:  /qa-start --env=staging --skip-gates-ci
│                │  nightly:  qa-nightly.yml → /qa-regression + /qa-compare
└────────┬───────┘  gate:     STAGING (smoke=100%, regression≥99%, 0 open Sev1/Sev2)
         │
         │ /qa-promote-stage --to-stage=production
         ▼
┌────────────────┐
│   production   │  trigger: post-deploy webhook
│ (read-only,    │  workflow: .github/workflows/qa-smoke-prod.yml
│  off main)     │  command:  /qa-smoke --env=production --read-only
└────────────────┘  gate:     PRODUCTION (CWV in Good, CFR≤5%, MTTR<60min)
                    fail →    /qa-rollback (auto-suggested)
```

## 12.3 Stage triggers summary

| Stage | Trigger | Workflow | Command | Budget |
|-------|---------|----------|---------|--------|
| Pre-commit | `git commit` | Husky hook | lint + tc + unit | ~30s |
| PR gate | PR opened/updated | `qa-smoke.yml` | `/qa-smoke --env=testing` | ~10min |
| Main merge | push to `main` | `qa-full.yml` | `/qa-start --env=staging` | ~30-60min |
| Nightly | cron `0 2 * * *` | `qa-nightly.yml` | `/qa-regression + /qa-compare` | ~60-90min |
| Pre-release | tag `v*.*.*` | `qa-release.yml` | `/qa-start` + compliance | ~90min |
| Post-deploy | deploy webhook | `qa-smoke-prod.yml` | `/qa-smoke --env=production --read-only` | ~5min |

## 12.4 Quality gate thresholds

Full thresholds live in `aegis/thresholds.yaml`. Industry defaults:

**Testing gate** (blocks PR merge):
- Coverage new code ≥ 80%, overall ≥ 75%
- Test pass-rate new code = 100%
- p95 API latency < 500ms
- 0 critical CVEs, 0 high CVEs
- 0 axe critical, 0 axe serious on new code
- Wall-clock ≤ 20min

**Staging gate** (blocks promotion to production):
- Smoke = 100%, regression ≥ 99%, acceptance criteria = 100%
- 0 open P0/P1, 0 open Sev1/Sev2
- 0 high compliance gaps across 6 regulations
- Wall-clock ≤ 90min

**Production gate** (continuous — fail triggers rollback suggestion):
- Smoke = 100%
- Core Web Vitals p75: LCP ≤2.5s, INP ≤200ms, CLS ≤0.1
- CFR 30d ≤ 5%, MTTR < 60min
- Error budget remaining

## 12.5 The 4 CI/CD commands

### /qa-ci-bootstrap — set up CI in 5 minutes

```bash
/qa-ci-bootstrap
# → detects stack, generates 6 workflow files, installs Husky
# → configures GitHub secrets via gh secret set
# → validates with actionlint + yamllint
```

Options: `--provider=github-actions`, `--include=smoke,full,nightly,release,smoke-prod,pre-commit`, `--dry-run`

### /qa-gate-check — evaluate gate readiness

```bash
/qa-gate-check --stage=testing --run=RUN-20260523-001

  Testing gate evaluation:
    ✓ coverage.newCode      82.4%  ≥ 80%
    ✓ test.passRateNewCode  100%   = 100%
    ✓ performance.apiP95Ms  320ms  < 500ms
    ✓ security.critical     0      = 0
    ✓ a11y.critical         0      = 0
  Testing gate: PASS (12/12)
```

Read-only — does NOT promote. Emits `gate.evaluated` event.

### /qa-promote-stage — promote to next stage

```bash
/qa-promote-stage --run=RUN-20260523-001 --to-stage=staging
# → runs /qa-gate-check first
# → on pass: tags run, syncs tracker, triggers next workflow
# → on fail: refuses unless --force (requires audit log + signoff)
```

### /qa-rollback — emergency revert

```bash
/qa-rollback --reason="LCP regressed to 4.2s after v2.18.3"
# → triggers rollback.yml workflow
# → opens Sev1 incident defect with events.jsonl timeline
# → generates postmortem template at runs/{id}/postmortem.md
```

## 12.6 The 6 workflow files

| File | Trigger | Purpose |
|------|---------|---------|
| `qa-smoke.yml` | PR opened/updated | PR gate; blocks merge on failure |
| `qa-full.yml` | Push to main | Full cycle on merge; posts summary to PR |
| `qa-nightly.yml` | Cron 02:00 | Regression + compare against yesterday |
| `qa-release.yml` | Tag `v*.*.*` | Full cycle + compliance reports |
| `qa-smoke-prod.yml` | Deploy webhook | Post-deploy read-only smoke |
| `qa-pre-commit.yml` | CI mirror | Re-runs pre-commit checks in CI |

All workflows: pnpm, detected Node version from `target-profile.json`, `node_modules` cache, 30-day artifact retention, JUnit XML adapter for native GitHub PR check rendering.

## 12.7 Error budgets and halting releases

When `prod.errorBudget.haltReleasesAtExhaustion: true` (default), `/qa-promote-stage --to-stage=production` refuses if the monthly error budget is exhausted:

```
ERROR: Error budget exhausted (43.2 min / month limit reached at 39.7 min).
  Releases halted until next budget period.
  Override: /qa-promote-stage --to-stage=production --force
    (requires named approver + incident filed)
```

## 12.8 ⚠ Pitfalls

- **Don't disable a gate without recording why** — use `thresholds.yaml.overrides[].reason`; SPV flags any relaxation below industry default.
- **Don't use `--force` on `/qa-promote-stage` without an incident filed first.**
- **Don't let CI wall-clock exceed 20min** — split into parallel jobs, use `--max-parallel` tuning.
- **Don't put secrets in YAML workflows** — always `${{ secrets.NAME }}`; `qa-cicd-spv` will reject inline values.
- **Don't run mutating tests against prod** — path-guard will block, but don't try.
- **Don't relax `flakeQuarantineAt` above 10%** — that's how flake bankruptcy starts.

## 12.9 → Deep dives

- [docs/D12-environments-overview.md](../docs/D12-environments-overview.md)
- [docs/D12-cicd-stage-map.md](../docs/D12-cicd-stage-map.md)
- [docs/D12-env-safety-and-prod.md](../docs/D12-env-safety-and-prod.md)
- [docs/D11-secrets-handling.md](../docs/D11-secrets-handling.md)

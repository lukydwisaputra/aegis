# Environments Overview

The QA system runs against 4 target environments. Each has distinct capabilities, triggers, and safety rules.

## Where Aegis runs vs. where the target app runs

Aegis is **never deployed**. It is a test executor that runs on developer machines and CI runners, pointing at wherever the target app is hosted.

```
Developer machine / CI runner          Target environment
──────────────────────────────         ──────────────────────────
Aegis process runs here          →     development  (localhost)
  pnpm qa-start --env=testing    →     testing      (preview URL per PR)
  pnpm qa-start --env=staging    →     staging      (https://staging.yourapp.com)
  pnpm qa-smoke --env=production →     production   (https://yourapp.com)
```

Aegis makes HTTP requests, runs Playwright, calls APIs — all from outside the target server. The target app has no knowledge that Aegis exists. Nothing from `aegis/` ends up in a deployed build.

## What Aegis can and cannot write in the target project

Aegis is read-only on target source code. The only exception is test files.

| Target path | Aegis access |
|-------------|-------------|
| `../src/**` | Read-only |
| `../apps/**` | Read-only |
| `../packages/**` | Read-only |
| `../services/**` | Read-only |
| `../tests/**` | **Write allowed** — Aegis deposits generated test specs here |

`@qa/path-guard` enforces this at runtime — any agent that attempts a write outside the allowed paths gets a `PathGuardError` before the write occurs.

When Aegis finds a bug it does **not** fix it. It writes a defect record to `runs/{runId}/defects/` and surfaces it in the report. A human developer applies the fix to the source.

## The 4-environment model

| Environment | Trigger | Mutating | Purpose |
|-------------|---------|----------|---------|
| `development` | Interactive / `git commit` | Yes | Local TDD loop, pre-commit checks, feature-branch validation |
| `testing` | PR opened / updated | Yes (ephemeral per PR) | PR gate — isolated, clean-slate per pull request |
| `staging` | Push to `main` / nightly cron | Yes | Full cycle on main-branch merges, pre-production validation |
| `production` | Post-deploy webhook | **No** (read-only) | Smoke + synthetic monitoring, run off `main` branch |

## Environment capabilities matrix

| Capability | development | testing | staging | production |
|-----------|-------------|---------|---------|-----------|
| All specialists | ✓ | Subset | ✓ | Subset |
| Mutating test data | ✓ | ✓ | ✓ | ✗ |
| Email testing | ✓ (Mailpit) | ✓ (per-PR Mailpit) | ✓ (Mailpit/Gmail) | ✗ |
| Performance testing | ✓ | ✗ | ✓ | ✗ |
| Unit testing | ✓ | ✓ | ✓ | ✗ |
| Read-only enforced | ✗ | ✗ | ✗ | ✓ |
| Ephemeral | ✗ | ✓ | ✗ | ✗ |

## Testing environment — ephemeral per PR

Each PR gets its own isolated instance:
1. PR opened → provision preview deploy (Vercel/Netlify) + DB snapshot from staging + per-PR Mailpit
2. `/qa-smoke --env=testing` runs against the preview URL
3. PR closed → all resources torn down

This prevents PR-to-PR interference that plagues shared testing environments.

## Production environment — read-only enforcement

Path-guard checks `environments.production.readOnly === true` before every mutating action.
Any attempt to write data, submit forms, or modify state is rejected with a `env.write-blocked` event.

Forbidden specialists in production: `email`, `performance`, `unit`.

## Configuration

```jsonc
// aegis.config.json
"environments": {
  "production": {
    "url": "https://example.com",
    "mode": "smoke-only",
    "mutating": false,
    "readOnly": true,
    "allowedSpecialists": ["ui", "api", "security", "a11y"],
    "forbiddenSpecialists": ["email", "performance", "unit"]
  }
}
```

## Targeting environments in commands

```bash
/qa-start --env=staging
/qa-smoke --env=testing --budget=10m
/qa-smoke --env=production --read-only
```

Default is `development` when `--env` is omitted.

## Recommended test strategy — split by environment

Running E2E (Playwright) against a local dev server causes test data pollution over time — every test run creates users, records, and uploads that accumulate in your local database and make development noisy.

The recommended strategy avoids this entirely by splitting what gets tested where:

```
Dev env     → unit tests + component tests only
              fast, no browser, no database needed

Staging     → all E2E Playwright tests
              stable build, controlled data, resets on every deploy
```

Your local environment never gets touched by Playwright. No test data pollution, no DB bloat, no cleanup required.

### Why not run E2E on dev

| Problem | Dev | Staging |
|---|---|---|
| Test data accumulates in local DB | ✗ grows over time | ✓ resets on deploy |
| Hot-reload interrupts tests mid-run | ✗ causes flakiness | ✓ stable server |
| Unoptimized dev build | ✗ different behaviour | ✓ production build |
| Inconsistent local data | ✗ depends on your DB state | ✓ seeded, predictable |
| Missing env vars / services | ✗ easy to forget locally | ✓ provisioned |

### What you need locally

```
✓ pnpm dev              your app running (unit tests import source)
✓ Node + dependencies

✗ local database        NOT needed
✗ seed data             NOT needed
✗ Docker / Supabase     NOT needed (unless your app itself requires it)
```

### Day-to-day workflow

```
# 1. Start your app
cd ../  &&  pnpm dev

# 2. Generate tests (reads source + crawls app — does not run tests)
cd aegis/
/qa-start --env=development

# 3. Run unit tests locally — fast, no browser, no DB
/qa-smoke --env=development --specialists=unit

# 4. Run E2E against staging — stable, clean data
/qa-smoke --env=staging --specialists=ui,api

# 5. Both green → commit
cd ../
git add tests/  &&  git commit -m "test: add specs for feature X"
git push        →   CI runs everything automatically
```

### What CI does automatically after commit

```
PR opened
  ├─ unit tests run against PR code directly     (~2 min)
  └─ E2E runs against ephemeral preview URL      (fresh DB snapshot per PR)

PR merged to main
  └─ full E2E runs against staging

Every night at 2am
  └─ regression E2E runs against staging

After production deploy
  └─ read-only smoke runs against production
```

The per-PR testing environment already solves the pollution problem for CI — each PR gets a fresh DB snapshot, runs tests, then the whole instance is torn down. Nothing persists between PRs.

### What to do when staging E2E fails

The most common causes:

- **Hardcoded IDs** — the test references a record that exists locally but not on staging; use factories that create data dynamically instead
- **Timing** — add explicit `waitFor` assertions rather than fixed `sleep` calls
- **Missing secret** — a value available locally is not set on staging; check `aegis.config.json#environments.staging.secretsRef`

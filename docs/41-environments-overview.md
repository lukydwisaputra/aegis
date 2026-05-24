# Environments Overview

The QA system runs against 4 target environments. Each has distinct capabilities, triggers, and safety rules.

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
| Email testing | ✓ (Mailhog) | ✓ (per-PR Mailhog) | ✓ (Mailhog/Gmail) | ✗ |
| Performance testing | ✓ | ✗ | ✓ | ✗ |
| Unit testing | ✓ | ✓ | ✓ | ✗ |
| Read-only enforced | ✗ | ✗ | ✗ | ✓ |
| Ephemeral | ✗ | ✓ | ✗ | ✗ |

## Testing environment — ephemeral per PR

Each PR gets its own isolated instance:
1. PR opened → provision preview deploy (Vercel/Netlify) + DB snapshot from staging + per-PR Mailhog
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

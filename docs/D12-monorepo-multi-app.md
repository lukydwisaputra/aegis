# Monorepo & Multi-App Setup

How to configure and run Aegis when a single repository contains multiple apps.
See [D12-environments-overview.md](D12-environments-overview.md) for the environment model.

---

## Default config — single app

Out of the box, `aegis.config.json` is set up for a single app:

```jsonc
{
  "target": {
    "platform": "generic",
    "apps": []              // empty = single-app mode
  },
  "environments": {
    "development": { "url": "http://localhost:5173" },
    "testing":     { "url": "${TESTING_PREVIEW_URL}" },
    "staging":     { "url": "https://stg.example.com" },
    "production":  { "url": "https://example.com" }
  }
}
```

One URL per environment, one app — Aegis points all tests at that URL.

---

## Adding multiple apps

Populate `target.apps` with each app's name, source directory, and URLs:

```jsonc
{
  "target": {
    "platform": "generic",
    "apps": [
      {
        "name": "web",
        "rootDir": "../apps/web",
        "url": {
          "development": "http://localhost:3000",
          "testing":     "${WEB_PREVIEW_URL}",
          "staging":     "https://stg.example.com",
          "production":  "https://example.com"
        }
      },
      {
        "name": "api",
        "rootDir": "../apps/api",
        "url": {
          "development": "http://localhost:3001",
          "testing":     "${API_PREVIEW_URL}",
          "staging":     "https://api.stg.example.com",
          "production":  "https://api.example.com"
        }
      },
      {
        "name": "admin",
        "rootDir": "../apps/admin",
        "url": {
          "development": "http://localhost:3002",
          "testing":     "${ADMIN_PREVIEW_URL}",
          "staging":     "https://admin.stg.example.com",
          "production":  "https://admin.example.com"
        }
      }
    ]
  }
}
```

The top-level `environments` block still holds shared settings (specialists, modes, provisioning). Per-app `url` overrides the environment URL for that specific app.

---

## Source scanning

`sourceDirs` in the root config tells Aegis which directories to scan:

```jsonc
{
  "sourceDirs": ["../apps", "../packages", "../services", "../src"]
}
```

This already covers all apps in a monorepo — `../apps` picks up `web`, `api`, and `admin` in one pass. No change needed here.

---

## Test output structure

Each app gets its own folder under `testsDir` (`../tests` by default):

```
../tests/
  web/
    e2e/
    unit/
  api/
    e2e/
    unit/
  admin/
    e2e/
    unit/
```

---

## Running tests

Target a single app:

```bash
/qa-start --app=web --env=staging
/qa-smoke --app=api --env=staging --specialists=api
```

Run all apps (sequential):

```bash
/qa-start --env=staging
```

---

## Environments in a monorepo

### Development — each app on its own port

```
http://localhost:3000   → web
http://localhost:3001   → api
http://localhost:3002   → admin
```

The existing `development` environment config applies to all apps. Each app's `url.development` overrides the URL for that app only.

Since the recommended strategy is unit tests only on dev (no E2E, no browser), the shared local database is not a problem — unit tests don't touch the DB.

### Testing (per-PR) — shared DB snapshot, parallel risk

The current `testing` environment config uses a single Vercel preview and a single DB snapshot from staging:

```jsonc
"testing": {
  "url": "${TESTING_PREVIEW_URL}",
  "ephemeral": true,
  "ephemeralProvisioning": {
    "type": "vercel-preview",
    "dbSnapshotFrom": "staging",
    "mailpitPerInstance": true
  }
}
```

In multi-app mode, each app needs its own preview URL injected via env var (`${WEB_PREVIEW_URL}`, `${API_PREVIEW_URL}`, etc.). The DB snapshot is still shared across apps.

**Problem:** if `web` and `api` tests run in parallel against the same DB, they can write conflicting data and cause flaky failures.

**Solution 1 — run apps sequentially in CI:**

```yaml
jobs:
  qa-api:
    steps:
      - run: pnpm aegis smoke --app=api --env=testing

  qa-web:
    needs: qa-api           # waits for api to finish
    steps:
      - run: pnpm aegis smoke --app=web --env=testing

  qa-admin:
    needs: qa-api           # waits for api, runs parallel with web
    steps:
      - run: pnpm aegis smoke --app=admin --env=testing
```

**Solution 2 — use factories with teardown (recommended):**

`qa-environment-engineer` generates factory helpers that create and clean up test data per test. Tests become self-contained and safe to run in parallel:

```ts
const user = await factory.create('user', { role: 'admin' })
// ... test runs ...
await factory.cleanup(user.id)    // always deleted, even on failure
```

With factories, full parallel is safe:

```yaml
strategy:
  matrix:
    app: [web, api, admin]    # parallel, no ordering needed
```

### Staging — shared server (default)

The existing staging config points to one URL. In multi-app mode each app has its own staging URL but they all share one database:

```
https://stg.example.com          → web
https://api.stg.example.com      → api
https://admin.stg.example.com    → admin
                                    └─ one shared staging DB
```

Run apps in the order that matches data dependencies (API creates data, web/admin consume it):

```bash
/qa-smoke --app=api --env=staging     # first — creates baseline data
/qa-smoke --app=web --env=staging     # can rely on api data
/qa-smoke --app=admin --env=staging   # same
```

Or use factories and run in parallel.

### Production — read-only per app

The existing production config applies to all apps:

```jsonc
"production": {
  "mutating": false,
  "readOnly": true,
  "allowedSpecialists": ["ui", "api", "security", "a11y"],
  "forbiddenSpecialists": ["email", "performance", "unit"]
}
```

Each app's smoke runs after its own deploy — not all at once:

```bash
/qa-smoke --app=web   --env=production --read-only
/qa-smoke --app=api   --env=production --read-only
/qa-smoke --app=admin --env=production --read-only
```

---

## Ports

The existing `ports` config is shared across all apps:

```jsonc
"ports": {
  "dashboard":    3030,
  "dashboardApi": 3031,
  "mailpit":      { "smtp": 1025, "http": 8025 },
  "playwrightUI": 9323
}
```

Make sure your app dev ports (3000, 3001, 3002) don't conflict with these.

---

## Day-to-day workflow (multi-app)

Only work on the app you changed:

```bash
# You changed something in web

# 1. Start all apps
cd ../  &&  pnpm dev

# 2. Generate tests for web only
cd aegis/
/qa-start --app=web --env=development

# 3. Unit tests locally
/qa-smoke --app=web --env=development --specialists=unit

# 4. E2E on staging
/qa-smoke --app=web --env=staging --specialists=ui,api

# 5. Commit
cd ../
git add tests/web/  &&  git commit -m "test: update web specs"
```

---

## Related docs

- [D12-environments-overview.md](D12-environments-overview.md) — environment model and recommended test strategy
- [D12-cicd-workflow.md](D12-cicd-workflow.md) — GitHub Actions workflow templates
- [D12-cicd-stage-map.md](D12-cicd-stage-map.md) — pipeline triggers and gate thresholds
- [D12-env-safety-and-prod.md](D12-env-safety-and-prod.md) — read-only enforcement and production safety

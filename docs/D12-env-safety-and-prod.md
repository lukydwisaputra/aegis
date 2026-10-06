# Environment Safety and Production Rules

Spec for environment-scoped safety enforcement, read-only mode, and forbidden specialist rules.
See [D12-environments-overview.md](D12-environments-overview.md) for the 4-env model.
See [secrets/README.md](../secrets/README.md) for secrets management.

---

## The 4 environments

| Environment | Mutating writes allowed | Specialist restrictions |
|-------------|------------------------|------------------------|
| `development` (local) | Yes | None |
| `testing` (ephemeral per PR) | Yes | Full specialist roster |
| `staging` (prod mirror) | Yes | Full specialist roster |
| `production` | **No** | Only `ui` and `api` read-only smoke; every other specialist forbidden |

---

## Read-only enforcement (`env.readOnly`)

When `env.readOnly: true` in `aegis.config.json`, `@qa/path-guard.assertEnvSafe(env, action)` throws `EnvWriteBlocked` for any action where `action.mutates === true`.

This covers:
- Database writes (INSERT, UPDATE, DELETE)
- File uploads
- User creation / modification
- Messaging sends (real email or SMS to a real recipient)
- Any `POST/PUT/PATCH/DELETE` HTTP request from a specialist

Read-only actions allowed in production:
- `GET` requests to public and authenticated endpoints
- Lighthouse-CI audits (passive observation only)
- Log ingestion and event streaming reads
- Core Web Vitals measurement

Production smoke tests use `--read-only` flag:
```bash
/qa-smoke --env=production --read-only
```

The `--read-only` flag is enforced at the specialist dispatch level — the CLI refuses the claim of any specialist outside the production allowed list, and the executor marks those TCs `blocked`.

---

## Forbidden specialists per environment

Configured in `aegis.config.json`:

```jsonc
"environments": {
  "production": {
    "readOnly": true,
    "allowedSpecialists": ["ui", "api"],  // read-only smoke
    // destructive migrations, k6 load, ZAP active scan, real messaging sends, flag-override writes:
    "forbiddenSpecialists": ["database", "performance", "security", "messaging", "feature-flag"]
  }
}
```

When a forbidden specialist is dispatched:
1. The CLI refuses the claim at dispatch: PathGuardError `specialist-blocked` (or RunStateError `env-blocked` when the run may not target the environment)
2. The test executor marks the affected TCs `blocked` and continues

---

## Production safety checklist

Before `qa-smoke-prod.yml` triggers, the following must be true:

- [ ] `env.readOnly === true` in config
- [ ] All forbidden specialists listed in `forbiddenSpecialists[]`
- [ ] No `--force` flag on any specialist invocation
- [ ] Messaging specialist forbidden (`messaging` in `forbiddenSpecialists`; no messaging test infrastructure in prod)
- [ ] No DB snapshot or migration steps in the workflow

---

## `env.write-blocked` event

```jsonc
{
  "type": "env.write-blocked",
  "env": "production",
  "agent": "qa-database-specialist",
  "action": "migration.run",
  "reason": "env.readOnly === true",
  "ts": "2026-05-23T18:00:00Z"
}
```

---

## Data isolation between environments

Each environment has its own:
- Supabase project (separate URL + anon key)
- Messaging stub and provider development tenant (`development` only; `testing`, `staging` and `production` forbid the messaging specialist)
- Ephemeral database snapshot (testing: restored from staging snapshot per PR)

Secrets for each environment are prefixed by environment (see [secrets/README.md](../secrets/README.md)).

Never point a lower environment's specialist at a higher environment's database URL. The `qa-context-scanner` validates URL–environment alignment in `target-profile.json`.

---

## Related docs

- [D12-environments-overview.md](D12-environments-overview.md)
- [secrets/README.md](../secrets/README.md)
- [D12-cicd-stage-map.md](D12-cicd-stage-map.md)
- [HANDBOOK/12-cicd-operations.md](../HANDBOOK/12-cicd-operations.md)

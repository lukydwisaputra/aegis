# Environment Safety and Production Rules

Spec for environment-scoped safety enforcement, read-only mode, and forbidden specialist rules.
See [D12-environments-overview.md](D12-environments-overview.md) for the 4-env model.
See [D11-secrets-handling.md](D11-secrets-handling.md) for secrets management.

---

## The 4 environments

| Environment | Mutating writes allowed | Specialist restrictions |
|-------------|------------------------|------------------------|
| `development` (local) | Yes | None |
| `testing` (ephemeral per PR) | Yes | `qa-performance-specialist` limited to baseline-only |
| `staging` (prod mirror) | Yes | Full specialist roster |
| `production` | **No** | All mutating specialists forbidden |

---

## Read-only enforcement (`env.readOnly`)

When `env.readOnly: true` in `aegis.config.json`, `@qa/path-guard.assertEnvSafe(env, action)` throws `EnvWriteBlocked` for any action where `action.mutates === true`.

This covers:
- Database writes (INSERT, UPDATE, DELETE)
- File uploads
- User creation / modification
- Email sends (real SMTP, not Mailhog)
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

The `--read-only` flag is enforced at the specialist dispatch level — any specialist that declares `mutates: true` in its manifest is skipped and a `specialist.skipped.readonly` event is emitted.

---

## Forbidden specialists per environment

Configured in `aegis.config.json`:

```jsonc
"environments": {
  "production": {
    "readOnly": true,
    "forbiddenSpecialists": [
      "qa-performance-specialist",   // k6 load tests would hammer prod
      "qa-security-specialist",      // ZAP active scan mutates state
      "qa-database-specialist",      // migration tests are destructive
      "qa-email-specialist"          // no real email sends in prod
    ]
  }
}
```

When a forbidden specialist is dispatched:
1. `path-guard.assertEnvSafe` throws `EnvSpecialistBlocked`
2. A `env.specialist-blocked` event is emitted with specialist name and environment
3. The test executor logs the skip and continues — it is not a test failure

---

## Production safety checklist

Before `qa-smoke-prod.yml` triggers, the following must be true:

- [ ] `env.readOnly === true` in config
- [ ] All forbidden specialists listed in `forbiddenSpecialists[]`
- [ ] No `--force` flag on any specialist invocation
- [ ] Mailhog adapter disabled (no email test infrastructure in prod)
- [ ] No DB snapshot or migration steps in the workflow
- [ ] ZAP passive scan only (no active scan) — `qa-security-specialist` uses `--passive-only` when not forbidden

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
- Mailhog instance (`testing` only — staging uses real SMTP to a test inbox)
- Ephemeral database snapshot (testing: restored from staging snapshot per PR)

Secrets for each environment are prefixed by environment (see [D11-secrets-handling.md](D11-secrets-handling.md)).

Never point a lower environment's specialist at a higher environment's database URL. The `qa-context-scanner` validates URL–environment alignment in `target-profile.json`.

---

## Related docs

- [D12-environments-overview.md](D12-environments-overview.md)
- [D11-secrets-handling.md](D11-secrets-handling.md)
- [D12-cicd-stage-map.md](D12-cicd-stage-map.md)
- [HANDBOOK/12-cicd-operations.md](../HANDBOOK/12-cicd-operations.md)

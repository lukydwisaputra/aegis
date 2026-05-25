# Secrets Handling

How Aegis resolves, uses, and protects secrets across all environments and agents.
See [D12-cicd-workflow.md](D12-cicd-workflow.md) for how secrets appear in workflow YAML.
See [D12-env-safety-and-prod.md](D12-env-safety-and-prod.md) for environment safety rules.

---

## Secret resolution flow

```
aegis.config.json
  environments.{env}.secretsRef
    → type: "github-actions-secrets"
    → prefix: "TESTING_"
        │
        ▼
@qa/secrets.get(name, env)
  → resolves to process.env[`${prefix}${name}`]
  → throws SecretNotFound if undefined
  → never logs the value
```

Agents never access `process.env` directly. All secret access goes through `@qa/secrets.get` so resolution is auditable and the source is swappable without changing agent code.

---

## Naming convention

```
{ENV_PREFIX}_{SECRET_NAME}
```

| Environment | Prefix | Example |
|-------------|--------|---------|
| testing | `TESTING_` | `TESTING_SUPABASE_URL` |
| staging | `STAGING_` | `STAGING_SUPABASE_URL` |
| production | `PROD_` | `PROD_SUPABASE_URL` |

Standard secret names (consistent across environments):

| Secret name | Purpose |
|-------------|---------|
| `SUPABASE_URL` | Database URL |
| `SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin key (DB specialist only) |
| `APP_URL` | Base URL of the deployed app |
| `MAILPIT_URL` | Mailpit API endpoint (testing env only) |
| `SMTP_HOST` | SMTP host (staging env only) |

---

## GitHub Actions secrets setup

`qa-cicd-implementer` sets secrets via the `gh` CLI during `/qa-ci-bootstrap`:

```bash
gh secret set TESTING_SUPABASE_URL --body "$TESTING_SUPABASE_URL"
gh secret set TESTING_SUPABASE_ANON_KEY --body "$TESTING_SUPABASE_ANON_KEY"
# etc.
```

Source of secret values: the operator's local environment at bootstrap time, not from any Aegis config file or agent context.

---

## What is never allowed

- Secret values in `aegis.config.json` — only `secretsRef` metadata (type, prefix)
- Secret values in `events.jsonl` — `@qa/secrets` strips values before any logging
- Secret values in lessons.json — `@qa/agent-memory` validates no string matches known secret patterns
- Dynamic secret name construction in YAML — `${{ secrets[varName] }}` is rejected by `qa-cicd-spv`
- Secrets in PR descriptions or issue bodies — `qa-github-spv` scans for common secret patterns before PR creation

---

## Secret scanning (`qa-security-specialist`)

Gitleaks runs as part of every security specialist invocation:

```bash
gitleaks detect --redact --source=. --report-format=json
```

`--redact` replaces secret values with `REDACTED` in the output — raw values never appear in the Gitleaks report or events.jsonl.

Any `SecretLeakDetected` finding is automatically filed as a **Severity 1** defect regardless of where it appears (test files, config, logs).

---

## JWT forging for database tests

`qa-database-specialist` needs role-scoped Supabase tokens for RLS policy testing. It forges JWTs using the `SUPABASE_SERVICE_ROLE_KEY`:

```typescript
import { createClient } from '@supabase/supabase-js';
const adminClient = createClient(url, serviceRoleKey);
const { data } = await adminClient.auth.admin.generateLink({
  type: 'magiclink',
  email: 'test-role@example.com'
});
```

The service role key is only ever passed to `qa-database-specialist` and only in the `testing` or `staging` environment — never production.

---

## `secretsRef` configuration

```jsonc
// aegis.config.json
{
  "environments": {
    "testing": {
      "secretsRef": {
        "type": "github-actions-secrets",
        "prefix": "TESTING_"
      }
    },
    "staging": {
      "secretsRef": {
        "type": "github-actions-secrets",
        "prefix": "STAGING_"
      }
    },
    "production": {
      "secretsRef": {
        "type": "github-actions-secrets",
        "prefix": "PROD_"
      }
    }
  }
}
```

Supported `type` values: `github-actions-secrets` (current). Future: `aws-secrets-manager`, `vault`.

---

## Related docs

- [D12-cicd-workflow.md](D12-cicd-workflow.md)
- [D12-env-safety-and-prod.md](D12-env-safety-and-prod.md)
- [D12-environments-overview.md](D12-environments-overview.md)

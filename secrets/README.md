# secrets/

All `.env.*` files, OAuth configs, and any credential material for Aegis + the target app.

## ⚠ Entirely gitignored

Every file in this folder is gitignored **except**:
- `*.example` files (templates with key names but no values)
- `*.example.*` files
- This `README.md`
- `.gitignore` itself

Pre-commit hook (Layer 3 of gitignore defense) refuses to stage any file matching `.env.*` that's not an `.example`.

## Layout

```
secrets/
├── README.md                          # this file
├── .gitignore                         # nested protective rules
├── .env.development.example           # committed template — copy to .env.development locally
├── .env.testing.example
├── .env.staging.example
├── .env.production.example
├── .env.development                   # gitignored (real)
├── .env.testing                       # gitignored (real)
├── .env.staging                       # gitignored (real)
├── .env.production                    # gitignored (real)
└── oauth/                             # gitignored — google.json, microsoft.json, etc.
```

## How to populate

After `aegis init` runs against a target project:
1. For each env, copy the `.example` to its real name: `cp .env.testing.example .env.testing`
2. Fill in the values. Reference what your target app needs (`apps/{name}/.env.example` in target repo).
3. NEVER commit the real `.env.*` files.

## Provider abstraction

For production deployments, secrets typically come from a vault (1Password / AWS SSM / Vault). `aegis.config.json.environments.{env}.secretsRef` configures the source:

```jsonc
{
  "secretsRef": {
    "type": "github-actions-secrets",   // local-1password | aws-ssm | vault
    "prefix": "STAGING_"
  }
}
```

`@qa/secrets` resolves values at use-time without ever pulling them into agent context.

## What lives here (full list — see docs/D11-secrets-handling.md)

- `APP_BASE_URL`, `APP_API_URL`
- `DATABASE_URL`, `DATABASE_PASSWORD`, etc.
- `SUPABASE_*` (when target.platform === "supabase")
- `GMAIL_OAUTH_*` (when email adapter = gmail)
- `MAILPIT_URL`
- `GITHUB_TOKEN`
- `LINEAR_API_KEY` / `JIRA_API_TOKEN` / `CLICKUP_API_TOKEN` (optional)
- `SENTRY_DSN` (optional)
- `DASHBOARD_AUTH_SECRET` (if dashboard auth-gated)

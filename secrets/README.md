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

## Values kept in a vault

Aegis has no vault resolver. Agents read the values from the gitignored `secrets/.env.{env}` file of the run's environment and never write them to logs, events or work reports. When the values live in a vault (1Password, AWS SSM, HashiCorp Vault), export them into that file before the cycle starts.

## What lives here (full list)

- `APP_BASE_URL`, `APP_API_URL`
- `DATABASE_URL`, `DATABASE_PASSWORD`, etc.
- `SUPABASE_*` (when target.platform === "supabase")
- The target's messaging base URL and key, under the env names `aegis messaging check` prints (development only)
- `GITHUB_TOKEN`
- `LINEAR_API_KEY` / `JIRA_API_TOKEN` / `CLICKUP_API_TOKEN` (optional)
- `SENTRY_DSN` (optional)
- `DASHBOARD_AUTH_SECRET` (if dashboard auth-gated)

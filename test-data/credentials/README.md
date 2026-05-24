# test-data/credentials/

Human-provided login credentials per role for the Playwright auth fixture.

## How this works

1. For each role in `aegis.config.json.target.supabase.rolesToTest[]` (or the equivalent for non-Supabase targets), there's an `.env.local.example` template and (locally) a real `.env.local` file.
2. Templates are committed; real files are gitignored.
3. The Playwright auth fixture reads them at runtime via `global-setup.ts`.

## File naming

```
{role-name}.env.local.example   # COMMITTED template
{role-name}.env.local           # GITIGNORED (real creds)
```

## Example structure

```
# admin.env.local
ROLE=admin
EMAIL=qa+admin@example.com
PASSWORD=<your-test-password>
# Optional: pre-forged JWT (Supabase only — bypasses real login)
JWT_OVERRIDE=
```

## Onboarding flow

When a new teammate clones the repo:
1. They see `*.env.local.example` files committed
2. For each role they need to test, they `cp admin.env.local.example admin.env.local` and fill in real creds
3. The auth fixture uses their local creds to log in once per session

## Security

- These files NEVER enter git (pre-commit hook blocks them — gitleaks Layer 3)
- Real production credentials should NEVER live here — only test accounts on staging/testing envs
- For prod synthetic monitoring, use a dedicated read-only synthetic-user account
